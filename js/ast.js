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
