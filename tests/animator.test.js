import { test } from 'node:test';
import assert from 'node:assert/strict';
import { easeInOutCubic, lerpRect, pathToNode, morphAlong } from '../js/animator.js';
import { parse } from '../js/parser.js';
import { reduceStep } from '../js/reducer.js';
import { layoutTreemap } from '../js/treemap.js';

const FULL = { x: 0, y: 0, w: 100, h: 100 };

test('easeInOutCubic: 끝점과 중간값', () => {
  assert.equal(easeInOutCubic(0), 0);
  assert.equal(easeInOutCubic(1), 1);
  assert.equal(easeInOutCubic(0.5), 0.5);
});

test('easeInOutCubic: 단조 증가', () => {
  let prev = -Infinity;
  for (let i = 0; i <= 20; i++) {
    const v = easeInOutCubic(i / 20);
    assert.ok(v >= prev, `t=${i / 20}에서 감소함`);
    prev = v;
  }
});

test('lerpRect: t에 따라 from에서 to로 보간', () => {
  const from = { x: 0, y: 10, w: 100, h: 20 };
  const to = { x: 50, y: 30, w: 40, h: 60 };
  assert.deepEqual(lerpRect(from, to, 0), from);
  assert.deepEqual(lerpRect(from, to, 1), to);
  const mid = lerpRect(from, to, 0.5);
  assert.deepEqual(mid, { x: 25, y: 20, w: 70, h: 40 });
});

// ---------- pathToNode ----------

test('pathToNode: 루트/중첩 경로/미발견', () => {
  const ast = parse('(x y) z');
  assert.deepEqual(pathToNode(ast, ast), []);
  assert.deepEqual(pathToNode(ast, ast.func), ['func']);
  assert.deepEqual(pathToNode(ast, ast.func.func), ['func', 'func']);
  const lam = parse('λx. x y');
  assert.deepEqual(pathToNode(lam, lam.body.arg), ['body', 'arg']);
  assert.equal(pathToNode(ast, parse('q')), null);
});

// ---------- morphAlong ----------

test('morphAlong: e=1이면 축약 후 레이아웃과 정확히 일치', () => {
  const ast = parse('(λx. x) (y z)');
  const r = reduceStep(ast);
  const oldL = layoutTreemap(ast, FULL);
  const newL = layoutTreemap(r.expr, FULL);
  const tree = morphAlong(oldL, newL, pathToNode(ast, r.redex.app), 1, oldL.arg);
  assert.deepEqual(tree, newL);
});

test('morphAlong: e=0이면 복제 시작점은 인자의 이전 위치', () => {
  const ast = parse('(λx. x) (y z)');
  const r = reduceStep(ast);
  const oldL = layoutTreemap(ast, FULL);
  const newL = layoutTreemap(r.expr, FULL);
  const tree = morphAlong(oldL, newL, [], 0, oldL.arg);
  // 복제본 (y z)은 시작에서 인자였던 오른쪽 절반에 있고, 내부 구조도 동일
  assert.deepEqual(tree.rect, oldL.arg.rect);
  assert.deepEqual(tree.func.rect, oldL.arg.func.rect);
  assert.deepEqual(tree.arg.rect, oldL.arg.arg.rect);
  // 색/키는 새 쪽(인자 것)을 유지
  assert.equal(tree.func.colorKey, oldL.arg.func.colorKey);
});

test('morphAlong: 중간값은 두 레이아웃의 선형 보간', () => {
  const ast = parse('(λx. x) (y z)');
  const r = reduceStep(ast);
  const oldL = layoutTreemap(ast, FULL);
  const newL = layoutTreemap(r.expr, FULL);
  const tree = morphAlong(oldL, newL, [], 0.5, oldL.arg);
  const mid = lerpRect(oldL.arg.rect, newL.rect, 0.5);
  assert.deepEqual(tree.rect, mid);
});

test('morphAlong: redex가 중첩된 경우 주변 식도 함께 보간', () => {
  const ast = parse('z ((λx. x) (y q))');
  const r = reduceStep(ast);
  const oldL = layoutTreemap(ast, FULL);
  const newL = layoutTreemap(r.expr, FULL);
  const path = pathToNode(ast, r.redex.app); // ['arg']

  const end = morphAlong(oldL, newL, path, 1, oldL.arg.arg);
  assert.deepEqual(end, newL);

  const start = morphAlong(oldL, newL, path, 0, oldL.arg.arg);
  // 경로 밖(왼쪽 z)은 이전 위치 유지에서 시작
  assert.deepEqual(start.func.rect, oldL.func.rect);
  // redex 자리의 복제본은 인자의 이전 위치에서 시작
  assert.deepEqual(start.arg.rect, oldL.arg.arg.rect);
});
