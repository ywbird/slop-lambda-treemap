// $ 변수 치환:
// - $<숫자>  → 교회 숫자(Church numeral)로 자동 치환. 예: $2 → (λf. λx. f (f x))
// - $<이름>  → 변수 목록에서 찾아 값으로 치환 (값 안의 $ 참조도 재귀 확장)
// 치환된 값은 항상 괄호로 묶어 적용/추상화 문맥에서 안전하게 조합한다.

const MAX_CHURCH = 100;

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
    const entry = variables.find((v) => v.name === ident);
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
