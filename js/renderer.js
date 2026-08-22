// canvas 렌더러: treemap 레이아웃 트리를 canvas에 그린다.
// - var: 바인딩 색으로 채운 사각형 (충분히 크면 변수명 표시)
// - lambda: 테두리만 (테두리 색 = 바인딩 색 → 안의 변수 셀과 색이 대응)
// - app: 자체적으로 그리는 것 없음, func/arg가 영역을 나눠 채움

export class TreemapRenderer {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.layout = null;
    this._syncSize();
  }

  /** CSS 크기와 devicePixelRatio에 맞춰 비트맵 크기를 갱신한다. */
  _syncSize() {
    const dpr = window.devicePixelRatio || 1;
    const css = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(css.width));
    const h = Math.max(1, Math.round(css.height));
    const bitmapW = Math.round(w * dpr);
    const bitmapH = Math.round(h * dpr);
    if (this.canvas.width !== bitmapW || this.canvas.height !== bitmapH) {
      this.canvas.width = bitmapW;
      this.canvas.height = bitmapH;
    }
    this.dpr = dpr;
    this.w = w;
    this.h = h;
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

  draw() {
    const { ctx, dpr, w, h } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // 패널 배경
    ctx.fillStyle = '#171a20';
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
        const { ctx } = this;
        const lineWidth = Math.max(1.5, Math.min(3, Math.min(r.w, r.h) * 0.05));
        ctx.strokeStyle = cell.color;
        ctx.lineWidth = lineWidth;
        // 선이 셀 영역 안쪽에 그려지도록 반 폭만 안으로 당긴다
        const half = lineWidth / 2;
        ctx.strokeRect(
          r.x + half,
          r.y + half,
          Math.max(0, r.w - lineWidth),
          Math.max(0, r.h - lineWidth)
        );
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
    if (rect.w < 28 || rect.h < 14) {
      return;
    }
    const { ctx } = this;
    ctx.font = '12px ui-monospace, monospace';
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
