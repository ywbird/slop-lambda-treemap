import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../js/parser.js';
import { Var } from '../js/ast.js';
import { exprToString } from '../js/ast.js';
import {
  layoutTreemap,
  weightOf,
  colorForKey,
  findCellByNode,
  collectVarCellsByColorKey,
  exprToSegments,
  parseHsl,
  formatHsl,
  collectBindingsByName,
} from '../js/treemap.js';

const FULL = { x: 0, y: 0, w: 100, h: 100 };

function approx(a, b, eps = 1e-6) {
  return Math.abs(a - b) < eps;
}

function rectEq(actual, expected, eps = 1e-6) {
  return (
    approx(actual.x, expected.x, eps) &&
    approx(actual.y, expected.y, eps) &&
    approx(actual.w, expected.w, eps) &&
    approx(actual.h, expected.h, eps)
  );
}

function assertRect(actual, expected, message) {
  assert.ok(rectEq(actual, expected), `${message}: ${JSON.stringify(actual)}`);
}

// ---------- weightOf ----------

test('weightOf: 변수 리프 수를 센다', () => {
  assert.equal(weightOf(Var('a')), 1);
  assert.equal(weightOf(parse('x y')), 2);
  assert.equal(weightOf(parse('x (y z)')), 3);
  assert.equal(weightOf(parse('(x y) (z w)')), 4);
});

test('weightOf: λ는 래퍼일 뿐 추가 단위가 아님 (body만 계수)', () => {
  assert.equal(weightOf(parse('λx. x')), 1);
  assert.equal(weightOf(parse('λx y. x')), 1);
  assert.equal(weightOf(parse('λx. x y')), 2);
});

// ---------- colorForKey ----------

test('colorForKey: 같은 키는 항상 같은 색', () => {
  assert.equal(colorForKey('free:x'), colorForKey('free:x'));
  assert.equal(colorForKey(3), colorForKey(3));
});

test('colorForKey: 다른 키는 다른 색', () => {
  assert.notEqual(colorForKey('free:x'), colorForKey('free:y'));
  assert.notEqual(colorForKey(1), colorForKey(2));
});

test('colorForKey: hsl 문자열 형식', () => {
  assert.match(colorForKey('free:x'), /^hsl\(\d+, 65%, 55%\)$/);
});

// ---------- 색 분산 (회귀: 인접 키가 시각적으로 같은 색이 되던 버그) ----------

function hueOf(color) {
  return Number(color.match(/^hsl\((\d+),/)[1]);
}

function hueDistance(a, b) {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
}

test('인접한 키들도 충분히 다른 색(hue 간격 20도 이상)', () => {
  const pairs = [
    ['1', '2'],
    ['2', '3'],
    ['3', '4'],
    ['free:a', 'free:b'],
    ['free:x', 'free:y'],
    ['free:f', 'free:x'],
  ];
  for (const [k1, k2] of pairs) {
    const dist = hueDistance(hueOf(colorForKey(k1)), hueOf(colorForKey(k2)));
    assert.ok(
      dist >= 20,
      `${k1} vs ${k2}: hue 거리 ${dist}는 너무 가까움 (시각적으로 동일 색)`
    );
  }
});

// ---------- exprToSegments (상태 표시줄 색칠) ----------

test('exprToSegments: 이어 붙이면 exprToString과 동일한 문자열', () => {
  const sources = [
    'x',
    'x y z',
    'x (y z)',
    '(λx. x) y',
    'λx. x y',
    'λx y. x',
    'x (λy. y)',
    '(λx. λy. x) a b',
  ];
  for (const source of sources) {
    const joined = exprToSegments(parse(source)).map(s => s.text).join('');
    assert.equal(joined, exprToString(parse(source)), source);
  }
});

test('exprToSegments: 파라미터와 묶인 변수는 같은 바인딩 색, 자유 변수는 이름 색', () => {
  const ast = parse('λx. x y');
  const segments = exprToSegments(ast);
  assert.deepEqual(segments.map(s => s.text), ['λ', 'x', '. ', 'x', ' ', 'y']);
  assert.equal(segments[0].color, undefined, 'λ 기호는 무색');
  assert.equal(segments[1].color, colorForKey(ast.bindingId), '파라미터 = 바인딩 색');
  assert.equal(segments[3].color, segments[1].color, '묶인 x는 파라미터와 같은 색');
  assert.equal(segments[5].color, colorForKey('free:y'), '자유 y는 free:y 색');
});

test('exprToSegments: 섀도 파라미터는 서로 다른 색', () => {
  const ast = parse('λx. x (λx. x)');
  // x 세그먼트: 바깥 param, 바깥 발생, 안쪽 param, 안쪽 발생
  const xColors = exprToSegments(ast)
    .filter(s => s.text === 'x')
    .map(s => s.color);
  assert.equal(xColors.length, 4);
  assert.equal(xColors[0], xColors[1]);
  assert.equal(xColors[2], xColors[3]);
  assert.notEqual(xColors[0], xColors[2]);
});

// ---------- 기본 레이아웃 ----------

test('변수 하나는 전체 영역을 차지는 var 셀', () => {
  const cell = layoutTreemap(parse('x'), FULL);
  assert.equal(cell.kind, 'var');
  assertRect(cell.rect, FULL, '전체 영역');
  assert.equal(cell.colorKey, 'free:x');
  assert.equal(cell.color, colorForKey('free:x'));
});

test('추상화는 "테두리를 가진 body"가 하나의 노드 — 테두리와 body 사이 여백 유지', () => {
  const cell = layoutTreemap(parse('λx. x'), FULL);
  assert.equal(cell.kind, 'lambda');
  assert.ok(cell.bindingId >= 1, 'bindingId 존재');
  assertRect(cell.rect, FULL, 'λ 노드 셀 = 전체 영역(원자적)');
  assert.equal(cell.body.kind, 'var');
  // 패딩 = 테두리 굵기(5) + 테두리-본문 여백(5) = 10
  assertRect(cell.body.rect, { x: 10, y: 10, w: 80, h: 80 }, 'body는 테두리+여백 안쪽');
  // 묶인 변수 x의 색 키는 λ의 bindingId
  assert.equal(cell.body.colorKey, cell.bindingId);
});

test('추상화는 교차 분할에서 제외 — 방향은 app 분할 수만으로 결정', () => {
  // (λx. x y) z: 루트 app(깊이0) 좌우 → λ body의 app도 깊이1 → 상하
  const cell = layoutTreemap(parse('(λx. x y) z'), FULL);
  assert.equal(cell.kind, 'app');
  const bodyApp = cell.func.body;
  assert.equal(bodyApp.kind, 'app');
  assert.ok(approx(bodyApp.func.rect.x, bodyApp.arg.rect.x), '같은 x 범위 공유(상하 분할)');
  assert.ok(bodyApp.arg.rect.y > bodyApp.func.rect.y, 'func 위 / arg 아래');

  // λ가 없어도 같은 깊이의 app은 같은 방향: (x y) z의 내부 app도 상하
  const noLambda = layoutTreemap(parse('(x y) z'), FULL);
  assert.ok(noLambda.func.arg.rect.y > noLambda.func.func.rect.y, 'app 연쇄는 상하');
});

test('λ 체인 길이가 달라도 첫 app 분할 방향은 동일 (회귀)', () => {
  // 사용자 보고 사례: 앞은 λ 3개, 뒤는 λ 2개 — 둘 다 첫 app 분할은 같아야 함
  const ast = parse('(λn. λf. λx. f (n f x)) (λp. λq. p q)');
  const cell = layoutTreemap(ast, FULL);
  const leftApp = cell.func.body.body.body; // f (n f x)
  const rightApp = cell.arg.body.body; // p q
  const isVertical = (c) =>
    approx(c.func.rect.x, c.arg.rect.x) && c.arg.rect.y > c.func.rect.y;
  assert.ok(isVertical(leftApp), 'f / (n f x) 상하');
  assert.ok(isVertical(rightApp), 'p / q 상하');
});

test('깊이 0의 적용은 좌우 분할 (func=왼쪽, arg=오른쪽), 자식 사이 간격 있음', () => {
  const cell = layoutTreemap(parse('x y'), FULL);
  assert.equal(cell.kind, 'app');
  // 간격 = cellGap(100x100) = min(8, 5) = 5
  assertRect(cell.func.rect, { x: 0, y: 0, w: 47.5, h: 100 }, 'func 왼쪽');
  assertRect(cell.arg.rect, { x: 52.5, y: 0, w: 47.5, h: 100 }, 'arg 오른쪽');
});

test('노드 간 간격 = 테두리-본문 여백 (테두리 굵기와 같은 공식)', () => {
  const appCell = layoutTreemap(parse('x y'), FULL);
  const appGap = appCell.arg.rect.x - (appCell.func.rect.x + appCell.func.rect.w);
  assert.ok(approx(appGap, 5), 'FULL(100x100)에서는 5');

  // λ가 인접한 분할도 동일 공식
  const withLambda = layoutTreemap(parse('(λy. a) b'), FULL);
  const lamGap = withLambda.arg.rect.x - (withLambda.func.rect.x + withLambda.func.rect.w);
  assert.ok(approx(lamGap, 5), `λ 인접 간격 ${lamGap}`);

  // 테두리 굵기 = cellGap(5), 테두리와 body 사이 여백도 cellGap과 동일
  const lamCell = layoutTreemap(parse('λq. q'), FULL);
  const pad = lamCell.body.rect.x - lamCell.rect.x; // 테두리(5) + 여백
  assert.ok(approx(pad - 5, appGap), `여백 ${pad - 5} ≠ 노드 간격 ${appGap}`);
});

test('깊이 1의 적용은 상하 분할', () => {
  const cell = layoutTreemap(parse('x y z'), FULL);
  assert.equal(cell.kind, 'app');
  const rootGap = 5;
  const funcW = (100 - rootGap) * 2 / 3;
  assert.ok(approx(cell.func.rect.w, funcW), 'func는 (100-gap)의 2/3');
  assert.ok(approx(cell.arg.rect.x, funcW + rootGap), 'arg는 func 옆에 간격을 두고');
  assert.ok(approx(cell.arg.rect.w, 100 - rootGap - funcW), 'arg는 1/3');
  // 내부 app(x y)는 깊이 1 → 상하 분할, 간격은 내부 rect 크기 기준 공식
  const inner = cell.func;
  const innerGap = Math.max(1, Math.min(8, Math.min(inner.rect.w, inner.rect.h) * 0.05));
  assert.ok(approx(inner.func.rect.h, (100 - innerGap) / 2), 'x 위쪽 절반');
  assert.ok(approx(inner.arg.rect.y, (100 - innerGap) / 2 + innerGap), 'y 아래쪽(간격 후)');
});

test('면적은 가중치 비율로 분배', () => {
  const cell = layoutTreemap(parse('x (y z)'), FULL);
  assert.ok(approx(cell.func.rect.w, 95 / 3), 'x(가중치1)은 (100-gap)의 1/3');
  assert.ok(approx(cell.arg.rect.x, 95 / 3 + 5), 'y z는 간격 뒤');
  assert.ok(approx(cell.arg.rect.w, 95 * 2 / 3), 'y z(가중치2)는 2/3');
});

// ---------- 색상/바인딩 ----------

test('같은 바인딩의 변수 발생은 같은 색, 다른 바인딩은 다른 색', () => {
  const cell = layoutTreemap(parse('λx. x x'), FULL);
  const [x1, x2] = [cell.body.func, cell.body.arg];
  assert.equal(x1.colorKey, cell.bindingId);
  assert.equal(x1.colorKey, x2.colorKey);

  const two = layoutTreemap(parse('(λx. x) (λx. x)'), FULL);
  assert.notEqual(two.func.body.colorKey, two.arg.body.colorKey);
});

test('자유 변수와 묶인 변수는 다른 색 키', () => {
  const cell = layoutTreemap(parse('λx. x y'), FULL);
  assert.equal(cell.body.func.colorKey, cell.bindingId); // 묶인 x
  assert.equal(cell.body.arg.colorKey, 'free:y'); // 자유 y
});

test('축약 후에도 색 키 유지 — (λx. x) (λy. y) 예시', async () => {
  const { reduceStep } = await import('../js/reducer.js');
  const ast = parse('(λx. x) (λy. y)');
  const before = layoutTreemap(ast, FULL);
  const argColorKey = before.arg.body.colorKey; // λy의 몸통 y
  const r = reduceStep(ast);
  const after = layoutTreemap(r.expr, FULL);
  assert.equal(after.body.colorKey, argColorKey); // 결과 λy의 몸통 y는 같은 색 키
});

// ---------- 구조 검증 ----------

test('모든 셀은 부모 영역 안에 contained', () => {
  function contains(outer, inner) {
    return (
      inner.x >= outer.x - 1e-6 &&
      inner.y >= outer.y - 1e-6 &&
      inner.x + inner.w <= outer.x + outer.w + 1e-6 &&
      inner.y + inner.h <= outer.y + outer.h + 1e-6
    );
  }
  const cell = layoutTreemap(parse('(λx. x y) (a b c)'), FULL);
  function walk(c) {
    if (c.kind === 'lambda') {
      assert.ok(contains(c.rect, c.body.rect), 'λ body 포함');
      walk(c.body);
    } else if (c.kind === 'app') {
      assert.ok(contains(c.rect, c.func.rect), 'app func 포함');
      assert.ok(contains(c.rect, c.arg.rect), 'app arg 포함');
      walk(c.func);
      walk(c.arg);
    }
  }
  walk(cell);
});

// ---------- 셀 탐색 헬퍼 (애니메이션용) ----------

test('findCellByNode: AST 노드 참조로 셀을 찾는다', () => {
  const ast = parse('(x y) z');
  const cell = layoutTreemap(ast, FULL);
  assert.strictEqual(findCellByNode(cell, ast), cell);
  const funcCell = findCellByNode(cell, ast.func);
  assert.strictEqual(funcCell.node, ast.func);
  assert.ok(rectEq(funcCell.rect, { x: 0, y: 0, w: 95 * 2 / 3, h: 100 }));
  assert.equal(findCellByNode(cell, Var('q')), null);
});

test('collectVarCellsByColorKey: 해당 바인딩의 발생만 수집', () => {
  const ast = parse('λx. x (x y)');
  const cell = layoutTreemap(ast, FULL);
  const found = collectVarCellsByColorKey(cell, ast.bindingId);
  assert.equal(found.length, 2);
  assert.ok(found.every(c => c.kind === 'var' && c.colorKey === ast.bindingId));
});

test('collectVarCellsByColorKey: 같은 이름 재바인딩(섀도)은 제외', () => {
  const ast = parse('λx. x (λx. x)');
  const cell = layoutTreemap(ast, FULL);
  const outer = collectVarCellsByColorKey(cell, ast.bindingId);
  const innerId = ast.body.arg.bindingId;
  const inner = collectVarCellsByColorKey(cell, innerId);
  assert.equal(outer.length, 1); // 바깥 x만
  assert.equal(inner.length, 1); // 안쪽 x만
  assert.notEqual(outer[0], inner[0]);
});

// ---------- 수동 색상 오버라이드 ----------

test('parseHsl/formatHsl: 왕복', () => {
  for (const str of ['hsl(0, 65%, 55%)', 'hsl(120, 65%, 55%)', 'hsl(359, 100%, 100%)']) {
    assert.equal(formatHsl(parseHsl(str)), str);
  }
});

test('parseHsl: 잘못된 형식은 throw', () => {
  assert.throws(() => parseHsl('rgb(0,0,0)'));
  assert.throws(() => parseHsl('hsl(0, 65%, 55%'));
});

test('formatHsl: hue는 0..360으로 정규화', () => {
  assert.equal(formatHsl({ h: -30, s: 50, l: 50 }), 'hsl(330, 50%, 50%)');
  assert.equal(formatHsl({ h: 720, s: 50, l: 50 }), 'hsl(0, 50%, 50%)');
});

test('collectBindingsByName: 각 이름에 해당하는 bindingId 수집', () => {
  const ast = parse('λx. x (λy. y x)');
  const map = collectBindingsByName(ast);
  assert.ok(map.has('x'));
  assert.ok(map.has('y'));
  assert.equal(map.size, 2);
  assert.equal(map.get('x').size, 1);
  assert.equal(map.get('y').size, 1);
  // x 의 bindingId = 바깥 λx
  assert.ok(map.get('x').has(ast.bindingId));
  assert.ok(map.get('y').has(ast.body.arg.bindingId));
});

test('collectBindingsByName: 같은 이름이 두 번 묶이면 bindingId 도 두 개', () => {
  const ast = parse('λx. x (λx. x)');
  const map = collectBindingsByName(ast);
  assert.equal(map.get('x').size, 2);
});

test('layoutTreemap: override 가 있으면 해당 이름 셀/λ 테두리에 적용', () => {
  const ast = parse('λx. x y');
  const overrides = new Map([['x', 'hsl(10, 80%, 50%)']]);
  const cell = layoutTreemap(ast, FULL, overrides);
  // λx 의 border 색
  assert.equal(cell.color, 'hsl(10, 80%, 50%)');
  // 묶인 x 변수 셀 색 (body.app.func)
  assert.equal(cell.body.func.color, 'hsl(10, 80%, 50%)');
  // override 없는 자유 y 는 자동 색 (body.app.arg)
  assert.equal(cell.body.arg.color, colorForKey('free:y'));
});

test('layoutTreemap: override 가 없으면 자동으로', () => {
  const ast = parse('λx. x');
  const cell = layoutTreemap(ast, FULL);
  assert.equal(cell.color, colorForKey(ast.bindingId));
});

test('layoutTreemap: 같은 이름 override 는 이름이 등장하는 모든 binding 에 적용', () => {
  // x 만 override 지정 — 안쪽 λx 의 border / 변수 도 같은 override 색
  const ast = parse('λx. x (λx. x)');
  const overrides = new Map([['x', 'hsl(50, 90%, 50%)']]);
  const cell = layoutTreemap(ast, FULL, overrides);
  // 바깥 λx border
  assert.equal(cell.color, 'hsl(50, 90%, 50%)');
  // 바깥 x 변수
  assert.equal(cell.body.func.color, 'hsl(50, 90%, 50%)');
  // 안쪽 λx border
  assert.equal(cell.body.arg.color, 'hsl(50, 90%, 50%)');
  // 안쪽 x 변수
  assert.equal(cell.body.arg.body.color, 'hsl(50, 90%, 50%)');
});

test('exprToSegments: override 가 적용된 색으로 세그먼트 색칠', () => {
  const ast = parse('λx. x y');
  const overrides = new Map([['x', 'hsl(200, 80%, 50%)']]);
  const segs = exprToSegments(ast, new Map(), overrides);
  const xSegs = segs.filter((s) => s.text === 'x');
  const ySegs = segs.filter((s) => s.text === 'y');
  assert.ok(xSegs.every((s) => s.color === 'hsl(200, 80%, 50%)'));
  assert.ok(ySegs.every((s) => s.color === colorForKey('free:y')));
});

test('exprToSegments: override 없이 호출하면 기존 동작', () => {
  const ast = parse('λx. x');
  const segs = exprToSegments(ast);
  const xSeg = segs.find((s) => s.text === 'x');
  assert.equal(xSeg.color, colorForKey(ast.bindingId));
});
