import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../js/parser.js';
import { exprToString } from '../js/ast.js';

test('exprToString: 변수', () => {
  assert.equal(exprToString(parse('x')), 'x');
});

test('exprToString: 좌결합 적용은 괄호 생략', () => {
  assert.equal(exprToString(parse('x y z')), 'x y z');
  assert.equal(exprToString(parse('(x y) z')), 'x y z');
});

test('exprToString: 우결합 적용은 괄호 유지', () => {
  assert.equal(exprToString(parse('x (y z)')), 'x (y z)');
});

test('exprToString: func가 추상화면 괄호', () => {
  assert.equal(exprToString(parse('(λx. x) y')), '(λx. x) y');
});

test('exprToString: arg가 추상화/적용이면 괄호', () => {
  assert.equal(exprToString(parse('x (λy. y)')), 'x (λy. y)');
});

test('exprToString: 중첩 추상화는 파라미터 병합', () => {
  assert.equal(exprToString(parse('λx. λy. x')), 'λx y. x');
  assert.equal(exprToString(parse('λx y. x')), 'λx y. x');
});

test('exprToString: 추상화 body는 괄호 없음', () => {
  assert.equal(exprToString(parse('λx. x y')), 'λx. x y');
});

const CANONICAL = [
  'x',
  'x y z',
  'x (y z)',
  '(λx. x) y',
  'λx. x y',
  'λx y. x',
  'x (λy. y)',
  '(λx. λy. x) a b',
  'λx. x (λy. y x)',
];

test('exprToString → parse 왕복은 같은 AST', () => {
  for (const source of CANONICAL) {
    const printed = exprToString(parse(source));
    assert.deepEqual(parse(printed), parse(source), `왕복 실패: ${source} → ${printed}`);
  }
});
