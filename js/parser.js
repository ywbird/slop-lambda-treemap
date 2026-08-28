// 재귀 하강 파서: 토큰열 → AST
// 문법:
//   expr        := abstraction | application
//   abstraction := (λ|\) IDENT+ . expr     // 여러 파라미터는 커리로 변환
//   application := atom+                   // 좌결합
//   atom        := IDENT | '(' expr ')'
// 괄호 없는 추상화는 최상위 식이나 다른 추상화의 body에서만 허용된다.
// (적용의 인수로 쓰려면 괄호 필수)

import { tokenize, LambdaSyntaxError } from './lexer.js';
import { Var, Lambda, App } from './ast.js';

const TOKEN_DESC = {
  LAMBDA: 'λ',
  DOT: '.',
  LPAREN: '(',
  RPAREN: ')',
};

function describeToken(token) {
  if (token.type === 'IDENT') return token.value;
  if (token.type === 'EOF') return 'end of input';
  return TOKEN_DESC[token.type] ?? token.type;
}

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.i = 0;
  }

  peek() {
    return this.tokens[this.i];
  }

  advance() {
    return this.tokens[this.i++];
  }

  expect(type, what) {
    const token = this.peek();
    if (token.type !== type) {
      throw new LambdaSyntaxError(
        `Expected ${what} but found '${describeToken(token)}'`,
        token.pos
      );
    }
    return this.advance();
  }

  parseExpr() {
    return this.peek().type === 'LAMBDA'
      ? this.parseAbstraction()
      : this.parseApplication();
  }

  parseAbstraction() {
    this.expect('LAMBDA', 'λ 또는 \\');

    const params = [];
    do {
      params.push(this.expect('IDENT', 'a parameter name').value);
    } while (this.peek().type === 'IDENT');
    this.expect('DOT', "'.'");

    let body = this.parseExpr();
    for (let k = params.length - 1; k >= 0; k--) {
      body = Lambda(params[k], body);
    }
    return body;
  }

  parseApplication() {
    let left = this.parseAtom();
    while (this.peek().type === 'IDENT' || this.peek().type === 'LPAREN') {
      left = App(left, this.parseAtom());
    }
    return left;
  }

  parseAtom() {
    const token = this.peek();
    if (token.type === 'IDENT') {
      this.advance();
      return Var(token.value);
    }
    if (token.type === 'LPAREN') {
      this.advance();
      const expr = this.parseExpr();
      this.expect('RPAREN', "')'");
      return expr;
    }
    throw new LambdaSyntaxError(
      `Expected a variable or '(' but found '${describeToken(token)}'`,
      token.pos
    );
  }
}

/**
 * 람다 대수 식 문자열을 파싱해 AST를 반환한다.
 * @param {string} source
 * @returns {object} AST 루트 노드
 * @throws {LambdaSyntaxError}
 */
export function parse(source) {
  const parser = new Parser(tokenize(source));
  const ast = parser.parseExpr();
  const trailing = parser.peek();
  if (trailing.type !== 'EOF') {
    throw new LambdaSyntaxError(
      `Unexpected token '${describeToken(trailing)}'`,
      trailing.pos
    );
  }
  return ast;
}
