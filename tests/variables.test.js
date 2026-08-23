import { test } from 'node:test';
import assert from 'node:assert/strict';
import { churchNumeral, expandVariables, churchNumeralOf } from '../js/variables.js';
import { parse } from '../js/parser.js';
import { reduceAll } from '../js/reducer.js';
import { exprToString } from '../js/ast.js';

// ---------- churchNumeralOf (형태 인식) ----------

test('churchNumeralOf: 표준형 인식', () => {
  assert.equal(churchNumeralOf(parse('λf. λx. x')), 0);
  assert.equal(churchNumeralOf(parse('λf. λx. f x')), 1);
  assert.equal(churchNumeralOf(parse('λf. λx. f (f (f x))')), 3);
});

test('churchNumeralOf: 알파 변형(파라미터 이름 무관) 인식', () => {
  assert.equal(churchNumeralOf(parse('λx. λx1. x (x (x x1))')), 3);
  assert.equal(churchNumeralOf(parse('\\s. λz. s (s z)')), 2);
});

test('churchNumeralOf: 교회 숫자가 아니면 null', () => {
  assert.equal(churchNumeralOf(parse('x')), null);
  assert.equal(churchNumeralOf(parse('λf. x')), null);
  assert.equal(churchNumeralOf(parse('λf. λx. f y')), null); // 몸통이 x로 안 끝남
  assert.equal(churchNumeralOf(parse('λf. λx. g (f x)')), null); // 첫 적용이 f가 아님
  assert.equal(churchNumeralOf(parse('λf. λx. f (f (g x))')), null);
  assert.equal(churchNumeralOf(parse('(λf. λx. f x) y')), null); // 전체가 숫자가 아님
});

test('churchNumeralOf: churchNumeral과 왕복', () => {
  for (let n = 0; n <= 5; n++) {
    assert.equal(churchNumeralOf(parse(churchNumeral(n))), n);
  }
});

test('churchNumeralOf: 축약 결과가 교회 숫자인 경우', () => {
  const r = reduceAll(parse(expandVariables('$add $2 $3', [])), { maxSteps: 5000 });
  assert.equal(churchNumeralOf(r.expr), 5);
});

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

// ---------- 기본 변수 (교회 산술) ----------

const reduceTo = (source) =>
  exprToString(reduceAll(parse(expandVariables(source, [])), { maxSteps: 5000 }).expr);

test('기본 변수: $add / $mul', () => {
  assert.equal(reduceTo('$add $2 $3 f x'), 'f (f (f (f (f x))))'); // 2+3=5
  assert.equal(reduceTo('$mul $2 $3 f x'), 'f (f (f (f (f (f x)))))'); // 2*3=6
});

test('기본 변수: $succ / $pred / $sub', () => {
  assert.equal(reduceTo('$succ $2 f x'), 'f (f (f x))'); // 2+1=3
  assert.equal(reduceTo('$pred $3 f x'), 'f (f x)'); // 3-1=2
  assert.equal(reduceTo('$pred $0 f x'), 'x'); // pred 0 = 0
  assert.equal(reduceTo('$sub $5 $2 f x'), 'f (f (f x))'); // 5-2=3
  assert.equal(reduceTo('$sub $2 $5 f x'), 'x'); // clamp: 2-5=0
});

test('기본 변수: $div (정수 나눗셈)', () => {
  assert.equal(reduceTo('$div $7 $2 f x'), 'f (f (f x))'); // 7÷2=3
  assert.equal(reduceTo('$div $6 $2 f x'), 'f (f (f x))'); // 6÷2=3
  assert.equal(reduceTo('$div $0 $3 f x'), 'x'); // 0÷3=0
  assert.equal(reduceTo('$div $5 $5 f x'), 'f x'); // 5÷5=1
});

test('기본 변수는 그대로 참조 가능 ($true 등 보조 변수)', () => {
  assert.equal(reduceTo('$iszero $0 t n'), 't');
  assert.equal(reduceTo('$iszero $2 t n'), 'n');
});

test('사용자 정의가 기본 변수를 덮어씀', () => {
  const vars = [{ name: 'add', value: 'λx. x' }];
  assert.equal(expandVariables('$add y', vars), '(λx. x) y');
});
