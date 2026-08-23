// $ 변수 치환:
// - $<숫자>  → 교회 숫자(Church numeral)로 자동 치환. 예: $2 → (λf. λx. f (f x))
// - $<이름>  → 변수 목록에서 찾아 값으로 치환 (값 안의 $ 참조도 재귀 확장)
// 치환된 값은 항상 괄호로 묶어 적용/추상화 문맥에서 안전하게 조합한다.

const MAX_CHURCH = 100;

// 기본 변수: 사용자 목록에 없을 때 사용되는 내장 정의.
// div는 CPS 방식 쌍(λk. k q c)으로 상태를 단계당 1회만 소비하는 카운트다운
// 반복이라 normal order 축약에서 폭발하지 않음: c가 1이 되면(그룹 완료)
// 몫 +1 후 c를 b로 리셋. b가 0이면 정의되지 않음(n과 같은 값이 나옴).
export const DEFAULT_VARIABLES = [
  { name: 'true', value: 'λt. λf. t' },
  { name: 'false', value: 'λt. λf. f' },
  { name: 'pair', value: 'λa. λb. λs. s a b' },
  { name: 'fst', value: 'λp. p $true' },
  { name: 'snd', value: 'λp. p $false' },
  { name: 'iszero', value: 'λn. n (λx. $false) $true' },
  { name: 'succ', value: 'λn. λf. λx. f (n f x)' },
  { name: 'pred', value: 'λn. λf. λx. n (λg. λh. h (g f)) (λu. x) (λu. u)' },
  { name: 'add', value: 'λm. λn. λf. λx. m f (n f x)' },
  { name: 'mul', value: 'λm. λn. λf. m (n f)' },
  { name: 'sub', value: 'λm. λn. n $pred m' },
  {
    name: 'div',
    value:
      'λa. λb. $fst (a (λg. g (λq. λc. $iszero ($pred c) ($pair ($succ q) b) ($pair q ($pred c)))) ($pair $0 b))',
  },
];

/**
 * n에 해당하는 교회 숫자 식 문자열 (괄호로 묶임).
 * @param {number} n
 * @returns {string}
 */
export function churchNumeral(n) {
  let body = 'x';
  for (let i = 0; i < n; i++) {
    body = `f (${body})`;
  }
  return `(λf. λx. ${body})`;
}

/**
 * 식이 교회 숫자 형태면 그 값을, 아니면 null을 반환한다.
 * 형태: λf. λx. f (f (... (f x))) — 파라미터 이름은 무관(알파 변형 허용),
 * λf. λx. x 는 0.
 * @param {object} node AST 루트
 * @returns {number|null}
 */
export function churchNumeralOf(node) {
  if (node.type !== 'lambda' || node.body.type !== 'lambda') {
    return null;
  }
  const f = node.param;
  const x = node.body.param;
  let body = node.body.body;
  let count = 0;
  while (body.type === 'app' && body.func.type === 'var' && body.func.name === f) {
    count++;
    body = body.arg;
  }
  return body.type === 'var' && body.name === x ? count : null;
}

/**
 * 소스의 $<숫자>, $<이름>을 치환한 문자열을 반환한다.
 * @param {string} source 원본 식
 * @param {{name: string, value: string}[]} variables 변수 목록
 * @param {Set<string>} [_expanding] 순환 참조 감지용(내부 사용)
 * @returns {string}
 * @throws {Error} 정의되지 않은 변수 / 값 비어 있음 / 순환 참조 / 숫자 상한 초과
 */
export function expandVariables(source, variables, _expanding = new Set()) {
  return source.replace(/\$([A-Za-z_][A-Za-z0-9_]*|[0-9]+)/g, (whole, ident) => {
    if (/^[0-9]+$/.test(ident)) {
      const n = Number(ident);
      if (n > MAX_CHURCH) {
        throw new Error(`숫자 변수는 $${MAX_CHURCH}까지 지원합니다 (${whole})`);
      }
      return churchNumeral(n);
    }
    // 사용자 정의가 우선, 없으면 기본 변수 사용
    const entry =
      variables.find((v) => v.name === ident) ??
      DEFAULT_VARIABLES.find((v) => v.name === ident);
    if (!entry) {
      throw new Error(`정의되지 않은 변수: ${whole}`);
    }
    if (entry.value === '') {
      throw new Error(`변수 ${whole}의 값이 비어 있습니다`);
    }
    if (_expanding.has(ident)) {
      const chain = [..._expanding, ident].map((s) => `$${s}`).join(' → ');
      throw new Error(`변수 순환 참조: ${chain}`);
    }
    _expanding.add(ident);
    try {
      // 괄호로 묶어 적용 문맥에서 안전하게 조합 (λx. x → (λx. x))
      return `(${expandVariables(entry.value, variables, _expanding)})`;
    } finally {
      _expanding.delete(ident);
    }
  });
}
