// 앱 진입점: 파싱 → 한 스텝/자동 축약(애니메이션) → 트리맵 렌더링.

import { parse } from './parser.js';
import { dumpAst } from './ast.js';
import { reduceStep } from './reducer.js';
import { layoutTreemap, exprToSegments, colorForKey, collectBindingsByName } from './treemap.js';
import { TreemapRenderer } from './renderer.js';
import { ReductionAnimator, EASINGS } from './animator.js';
import { expandVariables, DEFAULT_VARIABLES, churchNumeralOf } from './variables.js';
import { exportPng, exportGif } from './exporter.js';

const AUTO_MAX_STEPS = 200;

const input = document.getElementById('expr-input');
const speedSlider = document.getElementById('speed-slider');
const speedValue = document.getElementById('speed-value');
const easingSelect = document.getElementById('easing-select');
const variablesList = document.getElementById('variables-list');
const addVarBtn = document.getElementById('add-variable-btn');
const presetsEl = document.getElementById('presets');
const parseBtn = document.getElementById('parse-btn');
const stepBtn = document.getElementById('step-btn');
const autoBtn = document.getElementById('auto-btn');
const resetBtn = document.getElementById('reset-btn');
const exportPngBtn = document.getElementById('export-png-btn');
const exportGifBtn = document.getElementById('export-gif-btn');
const exportWidthInput = document.getElementById('export-width');
const exportHeightInput = document.getElementById('export-height');
const colorListEl = document.getElementById('color-list');
const statusEl = document.getElementById('status');
const errorEl = document.getElementById('error');
const statusOverlayEl = document.getElementById('status-overlay');
const errorOverlayEl = document.getElementById('error-overlay');
const layoutModeSelect = document.getElementById('layout-mode');
const mainEl = document.querySelector('main');

const renderer = new TreemapRenderer(document.getElementById('treemap-canvas'));
const animator = new ReductionAnimator(renderer);

const state = {
  ast: null,
  steps: 0,
  animating: false,
  autoRunning: false,
  exporting: false,
  colorOverrides: new Map(),
  bindingsByName: new Map(),
  layoutMode: 'stacked',
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
  for (const seg of exprToSegments(
    state.ast,
    new Map(),
    state.colorOverrides,
    state.bindingsByName
  )) {
    const span = document.createElement('span');
    span.textContent = seg.text;
    if (seg.color) {
      span.style.color = seg.color;
    }
    statusEl.appendChild(span);
  }
  // 결과 전체가 교회 숫자 형태면 값 표기
  const numeral = churchNumeralOf(state.ast);
  if (numeral !== null) {
    const badge = document.createElement('span');
    badge.className = 'numeral-badge';
    badge.textContent = ` = $${numeral}`;
    statusEl.appendChild(badge);
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

/** 트리맵만 모드에서 떠 있는 상태/에러 패널에 동일 텍스트를 복사한다. */
function mirrorStatusToOverlay() {
  if (statusOverlayEl) statusOverlayEl.textContent = statusEl.textContent;
  if (errorOverlayEl) errorOverlayEl.textContent = errorEl.textContent;
}

/**
 * main 요소에 layout-* 클래스를 부여하고 캔버스 크기 변화에 대응한다.
 * CSS 가 동기적으로 레이아웃을 바꾸므로 같은 틱에 renderer.handleResize() 로
 * 비트맵 크기를 다시 잡고 새 크기로 트리맵을 다시 그린다.
 */
function applyLayoutMode() {
  mainEl.className = `layout-${state.layoutMode}`;
  layoutModeSelect.value = state.layoutMode;
  renderer.handleResize();
  refreshTreemap();
}

/**
 * status / error 의 어떤 갱신도 오버레이에 그대로 반영되도록 MutationObserver 로
 * 자동 동기화. 트리맵만 모드에서만 오버레이가 보이므로 다른 모드에서는 사실상
 * 무시되지만 textContent 복사는 비용이 거의 없다.
 */
new MutationObserver(mirrorStatusToOverlay).observe(statusEl, {
  childList: true,
  characterData: true,
  subtree: true,
});
new MutationObserver(mirrorStatusToOverlay).observe(errorEl, {
  childList: true,
  characterData: true,
  subtree: true,
});

layoutModeSelect.addEventListener('change', () => {
  state.layoutMode = layoutModeSelect.value;
  applyLayoutMode();
});

function updateButtons() {
  const hasAst = state.ast !== null;
  const busy = state.animating || state.autoRunning || state.exporting;
  // 한 스텝: AST가 있고 애니메이션/자동 진행 중이 아닐 때
  stepBtn.disabled = !hasAst || busy;
  // 자동: 실행 중에는 언제나 눌러 정지 가능, 그 외엔 AST가 있고 대기 중일 때
  autoBtn.disabled =
    (!hasAst && !state.autoRunning) || (state.animating && !state.autoRunning);
  autoBtn.textContent = state.autoRunning ? '정지' : '자동 축약';
  parseBtn.disabled = state.animating || state.autoRunning;
  exportPngBtn.disabled = !hasAst || busy;
  exportGifBtn.disabled = !hasAst || busy;
}

function refreshTreemap() {
  if (!state.ast) {
    renderer.clear();
    return;
  }
  const { w, h } = renderer.getSize();
  renderer.setLayout(
    layoutTreemap(state.ast, { x: 0, y: 0, w, h }, state.colorOverrides)
  );
}

/** 슬라이더로 조절되는 애니메이션 지속시간(ms). */
function animationDuration() {
  return Number(speedSlider.value);
}

/** 선택된 보간 함수 */
function animationEasing() {
  return EASINGS[easingSelect.value] ?? EASINGS['ease-in-out'];
}

/**
 * 내보내기 크기 입력값을 검증해 {width, height}로 돌려준다.
 * 잘못된 값이면 현재 캔버스 크기로 폴백하고 status에 경고를 남긴다.
 * ponytail: 너무 빡빡한 검증은 과잉 — 숫자 + 범위만 본다.
 */
function readExportSize() {
  const fallback = { w: renderer.w, h: renderer.h };
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const parse = (input) => {
    const v = Number(input.value);
    return Number.isFinite(v) && v > 0 ? Math.round(v) : NaN;
  };
  const w = parse(exportWidthInput);
  const h = parse(exportHeightInput);
  if (Number.isNaN(w) || Number.isNaN(h)) {
    statusEl.textContent = '';
    renderStatus(`  (내보내기 크기 입력 오류 — 현재 캔버스 ${fallback.w}×${fallback.h} 사용)`);
    return fallback;
  }
  return { w: clamp(w, 100, 10000), h: clamp(h, 100, 10000) };
}

/** 현재 캔버스 크기를 입력 기본값으로 채운다 (페이지 로드 + 파싱 후). */
function syncExportSizeInputs() {
  exportWidthInput.value = renderer.w;
  exportHeightInput.value = renderer.h;
}

/**
 * AST 에 등장하는 모든 변수 이름(묶인 것 + 자유 변수)을 유일하게 모아 반환한다.
 * 등장 순서로 정렬하지 않으면 매번 UI 가 흔들리므로 정렬해서 안정성을 준다.
 */
function collectVariableNames(ast) {
  const names = new Set();
  function walk(node) {
    if (!node) return;
    if (node.type === 'var') names.add(node.name);
    else if (node.type === 'lambda') {
      names.add(node.param);
      walk(node.body);
    } else if (node.type === 'app') {
      walk(node.func);
      walk(node.arg);
    }
  }
  walk(ast);
  return [...names].sort();
}

/** 이름에 대응하는 자동 색(바인딩이 있으면 bindingId, 없으면 free:NAME). */
function autoColorForName(name) {
  const ids = state.bindingsByName.get(name);
  if (ids && ids.size > 0) {
    return colorForKey([...ids][0]);
  }
  return colorForKey(`free:${name}`);
}

/** 이름에 대한 override 의 현재 HSL 값을 돌려준다(없으면 자동). */
function effectiveColor(name) {
  return state.colorOverrides.get(name) ?? autoColorForName(name);
}

/**
 * 현재 AST 기준으로 색상 행들을 다시 그린다.
 * 기존 행은 모두 제거하고 (변수 집합이 바뀔 수 있으므로) 처음부터 새로 만든다.
 */
function populateColorList() {
  colorListEl.textContent = '';
  if (!state.ast) return;
  for (const name of collectVariableNames(state.ast)) {
    colorListEl.appendChild(buildColorRow(name));
  }
}

function buildColorRow(name) {
  const row = document.createElement('div');
  row.className = 'color-row';
  row.dataset.name = name;

  const nameEl = document.createElement('span');
  nameEl.className = 'color-name';
  nameEl.textContent = name;

  const swatch = document.createElement('span');
  swatch.className = 'color-swatch';

  const sliders = {};
  for (const axis of ['h', 's', 'l']) {
    const label = document.createElement('label');
    label.style.display = 'flex';
    label.style.alignItems = 'center';
    label.style.gap = '4px';
    label.style.fontSize = '0.7rem';
    const text = document.createElement('span');
    text.textContent = axis.toUpperCase();
    const input = document.createElement('input');
    input.type = 'range';
    input.min = axis === 'h' ? '0' : '0';
    input.max = axis === 'h' ? '359' : '100';
    input.step = '1';
    input.dataset.axis = axis;
    input.setAttribute('aria-label', `${name} ${axis.toUpperCase()}`);
    label.append(text, input);
    sliders[axis] = input;
    row.appendChild(label);
  }

  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'color-reset';
  reset.textContent = '초기화';

  row.append(nameEl, swatch, sliders.h.parentElement, sliders.s.parentElement, sliders.l.parentElement, reset);

  const syncFromColor = (hslStr) => {
    const m = hslStr.match(/^hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)$/);
    if (!m) return;
    sliders.h.value = m[1];
    sliders.s.value = m[2];
    sliders.l.value = m[3];
    swatch.style.background = hslStr;
  };
  syncFromColor(effectiveColor(name));

  let timer = null;
  const scheduleRebuild = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const hsl = `hsl(${sliders.h.value}, ${sliders.s.value}%, ${sliders.l.value}%)`;
      state.colorOverrides.set(name, hsl);
      swatch.style.background = hsl;
      render();
      refreshTreemap();
    }, 100);
  };
  for (const axis of ['h', 's', 'l']) {
    sliders[axis].addEventListener('input', scheduleRebuild);
  }
  reset.addEventListener('click', () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    state.colorOverrides.delete(name);
    syncFromColor(autoColorForName(name));
    render();
    refreshTreemap();
  });

  return row;
}

// 보간 함수 옵션 채우기 (기본: ease-in-out)
for (const [name, fn] of Object.entries(EASINGS)) {
  const opt = document.createElement('option');
  opt.value = name;
  opt.textContent = name;
  opt.selected = name === 'ease-in-out';
  easingSelect.appendChild(opt);
}

speedSlider.addEventListener('input', () => {
  speedValue.textContent = `${speedSlider.value}ms`;
});

/**
 * 한 스텝 축약을 커밋하고 애니메이션 후 새 레이아웃으로 교체한다.
 * 상태(expr, 스텝 수, 텍스트)는 즉시 갱신하고 화면은 onDone에서 교체.
 */
function commitStep(result, after) {
  const oldAst = state.ast;
  state.ast = result.expr;
  state.bindingsByName = collectBindingsByName(state.ast);
  state.steps++;
  state.animating = true;
  render();
  updateButtons();
  animator.animateRedex({
    oldAst,
    newAst: state.ast,
    redex: result.redex,
    durationMs: animationDuration(),
    easing: animationEasing(),
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
    state.bindingsByName = collectBindingsByName(state.ast);
    state.steps = 0;
    populateColorList();
    render();
    refreshTreemap();
    updateButtons();
    syncExportSizeInputs();
    console.log(dumpAst(state.ast));
  } catch (e) {
    state.ast = null;
    state.bindingsByName = new Map();
    errorEl.textContent = e.message;
    populateColorList();
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
        // 스텝 사이 쉼도 속도에 비례 (짧게)
        setTimeout(stepOnce, Math.max(60, Math.round(animationDuration() / 4)));
      }
    });
  };
  stepOnce();
});

resetBtn.addEventListener('click', () => {
  stopEverything();
  state.ast = null;
  state.bindingsByName = new Map();
  state.colorOverrides.clear();
  state.steps = 0;
  input.value = '';
  errorEl.textContent = '';
  populateColorList();
  render();
  refreshTreemap();
  updateButtons();
});

exportPngBtn.addEventListener('click', async () => {
  if (!state.ast || state.exporting) return;
  const { w, h } = readExportSize();
  state.exporting = true;
  errorEl.textContent = '';
  try {
    await exportPng(renderer, state.ast, { width: w, height: h });
    statusEl.textContent = '';
    renderStatus('  (PNG 저장 완료)');
  } catch (e) {
    errorEl.textContent = e.message;
  } finally {
    state.exporting = false;
    updateButtons();
  }
});

exportGifBtn.addEventListener('click', async () => {
  if (!state.ast || state.exporting) return;
  const { w, h } = readExportSize();
  // 진행 중 다른 작업 잠금 (자동 축약이 돌고 있으면 거기서 멈춤).
  if (state.autoRunning) {
    state.autoRunning = false;
  }
  state.exporting = true;
  errorEl.textContent = '';
  updateButtons();
  try {
    await exportGif({
      renderer,
      ast: state.ast,
      width: w,
      height: h,
      frameMs: animationDuration(),
      onProgress: (i, total) => {
        statusEl.textContent = '';
        renderStatus(`  (GIF 생성 중... ${i}/${total})`);
      },
    });
    statusEl.textContent = '';
    renderStatus('  (GIF 저장 완료)');
  } catch (e) {
    errorEl.textContent = e.message;
  } finally {
    state.exporting = false;
    updateButtons();
  }
});

window.addEventListener('resize', () => {
  renderer.handleResize();
  refreshTreemap();
});

syncExportSizeInputs();
applyLayoutMode(); // 초기 클래스 적용 + 사이즈 동기화
updateButtons();
