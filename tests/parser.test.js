import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../js/parser.js';
import { Var, Lambda, App, dumpAst } from '../js/ast.js';
import { LambdaSyntaxError } from '../js/lexer.js';

test('단일 변수를 파싱한다', () => {
  assert.deepEqual(parse('x'), Var('x'));
});

test('기본 추상화를 파싱한다', () => {
  assert.deepEqual(parse('λx.x'), Lambda('x', Var('x')));
  assert.deepEqual(parse('\\x.x'), Lambda('x', Var('x')));
});

test('여러 파라미터는 커리 형태로 변환한다', () => {
  assert.deepEqual(parse('λx y. x'), Lambda('x', Lambda('y', Var('x'))));
  assert.deepEqual(parse('λx. λy. x'), parse('λx y. x'));
});

test('적용은 좌결합이다', () => {
  assert.deepEqual(parse('x y z'), App(App(Var('x'), Var('y')), Var('z')));
  assert.deepEqual(parse('(x y) z'), parse('x y z'));
});

test('괄호는 결합 순서를 바꾼다', () => {
  assert.deepEqual(parse('x (y z)'), App(Var('x'), App(Var('y'), Var('z'))));
});

test('괄호로 묶인 추상화를 인수로 사용한다', () => {
  assert.deepEqual(parse('(λx.x) y'), App(Lambda('x', Var('x')), Var('y')));
});

test('추상화 body는 임의의 식이 될 수 있다', () => {
  assert.deepEqual(parse('λx. x y'), Lambda('x', App(Var('x'), Var('y'))));
  assert.deepEqual(
    parse('λx. (λy. y) x'),
    Lambda('x', App(Lambda('y', Var('y')), Var('x')))
  );
});

test('중첩 혼합 식을 파싱한다', () => {
  assert.deepEqual(
    parse('(λx. λy. x) a b'),
    App(App(Lambda('x', Lambda('y', Var('x'))), Var('a')), Var('b'))
  );
});

test('dumpAst는 트리 문자열을 만든다', () => {
  const text = dumpAst(parse('(λx.x) y'));
  assert.match(text, /app/);
  assert.match(text, /lambda x\./);
  assert.match(text, /var x/);
  assert.match(text, /var y/);
});

test('빈 입력은 위치 0에서 에러', () => {
  assert.throws(
    () => parse(''),
    (e) => e instanceof LambdaSyntaxError && e.pos === 0
  );
});

test('닫는 괄호가 없으면 EOF 위치에서 에러', () => {
  assert.throws(
    () => parse('(λx.x'),
    (e) => e instanceof LambdaSyntaxError && e.pos === 5
  );
  assert.throws(
    () => parse('(x'),
    (e) => e instanceof LambdaSyntaxError && e.pos === 2
  );
});

test('여분의 닫는 괄호는 에러', () => {
  assert.throws(
    () => parse('x)'),
    (e) => e instanceof LambdaSyntaxError && e.pos === 1
  );
});

test('괄호 없는 추상화는 적용의 인수가 될 수 없다', () => {
  assert.throws(
    () => parse('f λx.x'),
    (e) => e instanceof LambdaSyntaxError && e.pos === 2
  );
});

test('파라미터/점 누락은 해당 위치에서 에러', () => {
  assert.throws(
    () => parse('λ.'),
    (e) => e instanceof LambdaSyntaxError && e.pos === 1
  );
  assert.throws(
    () => parse('λx x'),
    (e) => e instanceof LambdaSyntaxError && e.pos === 4
  );
  assert.throws(
    () => parse('λx.'),
    (e) => e instanceof LambdaSyntaxError && e.pos === 3
  );
});

test('식 시작에 잘못된 토큰이면 에러', () => {
  assert.throws(
    () => parse('.x'),
    (e) => e instanceof LambdaSyntaxError && e.pos === 0
  );
  assert.throws(() => parse(')'), LambdaSyntaxError);
});
