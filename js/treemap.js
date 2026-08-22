// 트리맵 레이아웃: AST → 사각형(rect) 트리 + 바인딩 기반 고유 색.
//
// 렌더링 규칙(5단계 renderer가 이 트리를 그린다):
// - 변수(var): 자신을 묶은 λ의 bindingId(자유 변수면 이름) 기반 고유 색 셀
// - 추상화(lambda): 테두리만 그리는 셀, body는 패딩 안쪽에 배치
// - 적용(app): func(대상 식)과 arg(대입 식)을 깊이 홀짝에 따라 좌우/상하 분할.
//   면적은 서브트리의 변수 리프 수(가중치) 비율로 분배한다.

const FREE_PREFIX = 'free:';

function hashString(str) {
  let h = 0;
  for (const ch of str) {
    h = (Math.imul(h, 31) + ch.codePointAt(0)) | 0;
  }
  // 비트 확산(finalizer): 약한 다항 해시에서 입력이 조금만 달라도
  // hue가 1~2도 차이로 몰려 시각적으로 같은 색이 되는 문제를 방지한다.
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * 색 키(바인딩 ID 또는 'free:이름')를 안정적인 hsl 색으로 변환한다.
 * 같은 키는 항상 같은 색이므로 축약 전후 색이 유지된다.
 * @param {number|string} key
 * @returns {string} hsl() 색 문자열
 */
export function colorForKey(key) {
  const hue = hashString(String(key)) % 360;
  return `hsl(${hue}, 65%, 55%)`;
}

/**
 * 서브트리의 변수 리프 수 — 면적 분배 가중치.
 * λ 파라미터 자체는 셀이 아니므로 body만 센다.
 * @param {object} node
 * @returns {number}
 */
export function weightOf(node) {
  switch (node.type) {
    case 'var':
      return 1;
    case 'lambda':
      return weightOf(node.body);
    case 'app':
      return weightOf(node.func) + weightOf(node.arg);
    default:
      throw new Error(`알 수 없는 노드 타입: ${node.type}`);
  }
}

function insetRect(rect, pad) {
  return {
    x: rect.x + pad,
    y: rect.y + pad,
    w: Math.max(0, rect.w - pad * 2),
    h: Math.max(0, rect.h - pad * 2),
  };
}

// vertically=true면 좌우 분할(func=왼쪽), 아니면 상하 분할(func=위쪽)
function splitRect(rect, ratio, vertically) {
  if (vertically) {
    const funcW = rect.w * ratio;
    return [
      { x: rect.x, y: rect.y, w: funcW, h: rect.h },
      { x: rect.x + funcW, y: rect.y, w: rect.w - funcW, h: rect.h },
    ];
  }
  const funcH = rect.h * ratio;
  return [
    { x: rect.x, y: rect.y, w: rect.w, h: funcH },
    { x: rect.x, y: rect.y + funcH, w: rect.w, h: rect.h - funcH },
  ];
}

function lambdaPad(rect) {
  return Math.max(1, Math.min(8, Math.min(rect.w, rect.h) * 0.05));
}

function layout(node, rect, depth, env) {
  switch (node.type) {
    case 'var': {
      const bindingId = env.get(node.name);
      const colorKey = bindingId !== undefined ? bindingId : FREE_PREFIX + node.name;
      return { kind: 'var', node, rect, colorKey, color: colorForKey(colorKey) };
    }
    case 'lambda': {
      const childEnv = new Map(env);
      childEnv.set(node.param, node.bindingId);
      return {
        kind: 'lambda',
        node,
        rect,
        bindingId: node.bindingId,
        color: colorForKey(node.bindingId),
        body: layout(node.body, insetRect(rect, lambdaPad(rect)), depth + 1, childEnv),
      };
    }
    case 'app': {
      const funcWeight = weightOf(node.func);
      const argWeight = weightOf(node.arg);
      const [funcRect, argRect] = splitRect(
        rect,
        funcWeight / (funcWeight + argWeight),
        depth % 2 === 0
      );
      return {
        kind: 'app',
        node,
        rect,
        func: layout(node.func, funcRect, depth + 1, env),
        arg: layout(node.arg, argRect, depth + 1, env),
      };
    }
    default:
      throw new Error(`알 수 없는 노드 타입: ${node.type}`);
  }
}

/**
 * AST를 트리맵 레이아웃 트리로 변환한다.
 * @param {object} root AST 루트
 * @param {{x: number, y: number, w: number, h: number}} rect 전체 영역
 * @returns {object} kind별 셀 트리:
 *   var:    { kind, node, rect, colorKey, color }
 *   lambda: { kind, node, rect, bindingId, color, body }
 *   app:    { kind, node, rect, func, arg }
 */
export function layoutTreemap(root, rect) {
  return layout(root, rect, 0, new Map());
}

/**
 * 레이아웃 트리에서 AST 노드 참조가 일치하는 셀을 찾는다(애니메이션이
 * 이전 트리에서 redex 위치를 찾을 때 사용).
 * @returns {object|null}
 */
export function findCellByNode(root, node) {
  if (!root) {
    return null;
  }
  if (root.node === node) {
    return root;
  }
  switch (root.kind) {
    case 'lambda':
      return findCellByNode(root.body, node);
    case 'app':
      return findCellByNode(root.func, node) ?? findCellByNode(root.arg, node);
    default:
      return null;
  }
}

/**
 * 서브트리에서 특정 색 키(바인딩 ID)를 가진 변수 셀을 전부 수집한다.
 * 축약 애니메이션이 파라미터 변수의 목표 위치(들)를 찾을 때 사용.
 * 같은 이름을 재바인딩하는 내부 λ는 다른 색 키를 가지므로 자동으로 제외된다.
 * @returns {object[]}
 */
export function collectVarCellsByColorKey(root, key) {
  const found = [];
  function walk(cell) {
    if (!cell) {
      return;
    }
    if (cell.kind === 'var') {
      if (cell.colorKey === key) {
        found.push(cell);
      }
    } else if (cell.kind === 'lambda') {
      walk(cell.body);
    } else {
      walk(cell.func);
      walk(cell.arg);
    }
  }
  walk(root);
  return found;
}
