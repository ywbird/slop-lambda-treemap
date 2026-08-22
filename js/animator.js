// 베타 축약 애니메이션 (레이아웃 morph 방식):
//
// 축약 전/후 AST를 같은 영역에 레이아웃하고, 두 레이아웃 트리를 구조적으로
// 짝지어 각 셀의 rect를 보간한 "중간 레이아웃"을 매 프레임 그린다.
//   - 변수 자리에 인자 서브트리가 들어온 곳: 인자의 이전 레이아웃(argCell)을
//     시작점으로 삼아 새 위치로 복제 비행 (원본 arg는 더 이상 그리지 않음)
//   - 그 외(λ body 나머지, 주변 식): 축약 전 rect → 축약 후 rect로 보간되어
//     인자가 차지하던 공간을 포함한 전체 영역으로 자연스럽게 확장
//   - 소비되는 λ 테두리는 페이드아웃 (고스트)

import { layoutTreemap, findCellByNode } from './treemap.js';

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

/**
 * AST에서 target 노드까지의 자식 선택자 경로. 루트면 [], 없으면 null.
 * @returns {string[]|null}
 */
export function pathToNode(root, target) {
  const path = [];
  function walk(node) {
    if (node === target) {
      return true;
    }
    switch (node.type) {
      case 'app':
        for (const key of ['func', 'arg']) {
          path.push(key);
          if (walk(node[key])) {
            return true;
          }
          path.pop();
        }
        return false;
      case 'lambda':
        path.push('body');
        if (walk(node.body)) {
          return true;
        }
        path.pop();
        return false;
      default:
        return false;
    }
  }
  return walk(root) ? path : null;
}

/**
 * oldCell(축약 전 셀)과 newCell(축약 후 셀)을 짝지어 e 비율로 보간한 셀 트리.
 * 변수(var) 자리에 서브트리가 들어온 경우 인자의 이전 레이아웃(argCell)에서
 * 시작하는 복제 비행으로 처리한다.
 * @param {object} oldCell
 * @param {object} newCell
 * @param {number} e
 * @param {object} argCell redex 인자의 축약 전 레이아웃 (복제 시작점)
 */
export function morphTree(oldCell, newCell, e, argCell) {
  if (!oldCell || oldCell.kind !== newCell.kind) {
    if (oldCell && oldCell.kind === 'var' && argCell) {
      // 대입이 일어난 자리: 인자 전체가 이 위치로 복제된다
      return morphTree(argCell, newCell, e, argCell);
    }
    return newCell; // 대응을 못 찾으면 새 셀을 그대로 (안전 폴백)
  }
  const rect = lerpRect(oldCell.rect, newCell.rect, e);
  switch (newCell.kind) {
    case 'var':
      return { ...newCell, rect };
    case 'lambda':
      return {
        ...newCell,
        rect,
        body: morphTree(oldCell.body, newCell.body, e, argCell),
      };
    case 'app':
      return {
        ...newCell,
        rect,
        func: morphTree(oldCell.func, newCell.func, e, argCell),
        arg: morphTree(oldCell.arg, newCell.arg, e, argCell),
      };
    default:
      return newCell;
  }
}

/**
 * 루트부터 redex까지 경로를 따라가며 전체 레이아웃을 보간한다.
 * 경로 끝에서는 redex의 func(λ) body와 축약 결과를 짝짓는다.
 * @param {object} oldCell 축약 전 전체 레이아웃
 * @param {object} newCell 축약 후 전체 레이아웃
 * @param {string[]} path pathToNode(oldAst, redex.app)
 * @param {number} e
 * @param {object} argCell redex 인자의 축약 전 레이아웃
 */
export function morphAlong(oldCell, newCell, path, e, argCell) {
  if (path.length === 0) {
    // redex 위치: 소비되는 λ의 body가 새 내용과 짝을 이룬다
    return morphTree(oldCell.func.body, newCell, e, argCell);
  }
  const [head, ...rest] = path;
  const rect = lerpRect(oldCell.rect, newCell.rect, e);
  const result = { ...newCell, rect };
  for (const key of ['body', 'func', 'arg']) {
    if (newCell[key] !== undefined) {
      result[key] =
        head === key
          ? morphAlong(oldCell[key], newCell[key], rest, e, argCell)
          : morphTree(oldCell[key], newCell[key], e, argCell);
    }
  }
  return result;
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
   * redex 하나의 축약을 morph 애니메이션으로 보여준다.
   * @param {object} options
   * @param {object} options.oldAst 축약 전 AST
   * @param {object} options.newAst 축약 후 AST (reduceStep 결과)
   * @param {{app: object, param: string, arg: object}} options.redex
   * @param {number} [options.durationMs=700]
   * @param {() => void} [options.onDone] 완료 콜백
   */
  animateRedex({ oldAst, newAst, redex, durationMs = 700, onDone }) {
    this.cancel();

    const { w, h } = this.renderer.getSize();
    const bounds = { x: 0, y: 0, w, h };
    const oldLayout = layoutTreemap(oldAst, bounds);
    const newLayout = layoutTreemap(newAst, bounds);
    const path = pathToNode(oldAst, redex.app);
    const appCell = findCellByNode(oldLayout, redex.app);

    if (!path || !appCell || appCell.kind !== 'app') {
      onDone?.();
      return;
    }

    // 소비되는 λ: 테두리만 페이드아웃하는 고스트
    const ghost = { cell: appCell.func, alpha: 1 };

    const start = performance.now();
    const frame = (now) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = easeInOutCubic(t);
      const tree = morphAlong(oldLayout, newLayout, path, eased, appCell.arg);
      this.renderer.renderMorph(tree, [{ cell: ghost.cell, alpha: 1 - eased }]);
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
