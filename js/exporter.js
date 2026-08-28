// 이미지 내보내기: PNG(현재 캔버스) + GIF(전체 축약을 morph 프레임과 함께 인코딩).
//
// GIF 인코딩은 외부 라이브러리 없이 LZW + GIF89a 바이트 스트림을 직접 쓴다.
// ponytail: 필요한 만큼만 — 트리맵은 셀 수가 적어 색 수가 256을 넘지 않으므로
// 프레임당 로컬 팔레트(≤256색)만 쓰고, 넘으면 최빈 256색 + 최근접 양자화.

import { reduceStep, reduceAll } from './reducer.js';
import { layoutTreemap, cellGap } from './treemap.js';
import {
  buildFrameContext,
  computeFrame,
} from './animator.js';
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

export async function exportPng(renderer, ast, { width, height } = {}) {
  const w = width ?? renderer.w;
  const h = height ?? renderer.h;
  if (w < 2 || h < 2) throw new Error('캔버스 크기가 너무 작아 PNG 를 만들 수 없습니다.');

  const { surface, ctx, offRenderer } = buildExportSurface(w, h);
  offRenderer.setLayout(layoutTreemap(ast, paddedBounds(w, h)));

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

function readPixels(ctx, w, h) {
  return new Uint8ClampedArray(ctx.getImageData(0, 0, w, h).data.buffer);
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
 * ponytail: 화면 표시 동작 변경 안 함.
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

// ----- GIF89a 인코더 (LZW) -----

const PALETTE_SIZE = 256;
const PALETTE_BITS = 8; // 2^8 = 256 entries
const MIN_CODE_SIZE = 8; // 인덱스당 비트 수

export function buildPaletteAndIndices(pixels) {
  // 픽셀 카운트로 자주 등장하는 색부터 팔레트에 채움.
  const counts = new Map();
  for (let i = 0; i < pixels.length; i += 4) {
    const key = (pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2];
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let paletteEntries;
  if (counts.size <= PALETTE_SIZE) {
    paletteEntries = [...counts.keys()];
    while (paletteEntries.length < PALETTE_SIZE) {
      paletteEntries.push(0); // 검정으로 패딩 (가장자리 보호)
    }
  } else {
    paletteEntries = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, PALETTE_SIZE)
      .map(([k]) => k);
  }
  const palette = paletteEntries.map((k) => [
    (k >> 16) & 0xff,
    (k >> 8) & 0xff,
    k & 0xff,
  ]);
  // 픽셀 → 팔레트 인덱스 (최근접, RGB 유클리드).
  const indices = new Uint8Array(pixels.length / 4);
  for (let i = 0, j = 0; i < pixels.length; i += 4, j++) {
    const r = pixels[i],
      g = pixels[i + 1],
      b = pixels[i + 2];
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let p = 0; p < PALETTE_SIZE; p++) {
      const [pr, pg, pb] = palette[p];
      const dr = r - pr,
        dg = g - pg,
        db = b - pb;
      const d = dr * dr + dg * dg + db * db;
      if (d < bestDist) {
        bestDist = d;
        bestIdx = p;
        if (d === 0) break;
      }
    }
    indices[j] = bestIdx;
  }
  return { palette, indices };
}

export function lzwEncode(indices) {
  const clearCode = 1 << MIN_CODE_SIZE; // 256
  const endCode = clearCode + 1; // 257
  let nextCode = endCode + 1; // 258
  let codeSize = MIN_CODE_SIZE + 1; // 9

  let buf = 0;
  let nbits = 0;
  const out = [];
  const writeBits = (code, n) => {
    buf |= code << nbits;
    nbits += n;
    while (nbits >= 8) {
      out.push(buf & 0xff);
      buf >>>= 8;
      nbits -= 8;
    }
  };

  if (indices.length === 0) {
    writeBits(clearCode, codeSize);
    writeBits(endCode, codeSize);
    if (nbits > 0) out.push(buf & 0xff);
    return new Uint8Array(out);
  }

  // key = prefix_code * 256 + pixel (prefix_code < 4096, pixel < 256 → 안전 정수)
  const dict = new Map();

  writeBits(clearCode, codeSize);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const c = indices[i];
    const key = prefix * 256 + c;
    if (dict.has(key)) {
      prefix = dict.get(key);
    } else {
      writeBits(prefix, codeSize);
      if (nextCode < 4096) {
        dict.set(key, nextCode++);
        if (nextCode > (1 << codeSize) && codeSize < 12) {
          codeSize++;
        }
      }
      prefix = c;
    }
  }
  writeBits(prefix, codeSize);
  writeBits(endCode, codeSize);
  if (nbits > 0) out.push(buf & 0xff);
  return new Uint8Array(out);
}

export function packSubBlocks(data) {
  const chunks = [];
  let i = 0;
  while (i < data.length) {
    const len = Math.min(255, data.length - i);
    chunks.push(len);
    for (let j = 0; j < len; j++) chunks.push(data[i + j]);
    i += len;
  }
  chunks.push(0); // block terminator
  return new Uint8Array(chunks);
}

function headerBytes(w, h) {
  return new Uint8Array([
    0x47,
    0x49,
    0x46,
    0x38,
    0x39,
    0x61, // "GIF89a"
    w & 0xff,
    (w >> 8) & 0xff,
    h & 0xff,
    (h >> 8) & 0xff,
    // packed: 전역 팔레트 없음(0) / 해상도 1(000) / 정렬 없음(0) / 팔레트 크기 0 (사용 안 함)
    0x00,
    0x00, // background color index, pixel aspect ratio
  ]);
}

function graphicControlBytes(delayCs) {
  // disposal=0 (그대로 둠), transparent flag=0
  return new Uint8Array([
    0x21,
    0xf9,
    0x04,
    0x00, // packed: disposal=0, userInput=0, transparent=0
    delayCs & 0xff,
    (delayCs >> 8) & 0xff,
    0x00, // transparent color index (사용 안 함)
    0x00, // block terminator
  ]);
}

function imageDescriptorBytes(w, h) {
  return new Uint8Array([
    0x2c, // image separator
    0x00,
    0x00, // left
    0x00,
    0x00, // top
    w & 0xff,
    (w >> 8) & 0xff,
    h & 0xff,
    (h >> 8) & 0xff,
    // packed: localColorTable=1(팔레트 있음), interlace=0, sort=0, reserved=00,
    // 팔레트 크기 = 7 (256 entries)
    0x80 | PALETTE_BITS - 1,
  ]);
}

function localColorTableBytes(palette) {
  const out = new Uint8Array(palette.length * 3);
  for (let i = 0; i < palette.length; i++) {
    out[i * 3] = palette[i][0];
    out[i * 3 + 1] = palette[i][1];
    out[i * 3 + 2] = palette[i][2];
  }
  return out;
}

// ----- 공개: GIF 내보내기 -----

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
export async function exportGif({
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

  const { ctx, offRenderer } = buildExportSurface(w, h);

  const { history } = reduceAll(ast, { maxSteps: maxFrames });
  const stepCount = Math.max(0, history.length - 1); // 변이(스텝) 수
  const subFrames = SUB_FRAMES_PER_STEP;
  const totalFrames = 1 + stepCount * subFrames; // 첫 정적 프레임 + 변이당 보간 프레임
  const delayCs = Math.max(2, Math.round(frameMs / 10));
  const bounds = paddedBounds(w, h);

  const chunks = [];
  chunks.push(headerBytes(w, h));

  // 첫 프레임: 초기 AST 를 통째로 그린다 (스텝 0 의 정적 모습).
  offRenderer.setLayout(layoutTreemap(history[0], bounds));
  {
    const pixels = readPixels(ctx, w, h);
    const { palette, indices } = buildPaletteAndIndices(pixels);
    const lzw = lzwEncode(indices);
    chunks.push(graphicControlBytes(delayCs));
    chunks.push(imageDescriptorBytes(w, h));
    chunks.push(localColorTableBytes(palette));
    // ponytail: GIF89a §Image Data — 섹션은 반드시 [LZW min code size] 바이트로 시작.
    // 빠지면 첫 sub-block 길이(또는 종결 0)가 min code size 로 읽혀 디코더가 깨진다.
    chunks.push(new Uint8Array([MIN_CODE_SIZE]));
    chunks.push(packSubBlocks(lzw));
    onProgress?.(1, totalFrames);
  }

  // 변이 프레임: 각 (old, new) 쌍에서 subFrames 개 만큼 보간 샘플.
  for (let i = 0; i < stepCount; i++) {
    const oldAst = history[i];
    const newAst = history[i + 1];
    const redex = reduceStep(oldAst).redex;
    if (!redex) continue;
    const ctxFrame = buildFrameContext({
      oldAst,
      newAst,
      redex,
      bounds,
    });
    if (!ctxFrame) continue;
    for (let k = 0; k < subFrames; k++) {
      // e = 1/4, 2/4, 3/4, 1 — 마지막은 다음 스텝의 e=0(=history[i+1])과 동일.
      const e = (k + 1) / subFrames;
      const { tree, ghosts } = computeFrame(ctxFrame, e);
      offRenderer.renderMorph(tree, ghosts);
      const pixels = readPixels(ctx, w, h);
      const { palette, indices } = buildPaletteAndIndices(pixels);
      const lzw = lzwEncode(indices);
      chunks.push(graphicControlBytes(delayCs));
      chunks.push(imageDescriptorBytes(w, h));
      chunks.push(localColorTableBytes(palette));
      chunks.push(new Uint8Array([MIN_CODE_SIZE]));
      chunks.push(packSubBlocks(lzw));
      onProgress?.(1 + i * subFrames + k + 1, totalFrames);
    }
  }

  chunks.push(new Uint8Array([0x3b])); // trailer
  const blob = new Blob(chunks, { type: 'image/gif' });
  downloadBlob(blob, `lambda-treemap-reduction-${w}x${h}-${timestamp()}.gif`);
}