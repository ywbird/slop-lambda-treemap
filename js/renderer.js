// canvas 렌더러: treemap 레이아웃 트리를 canvas에 그린다.
// - var: 바인딩 색으로 채운 사각형 (충분히 크면 변수명 표시)
// - lambda: 테두리만 (테두리 색 = 바인딩 색 → 안의 변수 셀과 색이 대응),
//   굵기는 간격(cellGap)과 동일
// - app: 자체적으로 그리는 것 없음, func/arg가 영역을 나눠 채움

import { cellGap } from './treemap.js';

/** :root의 --canvas-bg 변수 값을 읽는다(트리맵 배경). 없으면 흰색. */
export function cssBg() {
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue('--canvas-bg')
    .trim();
  return v || '#ffffff';
}

export class TreemapRenderer {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.layout = null;
    this.background = cssBg();
    this._syncSize();
  }

  /** CSS 크기와 devicePixelRatio에 맞춰 비트맵 크기를 갱신한다. */
  _syncSize() {
    const dpr = window.devicePixelRatio || 1;
    let w, h;
    if (typeof this.canvas.getBoundingClientRect === 'function') {
      const css = this.canvas.getBoundingClientRect();
      w = Math.max(1, Math.round(css.width));
      h = Math.max(1, Math.round(css.height));
    } else {
      // OffscreenCanvas: 레이아웃 정보가 없으므로 기존 비트맵 크기를 CSS 크기로 사용.
      w = Math.max(1, this.canvas.width);
      h = Math.max(1, this.canvas.height);
    }
    const bitmapW = Math.round(w * dpr);
    const bitmapH = Math.round(h * dpr);
    if (this.canvas.width !== bitmapW || this.canvas.height !== bitmapH) {
      this.canvas.width = bitmapW;
      this.canvas.height = bitmapH;
    }
    this.dpr = dpr;
    this.w = w;
    this.h = h;
    this.background = cssBg();
  }

  /** 테마 전환 시 배경색을 갱신하고 다시 그린다. */
  applyTheme() {
    this.background = cssBg();
    this.draw();
  }

  /**
   * 외부에서 크기와 dpr을 강제 설정한다 (오프스크린 캔버스용).
   * ponytail: GIF 내보내기 외엔 쓸 일 없음.
   */
  setSize(w, h, dpr = 1) {
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
  }

  /** canvas의 CSS 픽셀 크기 (레이아웃 rect 계산용) */
  getSize() {
    return { w: this.w, h: this.h };
  }

  /** 창 크기 변화 후 호출: 크기 재동기화 후 현재 레이아웃 다시 그리기 */
  handleResize() {
    this._syncSize();
    this.draw();
  }

  setLayout(layout) {
    this.layout = layout;
    this.draw();
  }

  clear() {
    this.layout = null;
    this.draw();
  }

  /**
   * 애니메이션 프레임용: 배경 위에 보간된 셀 트리를 그리고 고스트를 얹는다.
   * - var 고스트(치환 슬롯): 트리 아래에 그려짐 — 복제본이 위를 덮으며 슬롯은 fade out
   * - λ 고스트(소비되는 테두리): 트리 위에 fade out
   * ghost.rect를 주면 셀 원래 rect 대신 그 위치에 그린다(슬롯 이동용).
   * @param {object} tree morph 중간 셀 트리
   * @param {{cell: object, alpha: number, rect?: object}[]} [ghosts]
   */
  renderMorph(tree, ghosts = []) {
    this.layout = null;
    this.draw();
    for (const ghost of ghosts) {
      if (ghost.cell.kind === 'var') {
        this._drawGhost(ghost);
      }
    }
    this._drawCell(tree);
    for (const ghost of ghosts) {
      if (ghost.cell.kind !== 'var') {
        this._drawGhost(ghost);
      }
    }
  }

  _drawGhost(ghost) {
    const r = ghost.rect ?? ghost.cell.rect;
    this.ctx.save();
    // 오버슈트 보간(back-out 등)에서 eased가 1을 넘어 alpha가 범위를 벗어나지 않게
    this.ctx.globalAlpha = Math.max(0, Math.min(1, ghost.alpha));
    if (ghost.cell.kind === 'var') {
      this.ctx.fillStyle = ghost.cell.color;
      this.ctx.fillRect(r.x, r.y, r.w, r.h);
      this._drawLabel(ghost.cell.node.name, r);
    } else if (ghost.cell.kind === 'lambda') {
      this._drawLambdaBorder(ghost.cell, r);
    }
    this.ctx.restore();
  }

  /** λ 셀의 테두리를 그린다. 굵기는 셀 간 간격과 동일한 공식(cellGap). */
  _drawLambdaBorder(cell, rect) {
    const { ctx } = this;
    const lineWidth = cellGap(rect);
    const half = lineWidth / 2;
    ctx.strokeStyle = cell.color;
    ctx.lineWidth = lineWidth;
    ctx.strokeRect(
      rect.x + half,
      rect.y + half,
      Math.max(0, rect.w - lineWidth),
      Math.max(0, rect.h - lineWidth)
    );
  }

  draw() {
    const { ctx, dpr, w, h } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // 패널 배경 (네오브루탈리즘 색 — 테마에 따라 밝음/어두움)
    ctx.fillStyle = this.background;
    ctx.fillRect(0, 0, w, h);
    if (this.layout) {
      this._drawCell(this.layout);
    }
  }

  _drawCell(cell) {
    const r = cell.rect;
    switch (cell.kind) {
      case 'var': {
        this.ctx.fillStyle = cell.color;
        this.ctx.fillRect(r.x, r.y, r.w, r.h);
        this._drawLabel(cell.node.name, r);
        break;
      }
      case 'lambda': {
        this._drawLambdaBorder(cell, r);
        this._drawCell(cell.body);
        break;
      }
      case 'app': {
        this._drawCell(cell.func);
        this._drawCell(cell.arg);
        break;
      }
      default:
        throw new Error(`알 수 없은 셀 종류: ${cell.kind}`);
    }
  }

  /** 셀이 충분히 크면 가운데에 텍스트를 그린다(가독성용 외곽선 포함). */
  _drawLabel(text, rect) {
    if (rect.w < 32 || rect.h < 16) {
      return;
    }
    const { ctx } = this;
    ctx.font = '14px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const x = rect.x + rect.w / 2;
    const y = rect.y + rect.h / 2;
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, x, y);
  }
}
