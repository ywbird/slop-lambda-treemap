// 트리맵 레이아웃: AST → 사각형(rect) 트리 + 바인딩 기반 고유 색.
//
// 추상화는 "테두리를 가진 body"가 통째로 하나의 노드다:
// - 변수(var): 자신을 묶은 λ의 bindingId(자유 변수면 이름) 기반 고유 색 셀
// - 추상화(lambda): 테두리만 그리는 하나의 노드 셀. body는 테두리 안쪽에
//   배치되며, 교차 분할에서 λ가 한 단계로 반영된다(부모가 좌우면 body 내부
//   분할은 상하 — body를 깊이+1로 배치).
// - 적용(app): func(대상 식)과 arg(대입 식)을 깊이 홀짝에 따라 좌우/상하 분할.
// 면적은 노드 수 비율로 분배하고, 형제 셀 간격은 모든 깊이·모든 인접에서
// 균일한 상수(CELL_GAP)를 쓴다.

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
 * 서브트리의 노드 수(면적 가중치). 변수 리프가 1씩 기여하고,
 * 추상화는 래퍼일 뿐 추가 단위가 아니므로 body만 센다.
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

// 셀 간 간격(형제 노드 사이), λ 테두리-본문 패딩, λ 테두리 굵기 — 모두 같은 공식.
// 같은 크기의 영역에서는 모두 정확히 같은 값이다.
// (크기 비례 5%, 상한 8, 하한 1)
export function cellGap(rect) {
  return Math.max(1, Math.min(8, Math.min(rect.w, rect.h) * 0.05));
}

// vertically=true면 좌우 분할(func=왼쪽), 아니면 상하 분할(func=위쪽).
// 자식 사이에 gap만큼 빈 간격을 둔다(λ 패딩과 동일한 공식).
function splitRect(rect, ratio, vertically, gap) {
  if (vertically) {
    const usable = Math.max(0, rect.w - gap);
    const funcW = usable * ratio;
    return [
      { x: rect.x, y: rect.y, w: funcW, h: rect.h },
      { x: rect.x + funcW + gap, y: rect.y, w: usable - funcW, h: rect.h },
    ];
  }
  const usable = Math.max(0, rect.h - gap);
  const funcH = usable * ratio;
  return [
    { x: rect.x, y: rect.y, w: rect.w, h: funcH },
    { x: rect.x, y: rect.y + funcH + gap, w: rect.w, h: usable - funcH },
  ];
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
      // 추상화는 "테두리를 가진 body"가 하나의 노드: 이 셀 자체가 원자적이다.
      // body는 테두리 굵기(cellGap) + 테두리-본문 여백(cellGap)만큼 안쪽에,
      // 깊이 +1로 배치해 교차 분할(가로/세로 번갈아)에 추상화가 한 단계로
      // 반영되게 한다. 즉 테두리와 body 사이 여백이 노드 간 간격과 같다.
      return {
        kind: 'lambda',
        node,
        rect,
        bindingId: node.bindingId,
        color: colorForKey(node.bindingId),
        body: layout(node.body, insetRect(rect, cellGap(rect) * 2), depth + 1, childEnv),
      };
    }
    case 'app': {
      const funcWeight = weightOf(node.func);
      const argWeight = weightOf(node.arg);
      // 형제 셀 간격은 λ 패딩과 같은 공식(cellGap) — 어떤 인접이든 동일 기준
      const [funcRect, argRect] = splitRect(
        rect,
        funcWeight / (funcWeight + argWeight),
        depth % 2 === 0,
        cellGap(rect)
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
 * 식을 트리맵과 같은 색 규칙으로 색칠한 텍스트 세그먼트로 변환한다.
 * - 묶인 변수 / λ 파라미터: 해당 바인딩의 색 (트리맵 셀·테두리와 동일)
 * - 자유 변수: 'free:이름' 키의 색
 * - 괄호/공백/λ 기호 등 구분자: 무색 (color 없음)
 * 세그먼트를 이어 붙이면 exprToString과 같은 문자열이 된다.
 * @param {object} node
 * @param {Map<string, number>} env
 * @returns {{text: string, color?: string}[]}
 */
export function exprToSegments(node, env = new Map()) {
  switch (node.type) {
    case 'var': {
      const bindingId = env.get(node.name);
      const key = bindingId !== undefined ? bindingId : FREE_PREFIX + node.name;
      return [{ text: node.name, color: colorForKey(key) }];
    }
    case 'lambda': {
      const segments = [{ text: 'λ' }];
      const scope = new Map(env);
      let current = node;
      while (true) {
        scope.set(current.param, current.bindingId);
        segments.push({ text: current.param, color: colorForKey(current.bindingId) });
        if (current.body.type === 'lambda') {
          segments.push({ text: ' ' });
          current = current.body;
        } else {
          break;
        }
      }
      segments.push({ text: '. ' });
      segments.push(...exprToSegments(current.body, scope));
      return segments;
    }
    case 'app': {
      const segments = [];
      if (node.func.type === 'lambda') {
        segments.push({ text: '(' }, ...exprToSegments(node.func, env), { text: ') ' });
      } else {
        segments.push(...exprToSegments(node.func, env), { text: ' ' });
      }
      if (node.arg.type === 'var') {
        segments.push(...exprToSegments(node.arg, env));
      } else {
        segments.push({ text: '(' }, ...exprToSegments(node.arg, env), { text: ')' });
      }
      return segments;
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
