// 렉서: 람다 대수 식 문자열 → 토큰열
// 토큰: LAMBDA(λ 또는 \), DOT(.), IDENT, LPAREN, RPAREN, EOF
// 각 토큰은 위치(0-based)를 가지며, 파서의 에러 메시지에 사용된다.

export class LambdaSyntaxError extends Error {
  constructor(message, pos) {
    super(`${message} (위치: ${pos}번째 문자)`);
    this.name = 'LambdaSyntaxError';
    this.pos = pos;
  }
}

const IDENT_START = /[A-Za-z_]/;
const IDENT_CHAR = /[A-Za-z0-9_]/;

/**
 * 람다 대수 식을 토큰화한다.
 * @param {string} source
 * @returns {Array<{type: string, value?: string, pos: number}>} 토큰 배열 (마지막은 항상 EOF)
 * @throws {LambdaSyntaxError} 허용되지 않는 문자가 있을 때
 */
export function tokenize(source) {
  if (typeof source !== 'string') {
    throw new LambdaSyntaxError('입력은 문자열이어야 합니다', 0);
  }

  const tokens = [];
  const n = source.length;
  let i = 0;

  while (i < n) {
    const ch = source[i];

    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    if (ch === 'λ' || ch === '\\') {
      tokens.push({ type: 'LAMBDA', pos: i });
      i++;
      continue;
    }

    if (ch === '.') {
      tokens.push({ type: 'DOT', pos: i });
      i++;
      continue;
    }

    if (ch === '(') {
      tokens.push({ type: 'LPAREN', pos: i });
      i++;
      continue;
    }

    if (ch === ')') {
      tokens.push({ type: 'RPAREN', pos: i });
      i++;
      continue;
    }

    if (IDENT_START.test(ch)) {
      let j = i + 1;
      while (j < n && IDENT_CHAR.test(source[j])) {
        j++;
      }
      tokens.push({ type: 'IDENT', value: source.slice(i, j), pos: i });
      i = j;
      continue;
    }

    throw new LambdaSyntaxError(`허용되지 않는 문자 '${ch}'`, i);
  }

  tokens.push({ type: 'EOF', pos: n });
  return tokens;
}
