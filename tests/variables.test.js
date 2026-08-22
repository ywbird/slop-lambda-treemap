import { test } from 'node:test';
import assert from 'node:assert/strict';
import { churchNumeral, expandVariables } from '../js/variables.js';
import { parse } from '../js/parser.js';
import { reduceAll } from '../js/reducer.js';
import { exprToString } from '../js/ast.js';

// ---------- churchNumeral ----------

test('churchNumeral: 0, 1, 3 형태', () => {
  assert.equal(churchNumeral(0), '(λf. λx. x)');
  assert.equal(churchNumeral(1), '(λf. λx. f (x))');
  assert.equal(churchNumeral(3), '(λf. λx. f (f (f (x))))');
});

test('churchNumeral: 파싱하면 의미론적으로 올바른 교회 숫자', () => {
  // $3 f x → f (f (f x))
  const r = reduceAll(parse(expandVariables('$3 f x', [])));
  assert.equal(exprToString(r.expr), 'f (f (f x))');
});

// ---------- expandVariables: 숫자 ----------

test('$숫자는 교회 숫자로 치환 (괄호로 안전하게 조합)', () => {
  assert.equal(
    expandVariables('$2 f x', []),
    '(λf. λx. f (f (x))) f x'
  );
});

test('$101처럼 상한 초과는 에러', () => {
  assert.throws(() => expandVariables('$101', []), /\$100까지/);
});

// ---------- expandVariables: 이름 ----------

test('$이름은 정의된 값으로 치환', () => {
  const vars = [{ name: 'id', value: 'λx. x' }];
  assert.equal(expandVariables('id $id y', vars), 'id (λx. x) y');
});

test('값 안의 $ 참조도 재귀 확장', () => {
  const vars = [
    { name: 'two', value: '$2' },
    { name: 'four', value: '$two $two' },
  ];
  const expanded = expandVariables('$four f x', vars);
  // $two → (교회숫자)가 이름 치환 괄호로 한 번 더 묶임 — 의미는 동일
  assert.equal(
    expanded,
    '(((λf. λx. f (f (x)))) ((λf. λx. f (f (x))))) f x'
  );
  // 2∘2 = 4이므로 $four f x → f^4 x
  const r = reduceAll(parse(expanded));
  assert.equal(exprToString(r.expr), 'f (f (f (f x)))');
});

test('정의되지 않은 변수는 에러', () => {
  assert.throws(() => expandVariables('f $nope x', []), /정의되지 않은 변수: \$nope/);
});

test('값이 비어 있는 변수는 에러', () => {
  assert.throws(() => expandVariables('$a', [{ name: 'a', value: '' }]), /비어/);
});

test('순환 참조 감지', () => {
  const vars = [
    { name: 'a', value: '$b' },
    { name: 'b', value: '$a' },
  ];
  assert.throws(() => expandVariables('$a', vars), /순환/);
});

test('$ 없는 문자열은 그대로', () => {
  assert.equal(expandVariables('(λx. x) y', [{ name: 'a', value: 'z' }]), '(λx. x) y');
});

// ---------- 통합 ----------

test('치환 결과가 그대로 파싱되어 축약됨 — $1 f x → f x', () => {
  const expanded = expandVariables('$1 f x', []);
  const r = reduceAll(parse(expanded));
  assert.equal(exprToString(r.expr), 'f x');
});
