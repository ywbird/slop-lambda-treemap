// 앱 진입점: 파싱 → AST 저장 → 한 스텝 축약 반복, 트리맵 렌더링.
// (자동 축약/애니메이션은 이후 단계에서 연결)

import { parse } from './parser.js';
import { dumpAst, exprToString } from './ast.js';
import { reduceStep } from './reducer.js';
import { layoutTreemap } from './treemap.js';
import { TreemapRenderer } from './renderer.js';

const input = document.getElementById('expr-input');
const parseBtn = document.getElementById('parse-btn');
const stepBtn = document.getElementById('step-btn');
const resetBtn = document.getElementById('reset-btn');
const statusEl = document.getElementById('status');
const errorEl = document.getElementById('error');

const renderer = new TreemapRenderer(document.getElementById('treemap-canvas'));

const state = { ast: null, steps: 0 };

function render() {
  if (state.ast) {
    const suffix = state.steps > 0 ? `  (${state.steps}단계 축약)` : '';
    statusEl.textContent = exprToString(state.ast) + suffix;
  } else {
    statusEl.textContent = '';
  }
  stepBtn.disabled = state.ast === null;
}

function refreshTreemap() {
  if (!state.ast) {
    renderer.clear();
    return;
  }
  const { w, h } = renderer.getSize();
  renderer.setLayout(layoutTreemap(state.ast, { x: 0, y: 0, w, h }));
}

parseBtn.addEventListener('click', () => {
  errorEl.textContent = '';
  try {
    state.ast = parse(input.value);
    state.steps = 0;
    render();
    refreshTreemap();
    console.log(dumpAst(state.ast));
  } catch (e) {
    state.ast = null;
    errorEl.textContent = e.message;
    render();
    refreshTreemap();
  }
});

stepBtn.addEventListener('click', () => {
  if (!state.ast) return;
  errorEl.textContent = '';
  const result = reduceStep(state.ast);
  if (result.reduced) {
    state.ast = result.expr;
    state.steps++;
    render();
    refreshTreemap();
  } else {
    statusEl.textContent = `${exprToString(state.ast)}  (정규형 — 더 이상 축약 불가)`;
  }
});

resetBtn.addEventListener('click', () => {
  state.ast = null;
  state.steps = 0;
  input.value = '';
  errorEl.textContent = '';
  render();
  refreshTreemap();
});

window.addEventListener('resize', () => {
  renderer.handleResize();
  refreshTreemap();
});
