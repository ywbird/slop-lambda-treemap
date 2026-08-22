// 앱 진입점: 각 단계에서 모듈을 연결한다.
// 현재(2단계): 파싱 버튼 → AST를 콘솔에 트리 덤프, 에러는 화면에 표시.

import { parse } from './parser.js';
import { dumpAst } from './ast.js';

const input = document.getElementById('expr-input');
const parseBtn = document.getElementById('parse-btn');
const errorEl = document.getElementById('error');

parseBtn.addEventListener('click', () => {
  errorEl.textContent = '';
  try {
    const ast = parse(input.value);
    console.log(dumpAst(ast));
  } catch (e) {
    errorEl.textContent = e.message;
  }
});
