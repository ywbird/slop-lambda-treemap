// 앱 진입점: 각 단계에서 모듈을 연결한다.
// 현재(3단계): 파싱 버튼 → pretty-print 식을 상태 영역에, AST 트리는 콘솔에,
//              에러는 화면에 표시.

import { parse } from './parser.js';
import { dumpAst, exprToString } from './ast.js';

const input = document.getElementById('expr-input');
const parseBtn = document.getElementById('parse-btn');
const statusEl = document.getElementById('status');
const errorEl = document.getElementById('error');

parseBtn.addEventListener('click', () => {
  errorEl.textContent = '';
  statusEl.textContent = '';
  try {
    const ast = parse(input.value);
    statusEl.textContent = exprToString(ast);
    console.log(dumpAst(ast));
  } catch (e) {
    errorEl.textContent = e.message;
  }
});
