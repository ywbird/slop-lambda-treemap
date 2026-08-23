// 베타 축약 애니메이션 (레이아웃 morph 방식):
//
// 축약 전/후 AST를 같은 영역에 레이아웃하고, 두 레이아웃 트리를 구조적으로
// 짝지어 각 셀의 rect를 보간한 "중간 레이아웃"을 매 프레임 그린다.
//   - 변수 자리에 인자 서브트리가 들어온 곳: 인자의 이전 레이아웃(argCell)을
//     시작점으로 삼아 새 위치로 복제 비행 (원본 arg는 더 이상 그리지 않음)
//   - 그 외(λ body 나머지, 주변 식): 축약 전 rect → 축약 후 rect로 보간되어
//     인자가 차지하던 공간을 포함한 전체 영역으로 자연스럽게 확장
//   - 소비되는 λ 테두리는 페이드아웃 (고스트)

import {
  layoutTreemap,
  findCellByNode,
  collectVarCellsByColorKey,
  collectCellsByNode,
} from './treemap.js';

/** ease-in-out (cubic). t∈[0,1] → [0,1] */
export function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * 애니메이션 보간 함수 목록 (UI 선택용). 모두 f(0)=0, f(1)=1.
 * back-out/elastic-out은 중간에 목표를 넘어섰다 돌아온다.
 */
function bounceOut(t) {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (t < 1 / d1) {
    return n1 * t * t;
  } else if (t < 2 / d1) {
    return n1 * (t -= 1.5 / d1) * t + 0.75;
  } else if (t < 2.5 / d1) {
    return n1 * (t -= 2.25 / d1) * t + 0.9375;
  }
  return n1 * (t -= 2.625 / d1) * t + 0.984375;
}

export const EASINGS = {
  linear: (t) => t,
  'ease-in': (t) => t * t * t,
  'ease-out': (t) => 1 - Math.pow(1 - t, 3),
  'ease-in-out': easeInOutCubic,
  'back-out': (t) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  'bounce-out': bounceOut,
  'elastic-out': (t) => {
    if (t === 0 || t === 1) {
      return t;
    }
    const c4 = (2 * Math.PI) / 3;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
  },
};

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
 * 대입이 일어난 자리(oldCell이 redex λ에 묶인 파라미터 변수)에서는 인자의
 * 이전 레이아웃(argCell)에서 시작하는 복제 비행으로 처리한다.
 * @param {object} oldCell
 * @param {object} newCell
 * @param {number} e
 * @param {object} argCell redex 인자의 축약 전 레이아웃 (복제 시작점)
 * @param {number} [paramKey] redex λ의 bindingId (대입 지점 감지용)
 */
export function morphTree(oldCell, newCell, e, argCell, paramKey) {
  // 인자가 변수여도(var→var) 대입 지점은 복제 비행이어야 하므로
  // 종류가 아니라 색 키(바인딩 ID)로 대입 지점을 감지한다.
  if (
    oldCell &&
    oldCell.kind === 'var' &&
    argCell &&
    paramKey !== undefined &&
    oldCell.colorKey === paramKey
  ) {
    return morphTree(argCell, newCell, e, argCell);
  }
  if (!oldCell || oldCell.kind !== newCell.kind) {
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
        body: morphTree(oldCell.body, newCell.body, e, argCell, paramKey),
      };
    case 'app':
      return {
        ...newCell,
        rect,
        func: morphTree(oldCell.func, newCell.func, e, argCell, paramKey),
        arg: morphTree(oldCell.arg, newCell.arg, e, argCell, paramKey),
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
 * @param {number} paramKey redex λ의 bindingId
 */
export function morphAlong(oldCell, newCell, path, e, argCell, paramKey) {
  if (path.length === 0) {
    // redex 위치: 소비되는 λ의 body가 새 내용과 짝을 이룬다
    return morphTree(oldCell.func.body, newCell, e, argCell, paramKey);
  }
  const [head, ...rest] = path;
  const rect = lerpRect(oldCell.rect, newCell.rect, e);
  const result = { ...newCell, rect };
  for (const key of ['body', 'func', 'arg']) {
    if (newCell[key] !== undefined) {
      result[key] =
        head === key
          ? morphAlong(oldCell[key], newCell[key], rest, e, argCell, paramKey)
          : morphTree(oldCell[key], newCell[key], e, argCell, paramKey);
    }
  }
  return result;
}

/**
 * redex의 파라미터 변수가 축약 전 레이아웃에서 차지하던 셀(치환 대상) 목록.
 * 애니메이션 동안 이 셀들을 그대로 그렸다가(고스트) 보간이 끝나면 사라지게
 * 해서, 복제본이 도착하기 전에 슬롯이 먼저 비어 보이지 않게 한다.
 * @param {object} oldLayout 축약 전 전체 레이아웃
 * @param {{app: object}} redex
 * @returns {object[]} var 셀 배열
 */
export function redexTargets(oldLayout, redex) {
  const appCell = findCellByNode(oldLayout, redex.app);
  if (!appCell || appCell.kind !== 'app' || appCell.node.func.type !== 'lambda') {
    return [];
  }
  return collectVarCellsByColorKey(
    appCell.func.body,
    appCell.node.func.bindingId
  );
}

/**
 * 치환 슬롯(옛 변수 셀)과 새 레이아웃에서 대응하는 인자 복제본 셀을 짝짓는다.
 * 슬롯 고스트가 body 확장을 따라 옛 위치 → 도착 위치로 보간되게 한다.
 * 두 컬렉션 모두 구조 순서(pre-order)라 첫째부터 인덱스로 대응된다.
 * @param {object} oldLayout 축약 전 전체 레이아웃
 * @param {object} newLayout 축약 후 전체 레이아웃
 * @param {string[]} path pathToNode(oldAst, redex.app)
 * @param {{app: object, arg: object}} redex
 * @returns {{slot: object, dest: object}[]}
 */
export function slotMorphs(oldLayout, newLayout, path, redex) {
  const targets = redexTargets(oldLayout, redex);
  if (targets.length === 0) {
    return [];
  }
  let region = newLayout;
  for (const key of path) {
    region = region[key];
  }
  const destinations = collectCellsByNode(region, redex.arg);
  return targets.map((slot, i) => ({ slot, dest: destinations[i] ?? slot }));
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
   * @param {(t: number) => number} [options.easing=easeInOutCubic]
   *   EASINGS의 보간 함수
   * @param {() => void} [options.onDone] 완료 콜백
   */
  animateRedex({ oldAst, newAst, redex, durationMs = 700, easing = easeInOutCubic, onDone }) {
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

    // 대입 지점 감지용: redex λ의 색 키(바인딩 ID)
    const paramKey = redex.app.func.bindingId;

    // 소비되는 λ: 테두리만 페이드아웃하는 고스트
    const ghost = { cell: appCell.func, alpha: 1 };
    // 치환 슬롯: body 확장을 따라 이동하며 트리 아래에서 fade out
    const slots = slotMorphs(oldLayout, newLayout, path, redex);

    const start = performance.now();
    const frame = (now) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = easing(t);
      const tree = morphAlong(oldLayout, newLayout, path, eased, appCell.arg, paramKey);
      const ghosts = [{ cell: ghost.cell, alpha: 1 - eased }];
      for (const { slot, dest } of slots) {
        ghosts.push({
          cell: slot,
          alpha: 1 - eased,
          rect: lerpRect(slot.rect, dest.rect, eased),
        });
      }
      this.renderer.renderMorph(tree, ghosts);
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
