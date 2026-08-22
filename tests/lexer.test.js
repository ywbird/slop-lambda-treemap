import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, LambdaSyntaxError } from '../js/lexer.js';

test('단일 변수 하나를 토큰화한다', () => {
  assert.deepEqual(tokenize('x'), [
    { type: 'IDENT', value: 'x', pos: 0 },
    { type: 'EOF', pos: 1 },
  ]);
});

test('λ와 \\를 동일하게 LAMBDA 토큰으로 인식한다', () => {
  assert.deepEqual(tokenize('λx.x'), tokenize('\\x.x'));
  assert.deepEqual(tokenize('\\x.x'), [
    { type: 'LAMBDA', pos: 0 },
    { type: 'IDENT', value: 'x', pos: 1 },
    { type: 'DOT', pos: 2 },
    { type: 'IDENT', value: 'x', pos: 3 },
    { type: 'EOF', pos: 4 },
  ]);
});

test('공백 없는 인접 토큰을 분리한다', () => {
  assert.deepEqual(tokenize('(λx.x)y'), [
    { type: 'LPAREN', pos: 0 },
    { type: 'LAMBDA', pos: 1 },
    { type: 'IDENT', value: 'x', pos: 2 },
    { type: 'DOT', pos: 3 },
    { type: 'IDENT', value: 'x', pos: 4 },
    { type: 'RPAREN', pos: 5 },
    { type: 'IDENT', value: 'y', pos: 6 },
    { type: 'EOF', pos: 7 },
  ]);
});

test('연속된 변수(적용)를 토큰화한다', () => {
  const tokens = tokenize('x y z');
  assert.deepEqual(tokens.map(t => t.type), ['IDENT', 'IDENT', 'IDENT', 'EOF']);
  assert.deepEqual(tokens.map(t => t.value), ['x', 'y', 'z', undefined]);
});

test('여러 문자 식별자를 하나의 IDENT로 묶는다', () => {
  const tokens = tokenize('foo bar1 _baz');
  assert.deepEqual(tokens.map(t => t.value), ['foo', 'bar1', '_baz', undefined]);
});

test('공백과 줄바꿈을 건너뛴다', () => {
  const tokens = tokenize('  x\n\ty  ');
  assert.deepEqual(tokens.map(t => t.type), ['IDENT', 'IDENT', 'EOF']);
});

test('빈 입력은 EOF만 반환한다', () => {
  assert.deepEqual(tokenize(''), [{ type: 'EOF', pos: 0 }]);
  assert.deepEqual(tokenize('   '), [{ type: 'EOF', pos: 3 }]);
});

test('허용되지 않는 문자에서 위치와 함께 에러를 던진다', () => {
  assert.throws(
    () => tokenize('λx.x$'),
    (err) => err instanceof LambdaSyntaxError && err.pos === 4 && /'\$'/.test(err.message)
  );
  assert.throws(
    () => tokenize('x - y'),
    (err) => err instanceof LambdaSyntaxError && err.pos === 2
  );
});

test('숫자는 식별자의 시작이 될 수 없다', () => {
  assert.throws(() => tokenize('1x'), LambdaSyntaxError);
});

test('중첩 괄호를 토큰화한다', () => {
  assert.deepEqual(
    tokenize('((x))').map(t => t.type),
    ['LPAREN', 'LPAREN', 'IDENT', 'RPAREN', 'RPAREN', 'EOF']
  );
});
