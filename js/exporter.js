// 이미지 내보내기: PNG(현재 캔버스) + GIF(전체 축약을 morph 프레임과 함께 인코딩).
//
// GIF 인코딩은 gif.js(jnordberg/gif.js v0.2.0, MIT — vendor/LICENSE-gif.js) 에 위임.
// 직접 LZW/GIF89a 바이트 스트림을 작성하던 이전 코드는 디코더마다 디테일이
// 달라서 안전하지 않았다 — 라이브러리로 대체.

import { reduceStep, reduceAll } from './reducer.js';
import { layoutTreemap, cellGap } from './treemap.js';
import { buildFrameContext, computeFrame } from './animator.js';
import { TreemapRenderer } from './renderer.js';

const DEFAULT_MAX_FRAMES = 60;
// 한 변이당 보간 프레임 수. e=1/4, 2/4, 3/4, 1 — 마지막은 다음 스텝의 정적 시작과
// 겹치므로 연속 재생 시 점프 없이 이어진다.
const SUB_FRAMES_PER_STEP = 4;

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function exportPng(renderer, ast, { width, height, colorOverrides } = {}) {
  const w = width ?? renderer.w;
  const h = height ?? renderer.h;
  if (w < 2 || h < 2) throw new Error('캔버스 크기가 너무 작아 PNG 를 만들 수 없습니다.');

  const { surface, offRenderer } = buildExportSurface(w, h);
  offRenderer.setLayout(layoutTreemap(ast, paddedBounds(w, h), colorOverrides));

  const blob = await new Promise((resolve, reject) =>
    surface.convertToBlob
      ? surface.convertToBlob({ type: 'image/png' }).then(resolve, reject)
      : new Promise((res) =>
          surface.toBlob(
            (b) => (b ? res(b) : reject(new Error('PNG 인코딩 실패'))),
            'image/png'
          )
        )
  );
  downloadBlob(blob, `lambda-treemap-${w}x${h}-${timestamp()}.png`);
}

/**
 * 현재 AST 의 정적 모습을 사용자 지정 (W, H) 크기로 오프스크린에 렌더한 뒤
 * targetCanvas 로 그대로 blit 한다. PNG/GIF 와 같은 surface + layout 코드이지만
 * 다운로드 대신 미리보기 캔버스에 결과를 그대로 그려 넣는다.
 * targetCanvas.width/height 는 호출 전에 (W, H) 와 같거나 큰 값이어야 한다.
 *
 * @param {HTMLCanvasElement} targetCanvas 미리보기용 보일 캔버스
 * @param {object} ast
 * @param {Map<string,string>} [colorOverrides]
 * @param {number} w
 * @param {number} h
 */
export function renderPreview(targetCanvas, ast, colorOverrides, w, h) {
  const { surface, offRenderer } = buildExportSurface(w, h);
  offRenderer.setLayout(layoutTreemap(ast, paddedBounds(w, h), colorOverrides));
  const targetCtx = targetCanvas.getContext('2d');
  targetCtx.clearRect(0, 0, w, h);
  targetCtx.drawImage(surface, 0, 0, w, h);
}

// ----- 오프스크린 캔버스 -----

function makeOffscreen(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(w, h);
  }
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function getCtx2d(surface) {
  return typeof surface.getContext === 'function'
    ? surface.getContext('2d')
    : surface;
}

/**
 * (w, h) 크기의 오프스크린 캔버스 + TreemapRenderer + 2d ctx 를 만든다.
 * 배경은 흰색으로 미리 채워서 내보낼 때 인셋 영역 바깥이 비지 않게 한다.
 */
function buildExportSurface(w, h) {
  const surface = makeOffscreen(w, h);
  const ctx = getCtx2d(surface);
  const offRenderer = new TreemapRenderer(surface);
  offRenderer.setSize(w, h, 1);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  return { surface, ctx, offRenderer };
}

/**
 * 트리맵이 캔버스 가장자리에 닿지 않도록 cellGap 만큼 안쪽으로 인셋한 영역.
 * 내보낼 때만 사용 — 화면 표시는 그대로 가장자리까지 채운다.
 */
export function paddedBounds(w, h) {
  const gap = cellGap({ x: 0, y: 0, w, h });
  return {
    x: gap,
    y: gap,
    w: Math.max(1, w - gap * 2),
    h: Math.max(1, h - gap * 2),
  };
}

// ----- 공개: GIF 내보내기 (gif.js 위임) -----

/**
 * 주어진 AST 의 베타 축약을 전체 재생한 GIF 를 생성해 다운로드한다.
 * @param {object} options
 * @param {TreemapRenderer} options.renderer  현재 화면의 렌더러 (기본 크기 참고용)
 * @param {object} options.ast              축약 시작 AST
 * @param {number} [options.width]          출력 캔버스 가로 px (기본 renderer.w)
 * @param {number} [options.height]         출력 캔버스 세로 px (기본 renderer.h)
 * @param {number} [options.maxFrames=60]   비정규형(예: 오메가)일 때 캡
 * @param {number} [options.frameMs=700]    한 보간 프레임당 ms (스피드 슬라이더 값)
 * @param {(i:number,total:number)=>void} [options.onProgress]
 */
export function exportGif({
  renderer,
  ast,
  width,
  height,
  maxFrames = DEFAULT_MAX_FRAMES,
  frameMs = 700,
  onProgress,
}) {
  const w = width ?? renderer.w;
  const h = height ?? renderer.h;
  if (w < 2 || h < 2) throw new Error('캔버스 크기가 너무 작아 GIF 를 만들 수 없습니다.');

  const { surface, ctx, offRenderer } = buildExportSurface(w, h);
  const bounds = paddedBounds(w, h);

  const { history } = reduceAll(ast, { maxSteps: maxFrames });
  const stepCount = Math.max(0, history.length - 1);
  const subFrames = SUB_FRAMES_PER_STEP;
  const totalFrames = 1 + stepCount * subFrames;
  const delayMs = Math.max(20, Math.round(frameMs));

  const GIF = /** @type {any} */ (typeof window !== 'undefined' ? window.GIF : null);
  if (!GIF) {
    throw new Error('gif.js 가 로드되지 않았습니다 (vendor/gif.js 확인)');
  }
  const gif = new GIF({
    workers: 2,
    quality: 10,
    // workerScript: index.html 와 같은 폴더 (vendor/) 에서 로드 — 상대경로.
    workerScript: 'vendor/gif.worker.js',
    width: w,
    height: h,
    repeat: 0, // 무한 반복
    background: '#ffffff',
    transparent: null,
  });

  // 첫 프레임: 초기 AST 의 정적 모습.
  offRenderer.setLayout(layoutTreemap(history[0], bounds));
  // ponytail: gif.js 의 addFrame 은 OffscreenCanvas 를 인식 못한다 — instanceof
  // ImageData / CanvasRenderingContext2D / HTMLCanvasElement 어느 것도 아니다.
  // ImageData 로 추출해서 넘기면 첫 분기에서 받아 인코딩한다.
  gif.addFrame(ctx.getImageData(0, 0, w, h), { delay: delayMs });
  onProgress?.(1, totalFrames);

  // 변이 프레임: 각 (old, new) 쌍에서 subFrames 개 만큼 보간 샘플.
  for (let i = 0; i < stepCount; i++) {
    const oldAst = history[i];
    const newAst = history[i + 1];
    const redex = reduceStep(oldAst).redex;
    if (!redex) continue;
    const ctxFrame = buildFrameContext({ oldAst, newAst, redex, bounds });
    if (!ctxFrame) continue;
    for (let k = 0; k < subFrames; k++) {
      const e = (k + 1) / subFrames;
      const { tree, ghosts } = computeFrame(ctxFrame, e);
      offRenderer.renderMorph(tree, ghosts);
      gif.addFrame(ctx.getImageData(0, 0, w, h), { delay: delayMs });
      onProgress?.(1 + i * subFrames + k + 1, totalFrames);
    }
  }

  // gif.js 는 진행률을 0..1 사이 실수로 알려준다 — (i, total) 로 환산해서 콜백 호출.
  gif.on('progress', (p) => {
    onProgress?.(Math.round(p * totalFrames), totalFrames);
  });

  return new Promise((resolve, reject) => {
    gif.on('finished', (blob) => {
      downloadBlob(blob, `lambda-treemap-reduction-${w}x${h}-${timestamp()}.gif`);
      resolve();
    });
    try {
      gif.render();
    } catch (e) {
      reject(e);
    }
  });
}