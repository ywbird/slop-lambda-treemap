// 앱 진입점: 파싱 → 한 스텝/자동 축약(애니메이션) → 트리맵 렌더링.

import { parse } from './parser.js';
import { dumpAst, exprToString } from './ast.js';
import { reduceStep } from './reducer.js';
import { layoutTreemap } from './treemap.js';
import { TreemapRenderer } from './renderer.js';
import { ReductionAnimator } from './animator.js';

const AUTO_MAX_STEPS = 200;
const AUTO_STEP_DELAY_MS = 180;

const input = document.getElementById('expr-input');
const parseBtn = document.getElementById('parse-btn');
const stepBtn = document.getElementById('step-btn');
const autoBtn = document.getElementById('auto-btn');
const resetBtn = document.getElementById('reset-btn');
const statusEl = document.getElementById('status');
const errorEl = document.getElementById('error');

const renderer = new TreemapRenderer(document.getElementById('treemap-canvas'));
const animator = new ReductionAnimator(renderer);

const state = {
  ast: null,
  steps: 0,
  animating: false,
  autoRunning: false,
};

function render() {
  if (state.ast) {
    const suffix = state.steps > 0 ? `  (${state.steps}단계 축약)` : '';
    statusEl.textContent = exprToString(state.ast) + suffix;
  } else {
    statusEl.textContent = '';
  }
}

function updateButtons() {
  const hasAst = state.ast !== null;
  // 한 스텝: AST가 있고 애니메이션/자동 진행 중이 아닐 때
  stepBtn.disabled = !hasAst || state.animating || state.autoRunning;
  // 자동: 실행 중에는 언제나 눌러 정지 가능, 그 외엔 AST가 있고 대기 중일 때
  autoBtn.disabled =
    (!hasAst && !state.autoRunning) || (state.animating && !state.autoRunning);
  autoBtn.textContent = state.autoRunning ? '정지' : '자동 축약';
  parseBtn.disabled = state.animating || state.autoRunning;
}

function refreshTreemap() {
  if (!state.ast) {
    renderer.clear();
    return;
  }
  const { w, h } = renderer.getSize();
  renderer.setLayout(layoutTreemap(state.ast, { x: 0, y: 0, w, h }));
}

/**
 * 한 스텝 축약을 커밋하고 애니메이션 후 새 레이아웃으로 교체한다.
 * 상태(expr, 스텝 수, 텍스트)는 즉시 갱신하고 화면은 onDone에서 교체.
 */
function commitStep(result, after) {
  const oldAst = state.ast;
  state.ast = result.expr;
  state.steps++;
  state.animating = true;
  render();
  updateButtons();
  animator.animateRedex({
    oldAst,
    redex: result.redex,
    onDone: () => {
      state.animating = false;
      refreshTreemap();
      updateButtons();
      after?.();
    },
  });
}

function stopEverything() {
  animator.cancel();
  state.animating = false;
  state.autoRunning = false;
}

parseBtn.addEventListener('click', () => {
  stopEverything();
  errorEl.textContent = '';
  try {
    state.ast = parse(input.value);
    state.steps = 0;
    render();
    refreshTreemap();
    updateButtons();
    console.log(dumpAst(state.ast));
  } catch (e) {
    state.ast = null;
    errorEl.textContent = e.message;
    render();
    refreshTreemap();
    updateButtons();
  }
});

stepBtn.addEventListener('click', () => {
  if (!state.ast || state.animating || state.autoRunning) {
    return;
  }
  errorEl.textContent = '';
  const result = reduceStep(state.ast);
  if (result.reduced) {
    commitStep(result);
  } else {
    statusEl.textContent = `${exprToString(state.ast)}  (정규형 — 더 이상 축약 불가)`;
  }
});

autoBtn.addEventListener('click', () => {
  if (state.autoRunning) {
    state.autoRunning = false;
    updateButtons();
    return;
  }
  if (!state.ast || state.animating) {
    return;
  }
  state.autoRunning = true;
  updateButtons();

  let autoSteps = 0;
  const stepOnce = () => {
    if (!state.autoRunning) {
      return;
    }
    if (autoSteps >= AUTO_MAX_STEPS) {
      state.autoRunning = false;
      updateButtons();
      statusEl.textContent = `${exprToString(state.ast)}  (자동 축약 최대 스텝 도달)`;
      return;
    }
    const result = reduceStep(state.ast);
    if (!result.reduced) {
      state.autoRunning = false;
      updateButtons();
      statusEl.textContent = `${exprToString(state.ast)}  (정규형 — 더 이상 축약 불가)`;
      return;
    }
    autoSteps++;
    commitStep(result, () => {
      if (state.autoRunning) {
        setTimeout(stepOnce, AUTO_STEP_DELAY_MS);
      }
    });
  };
  stepOnce();
});

resetBtn.addEventListener('click', () => {
  stopEverything();
  state.ast = null;
  state.steps = 0;
  input.value = '';
  errorEl.textContent = '';
  render();
  refreshTreemap();
  updateButtons();
});

window.addEventListener('resize', () => {
  renderer.handleResize();
  refreshTreemap();
});

updateButtons();
