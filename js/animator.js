// 베타 축약 애니메이션:
// redex의 arg treemap을 복제해, func 내부에서 파라미터 변수에 해당하는
// 위치(들)로 위치+크기를 보간 이동시킨다. 완료 후 새 AST 레이아웃으로 교체는
// 호출자(main)의 onDone에서 수행한다.

import {
  layoutTreemap,
  findCellByNode,
  collectVarCellsByColorKey,
} from './treemap.js';

/** ease-in-out (cubic). t∈[0,1] → [0,1] */
export function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** 두 rect를 t 비율로 선형 보간한다. */
export function lerpRect(from, to, t) {
  const inv = 1 - t;
  return {
    x: from.x * inv + to.x * t,
    y: from.y * inv + to.y * t,
    w: from.w * inv + to.w * t,
    h: from.h * inv + to.h * t,
  };
}

export class ReductionAnimator {
  /** @param {import('./renderer.js').TreemapRenderer} renderer */
  constructor(renderer) {
    this.renderer = renderer;
    this._raf = null;
  }

  get running() {
    return this._raf !== null;
  }

  /**
   * redex 하나의 축약을 애니메이션한다.
   * @param {object} options
   * @param {object} options.oldAst 축약 전 AST (애니메이션 기준 레이아웃)
   * @param {{app: object, param: string, arg: object}} options.redex
   *   reduceStep이 반환한 redex 정보
   * @param {number} [options.durationMs=700]
   * @param {() => void} [options.onDone] 애니메이션 완료 콜백
   */
  animateRedex({ oldAst, redex, durationMs = 700, onDone }) {
    this.cancel();

    const { w, h } = this.renderer.getSize();
    const oldLayout = layoutTreemap(oldAst, { x: 0, y: 0, w, h });
    const appCell = findCellByNode(oldLayout, redex.app);

    // 레이아웃에서 대상을 못 찾는 등 구조가 어긋나면 애니메이션 없이 완료
    if (!appCell || appCell.kind !== 'app' || appCell.node.func.type !== 'lambda') {
      onDone?.();
      return;
    }

    // 목표: func 안에서 이 λ에 묶인 파라미터 발생 위치(들)
    const targets = collectVarCellsByColorKey(
      appCell.func,
      appCell.node.func.bindingId
    );
    const from = appCell.arg.rect;

    // 파라미터가 body에 등장하지 않으면 인자가 그냥 버려지는 경우 → 즉시 완료
    if (targets.length === 0) {
      this.renderer.setLayout(oldLayout);
      onDone?.();
      return;
    }

    const start = performance.now();
    const frame = (now) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = easeInOutCubic(t);

      // 배경: 축약 전 레이아웃 유지
      this.renderer.setLayout(oldLayout);
      // 복제: 각 목표 위치로 보간되는 rect로 arg를 다시 레이아웃해 그린다
      for (const target of targets) {
        const rect = lerpRect(from, target.rect, eased);
        this.renderer.drawOverlay(layoutTreemap(redex.arg, rect));
      }

      if (t < 1) {
        this._raf = requestAnimationFrame(frame);
        return;
      }
      this._raf = null;
      onDone?.();
    };
    this._raf = requestAnimationFrame(frame);
  }

  cancel() {
    if (this._raf !== null) {
      cancelAnimationFrame(this._raf);
      this._raf = null;
    }
  }
}
