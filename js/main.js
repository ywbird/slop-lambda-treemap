// 앱 진입점: 파싱 → 한 스텝/자동 축약(애니메이션) → 트리맵 렌더링.

import { parse } from './parser.js';
import { dumpAst } from './ast.js';
import { reduceStep } from './reducer.js';
import { layoutTreemap, exprToSegments } from './treemap.js';
import { TreemapRenderer } from './renderer.js';
import { ReductionAnimator } from './animator.js';
import { expandVariables, DEFAULT_VARIABLES } from './variables.js';

const AUTO_MAX_STEPS = 200;
const AUTO_STEP_DELAY_MS = 180;

const input = document.getElementById('expr-input');
const variablesList = document.getElementById('variables-list');
const addVarBtn = document.getElementById('add-variable-btn');
const presetsEl = document.getElementById('presets');
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

/**
 * 상태 영역에 현재 식을 트리맵 색으로 색칠해 표시한다.
 * 접미사(축약 단계 수 등)는 기본 색으로 이어 붙인다.
 */
function renderStatus(suffix = '') {
  statusEl.textContent = '';
  if (!state.ast) {
    return;
  }
  for (const seg of exprToSegments(state.ast)) {
    const span = document.createElement('span');
    span.textContent = seg.text;
    if (seg.color) {
      span.style.color = seg.color;
    }
    statusEl.appendChild(span);
  }
  if (suffix) {
    const tail = document.createElement('span');
    tail.textContent = suffix;
    statusEl.appendChild(tail);
  }
}

function render() {
  renderStatus(state.steps > 0 ? `  (${state.steps}단계 축약)` : '');
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
    newAst: state.ast,
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

/** 변수 목록 행들을 {name, value}로 읽는다. 이름이 비어 있는 행은 무시. */
function readVariables() {
  return Array.from(variablesList.querySelectorAll('.variable-row'))
    .map((row) => ({
      name: row.querySelector('.var-name').value.trim(),
      value: row.querySelector('.var-value').value.trim(),
    }))
    .filter((v) => v.name !== '');
}

function addVariableRow(name = '', value = '') {
  const row = document.createElement('div');
  row.className = 'variable-row';

  const nameInput = document.createElement('input');
  nameInput.className = 'var-name';
  nameInput.type = 'text';
  nameInput.placeholder = '이름';
  nameInput.value = name;
  nameInput.spellcheck = false;
  nameInput.autocapitalize = 'off';

  const valueInput = document.createElement('input');
  valueInput.className = 'var-value';
  valueInput.type = 'text';
  valueInput.placeholder = '값 (예: λx. x)';
  valueInput.value = value;
  valueInput.spellcheck = false;
  valueInput.autocapitalize = 'off';

  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'var-delete';
  delBtn.textContent = '삭제';
  delBtn.addEventListener('click', () => row.remove());

  row.append(nameInput, valueInput, delBtn);
  variablesList.appendChild(row);
}

addVarBtn.addEventListener('click', () => addVariableRow());

// 처음 로드 시 기본 변수 전체를 목록에 채운다 (수정/삭제 가능).
const DEFAULT_UI_ORDER = [
  'add', 'sub', 'mul', 'div', 'succ', 'pred',
  'true', 'false', 'pair', 'fst', 'snd', 'iszero',
];
if (variablesList.children.length === 0) {
  for (const name of DEFAULT_UI_ORDER) {
    const entry = DEFAULT_VARIABLES.find((v) => v.name === name);
    addVariableRow(entry.name, entry.value);
  }
}

function parseCurrent() {
  stopEverything();
  errorEl.textContent = '';
  try {
    const expanded = expandVariables(input.value, readVariables());
    state.ast = parse(expanded);
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
}

parseBtn.addEventListener('click', parseCurrent);

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    parseCurrent();
  }
});

presetsEl.addEventListener('click', (e) => {
  const presetBtn = e.target.closest('.preset');
  if (!presetBtn) {
    return;
  }
  input.value = presetBtn.dataset.expr;
  parseCurrent();
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
    statusEl.textContent = '';
    renderStatus('  (정규형 — 더 이상 축약 불가)');
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
      renderStatus('  (자동 축약 최대 스텝 도달)');
      return;
    }
    const result = reduceStep(state.ast);
    if (!result.reduced) {
      state.autoRunning = false;
      updateButtons();
      renderStatus('  (정규형 — 더 이상 축약 불가)');
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
