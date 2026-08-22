import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../js/parser.js';
import { Var } from '../js/ast.js';
import { layoutTreemap, weightOf, colorForKey, findCellByNode, collectVarCellsByColorKey } from '../js/treemap.js';

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

// ---------- 기본 레이아웃 ----------

test('변수 하나는 전체 영역을 차지는 var 셀', () => {
  const cell = layoutTreemap(parse('x'), FULL);
  assert.equal(cell.kind, 'var');
  assertRect(cell.rect, FULL, '전체 영역');
  assert.equal(cell.colorKey, 'free:x');
  assert.equal(cell.color, colorForKey('free:x'));
});

test('추상화는 "테두리를 가진 body"가 하나의 노드 — body는 패딩 안쪽', () => {
  const cell = layoutTreemap(parse('λx. x'), FULL);
  assert.equal(cell.kind, 'lambda');
  assert.ok(cell.bindingId >= 1, 'bindingId 존재');
  assertRect(cell.rect, FULL, 'λ 노드 셀 = 전체 영역(원자적)');
  assert.equal(cell.body.kind, 'var');
  // pad = min(8, 100*0.05) = 5 (처음 방식: 크기 비례)
  assertRect(cell.body.rect, { x: 5, y: 5, w: 90, h: 90 }, 'body는 테두리에서 패딩만큼 안쪽');
  // 묶인 변수 x의 색 키는 λ의 bindingId
  assert.equal(cell.body.colorKey, cell.bindingId);
});

test('추상화는 교차 분할에 한 단계로 반영: λ를 거치면 방향이 한 번 뒤집힌다', () => {
  // (λx. x y) z — 루트 app(깊이0) 좌우 → λ(깊이1, 분할 없음) → body app(깊이2) 좌우.
  // λ가 한 단계를 차지하므로 body 분할은 부모와 같은 방향이 된다(짝수 레벨 차).
  const cell = layoutTreemap(parse('(λx. x y) z'), FULL);
  assert.equal(cell.kind, 'app');
  const bodyApp = cell.func.body;
  assert.equal(bodyApp.kind, 'app');
  assert.ok(approx(bodyApp.func.rect.y, bodyApp.arg.rect.y), '같은 y 범위 공유(좌우 분할)');
  assert.ok(bodyApp.arg.rect.x > bodyApp.func.rect.x, 'func 왼쪽 / arg 오른쪽');
  // λ 없이 같은 깊이라면 상하로 분할될 것: (x y) z의 내부 app은 상하
  const noLambda = layoutTreemap(parse('(x y) z'), FULL);
  assert.ok(noLambda.func.arg.rect.y > noLambda.func.func.rect.y, 'app 연쇄는 상하');
});

test('깊이 0의 적용은 좌우 분할 (func=왼쪽, arg=오른쪽), 자식 사이 간격 있음', () => {
  const cell = layoutTreemap(parse('x y'), FULL);
  assert.equal(cell.kind, 'app');
  // 간격 = cellGap(100x100) = min(8, 5) = 5
  assertRect(cell.func.rect, { x: 0, y: 0, w: 47.5, h: 100 }, 'func 왼쪽');
  assertRect(cell.arg.rect, { x: 52.5, y: 0, w: 47.5, h: 100 }, 'arg 오른쪽');
});

test('노드 간 간격 = λ 테두리-본문 간격 (같은 공식)', () => {
  const appCell = layoutTreemap(parse('x y'), FULL);
  const appGap = appCell.arg.rect.x - (appCell.func.rect.x + appCell.func.rect.w);
  const lamCell = layoutTreemap(parse('λq. q'), FULL);
  const pad = lamCell.body.rect.x - lamCell.rect.x;
  assert.ok(appGap > 0, '간격은 양수');
  assert.ok(approx(appGap, pad), `app 간격 ${appGap} ≠ λ 패딩 ${pad}`);
  assert.ok(approx(appGap, 5), 'FULL(100x100)에서는 5');

  // λ가 인접한 분할도 동일 공식
  const withLambda = layoutTreemap(parse('(λy. a) b'), FULL);
  const lamGap = withLambda.arg.rect.x - (withLambda.func.rect.x + withLambda.func.rect.w);
  assert.ok(approx(lamGap, 5), `λ 인접 간격 ${lamGap}`);

  // λ 내부 패딩도 같은 공식 — FULL(100x100)에서 5
  const lamCell2 = layoutTreemap(parse('λq. q'), FULL);
  assert.ok(approx(lamCell2.body.rect.x - lamCell2.rect.x, 5), 'λ 패딩 = min(8, 5%)');
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
