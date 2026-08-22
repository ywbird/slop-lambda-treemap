// AST 노드 팩토리와 디버그 유틸.
// 노드 형태:
//   { type: 'var',    name }
//   { type: 'lambda', param, body }
//   { type: 'app',    func, arg }

export function Var(name) {
  return { type: 'var', name };
}

export function Lambda(param, body) {
  return { type: 'lambda', param, body };
}

export function App(func, arg) {
  return { type: 'app', func, arg };
}

/**
 * AST를 람다 대수 식 문자열로 되돌린다(괄호 최소화).
 * - 추상화 body에는 괄호가 필요 없다(식이 최대한 오른쪽으로 확장).
 * - func가 추상화인 적용, arg가 변수가 아닌 적용은 괄호로 묶는다.
 * @param {object} node
 * @returns {string}
 */
export function exprToString(node) {
  switch (node.type) {
    case 'var':
      return node.name;
    case 'lambda': {
      const params = [node.param];
      let body = node.body;
      while (body.type === 'lambda') {
        params.push(body.param);
        body = body.body;
      }
      return `λ${params.join(' ')}. ${exprToString(body)}`;
    }
    case 'app': {
      const func =
        node.func.type === 'lambda'
          ? `(${exprToString(node.func)})`
          : exprToString(node.func);
      const arg =
        node.arg.type === 'var'
          ? exprToString(node.arg)
          : `(${exprToString(node.arg)})`;
      return `${func} ${arg}`;
    }
    default:
      throw new Error(`알 수 없는 노드 타입: ${node.type}`);
  }
}

/**
 * AST를 들여쓰기 트리 문자열로 변환 (디버깅용 콘솔 출력).
 * @param {object} node
 * @param {string} indent
 * @returns {string}
 */
export function dumpAst(node, indent = '') {
  switch (node.type) {
    case 'var':
      return `${indent}var ${node.name}`;
    case 'lambda':
      return `${indent}lambda ${node.param}.\n${dumpAst(node.body, indent + '  ')}`;
    case 'app':
      return `${indent}app\n${dumpAst(node.func, indent + '  ')}\n${dumpAst(node.arg, indent + '  ')}`;
    default:
      throw new Error(`알 수 없는 노드 타입: ${node.type}`);
  }
}
