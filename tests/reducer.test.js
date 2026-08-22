import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../js/parser.js';
import { Var, Lambda, App } from '../js/ast.js';
import {
  freeVariables,
  freshName,
  subst,
  reduceStep,
  reduceAll,
} from '../js/reducer.js';

// ---------- freeVariables ----------

test('freeVariables: 단일 변수', () => {
  assert.deepEqual(freeVariables(parse('x')), new Set(['x']));
});

test('freeVariables: 묶인 변수는 제외', () => {
  assert.deepEqual(freeVariables(parse('λx. x')), new Set());
  assert.deepEqual(freeVariables(parse('λx. y')), new Set(['y']));
  assert.deepEqual(freeVariables(parse('λx. x (λy. y x)')), new Set());
});

test('freeVariables: 적용은 양쪽의 합집합', () => {
  assert.deepEqual(freeVariables(parse('(λx. x z) (λy. y)')), new Set(['z']));
});

// ---------- freshName ----------

test('freshName: 겹치지 않으면 그대로, 겹치면 숫자 접미', () => {
  assert.equal(freshName('y', new Set(['x', 'z'])), 'y');
  assert.equal(freshName('y', new Set(['y', 'y1'])), 'y2');
});

// ---------- subst ----------

test('subst: 변수 치환', () => {
  assert.deepEqual(subst(Var('x'), 'x', Var('y')), Var('y'));
  assert.deepEqual(subst(Var('x'), 'z', Var('y')), Var('x'));
});

test('subst: 여러 번 등장하면 전부 치환', () => {
  assert.deepEqual(subst(parse('x x'), 'x', Var('z')), App(Var('z'), Var('z')));
});

test('subst: 파라미터가 이름을 가리면 내부 무시', () => {
  const shadowed = parse('λx. x');
  assert.strictEqual(subst(shadowed, 'x', Var('y')), shadowed);
});

test('subst: 캡처 위험 시 알파 변환 — (λy. x)[x:=y] → λy1. y', () => {
  assert.deepEqual(subst(parse('λy. x'), 'x', Var('y')), parse('λy1. y'));
});

test('subst: 캡처 위험 시 알파 변환 — (λy. x y)[x:=a y] → λy1. a y y1', () => {
  assert.deepEqual(subst(parse('λy. x y'), 'x', parse('a y')), parse('λy1. a y y1'));
});

test('subst: 캡처 없으면 이름 유지', () => {
  assert.deepEqual(subst(parse('λy. x y'), 'x', Var('a')), parse('λy. a y'));
});

test('subst: 원본 AST는 변경하지 않는다', () => {
  const orig = parse('λy. x');
  subst(orig, 'x', Var('y'));
  assert.deepEqual(orig, parse('λy. x'));
});

// ---------- reduceStep ----------

test('reduceStep: 기본 베타 축약', () => {
  const r = reduceStep(parse('(λx. x) y'));
  assert.equal(r.reduced, true);
  assert.deepEqual(r.expr, Var('y'));
});

test('reduceStep: 정규형이면 reduced=false', () => {
  assert.equal(reduceStep(parse('x')).reduced, false);
  assert.equal(reduceStep(parse('λx. x')).reduced, false);
  assert.equal(reduceStep(parse('x y')).reduced, false);
});

test('reduceStep: 최외각 redex를 먼저 축약 (인수를 먼저 축약하지 않음)', () => {
  // ((λx. x) ((λy. y) z)) → (λy. y) z  (안쪽 redex가 아니라 바깥쪽부터)
  const r = reduceStep(parse('(λx. x) ((λy. y) z)'));
  assert.deepEqual(r.expr, parse('(λy. y) z'));
});

test('reduceStep: normal order — 인자는 필요할 때만 축약됨', () => {
  // (λx. λy. y) ((λz. z) w) → λy. y  ((λz. z) w)를 축약하지 않고 대입 결과가 버려짐
  const r = reduceStep(parse('(λx. λy. y) ((λz. z) w)'));
  assert.deepEqual(r.expr, parse('λy. y'));
});

test('reduceStep: 추상화 body 내부의 redex도 축약', () => {
  const r = reduceStep(parse('λx. (λy. y) x'));
  assert.deepEqual(r.expr, parse('λx. x'));
});

test('reduceStep: 여러 번 등장하는 변수에 전부 대입', () => {
  const r = reduceStep(parse('(λx. x x) (λy. y)'));
  assert.deepEqual(r.expr, parse('(λy. y) (λy. y)'));
});

test('reduceStep: 축약 중 캡처 방지 — (λx. λy. x) y → λy1. y', () => {
  const r = reduceStep(parse('(λx. λy. x) y'));
  assert.deepEqual(r.expr, parse('λy1. y'));
});

test('reduceStep: redex 정보에 원본 app/param/arg 반환', () => {
  const ast = parse('(λx. x x) y');
  const r = reduceStep(ast);
  assert.equal(r.redex.app.type, 'app');
  assert.equal(r.redex.param, 'x');
  assert.deepEqual(r.redex.arg, Var('y'));
  assert.strictEqual(r.redex.app, ast); // 이전 트리의 노드 참조
});

// ---------- reduceAll ----------

test('reduceAll: 정규형까지 축약', () => {
  const r = reduceAll(parse('(λx. λy. x) a b'));
  assert.equal(r.terminated, 'normal-form');
  assert.equal(r.steps, 2);
  assert.deepEqual(r.expr, Var('a'));
  assert.equal(r.history.length, 3); // 초기 + 2 스텝
});

test('reduceAll: 이미 정규형이면 0스텝', () => {
  const r = reduceAll(parse('λx. x y'));
  assert.equal(r.terminated, 'normal-form');
  assert.equal(r.steps, 0);
});

test('reduceAll: 최대 스텝 초과 방지 (오메가)', () => {
  const r = reduceAll(parse('(λx. x x) (λx. x x)'), { maxSteps: 50 });
  assert.equal(r.terminated, 'max-steps');
  assert.equal(r.steps, 50);
});
