// 베타 축약: 자유 변수 계산, 캡처 회피 대입(substitution), 알파 변환,
// normal order(최외각/최좌측 redex 우선) 한 단계 축약, 전체 축약 루프.
// 모든 함수는 기존 AST를 변경하지 않고 새 노드를 반환한다(불변).

import { Var, Lambda, App } from './ast.js';

/**
 * 식의 자유 변수 이름 집합을 반환한다.
 * @param {object} node
 * @returns {Set<string>}
 */
export function freeVariables(node) {
  switch (node.type) {
    case 'var':
      return new Set([node.name]);
    case 'lambda': {
      const free = freeVariables(node.body);
      free.delete(node.param);
      return free;
    }
    case 'app': {
      const free = freeVariables(node.func);
      for (const name of freeVariables(node.arg)) {
        free.add(name);
      }
      return free;
    }
    default:
      throw new Error(`알 수 없는 노드 타입: ${node.type}`);
  }
}

/**
 * taken에 없는 새 이름을 만든다. 예: y → y1 → y2
 * @param {string} base
 * @param {Set<string>} taken
 * @returns {string}
 */
export function freshName(base, taken) {
  if (!taken.has(base)) {
    return base;
  }
  for (let k = 1; ; k++) {
    const candidate = `${base}${k}`;
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
}

/**
 * 캡처 회피 대입: expr에서 자유 변수 name을 replacement로 치환한다.
 * 치환 시 이름이 가려지면(shadowing) 그 아래는 무시하고,
 * 대입 결과에서 파라미터 이름이 가려질 위험이 있으면 알파 변환한다.
 * @param {object} expr
 * @param {string} name
 * @param {object} replacement
 * @returns {object} 새 AST
 */
export function subst(expr, name, replacement) {
  switch (expr.type) {
    case 'var':
      return expr.name === name ? replacement : expr;
    case 'app':
      return App(
        subst(expr.func, name, replacement),
        subst(expr.arg, name, replacement)
      );
    case 'lambda': {
      if (expr.param === name) {
        return expr; // 파라미터가 이름을 가림 → 이 아래로는 치환하지 않음
      }
      const replacementFree = freeVariables(replacement);
      if (replacementFree.has(expr.param)) {
        // 그대로 대입하면 replacement의 자유 변수가 이 λ에 붙잡힌다 → 알파 변환
        // 이름은 바뀌어도 같은 바인딩이므로 bindingId는 유지한다(색 안정성).
        const taken = new Set([
          ...freeVariables(expr.body),
          ...replacementFree,
        ]);
        const fresh = freshName(expr.param, taken);
        const renamedBody = subst(expr.body, expr.param, Var(fresh));
        return Lambda(fresh, subst(renamedBody, name, replacement), expr.bindingId);
      }
      return Lambda(expr.param, subst(expr.body, name, replacement), expr.bindingId);
    }
    default:
      throw new Error(`알 수 없는 노드 타입: ${expr.type}`);
  }
}

/**
 * 한 단계 축약 (normal order: 최외각/최좌측 redex를 먼저 축약,
 * 추상화 body 내부의 redex도 축약한다).
 * @param {object} node
 * @returns {{reduced: boolean, expr: object,
 *            redex?: {app: object, param: string, arg: object}}}
 *   redex.app은 축약된 원본 app 노드(애니메이션에서 이전 트리 탐색에 사용).
 */
export function reduceStep(node) {
  switch (node.type) {
    case 'var':
      return { reduced: false, expr: node };

    case 'app': {
      if (node.func.type === 'lambda') {
        // 이 노드 자체가 최외각 redex
        return {
          reduced: true,
          expr: subst(node.func.body, node.func.param, node.arg),
          redex: { app: node, param: node.func.param, arg: node.arg },
        };
      }
      const left = reduceStep(node.func);
      if (left.reduced) {
        return { reduced: true, expr: App(left.expr, node.arg), redex: left.redex };
      }
      const right = reduceStep(node.arg);
      if (right.reduced) {
        return { reduced: true, expr: App(node.func, right.expr), redex: right.redex };
      }
      return { reduced: false, expr: node };
    }

    case 'lambda': {
      const body = reduceStep(node.body);
      if (body.reduced) {
        return {
          reduced: true,
          expr: Lambda(node.param, body.expr, node.bindingId),
          redex: body.redex,
        };
      }
      return { reduced: false, expr: node };
    }

    default:
      throw new Error(`알 수 없는 노드 타입: ${node.type}`);
  }
}

/**
 * 정규형에 도달하거나 최대 스텝 수에 도달할 때까지 축약한다.
 * @param {object} expr
 * @param {{maxSteps?: number}} [options]
 * @returns {{expr: object, steps: number,
 *            terminated: 'normal-form'|'max-steps', history: object[]}}
 */
export function reduceAll(expr, { maxSteps = 1000 } = {}) {
  let current = expr;
  let steps = 0;
  const history = [expr];

  while (steps < maxSteps) {
    const result = reduceStep(current);
    if (!result.reduced) {
      return { expr: current, steps, terminated: 'normal-form', history };
    }
    current = result.expr;
    steps++;
    history.push(current);
  }

  return { expr: current, steps, terminated: 'max-steps', history };
}
