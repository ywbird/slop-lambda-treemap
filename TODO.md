# Lambda Treemap — 구현 TODO

라이브러리 없이 HTML + Vanilla JS + CSS만으로 람다 대수 식을 파싱하고,
베타 축약을 시각화하는 간단한 웹 사이트를 만든다.

> 규칙: 외부 라이브러리/프레임워크 사용 금지. 표준 웹 API만 사용.
> 규칙: 변경/기능 추가마다 새 commit 작성 (첫 commit 전 `git init`).

---

## 0. 프로젝트 구조 세팅

- [x] `index.html` — 입력 폼 + `<canvas>` 기본 골격
- [x] `css/style.css` — 기본 레이아웃/테마
- [x] `js/` 디렉터리 및 모듈 분리 (ES modules)
  - `lexer.js` / `parser.js` / `ast.js` / `reducer.js` / `treemap.js` / `renderer.js` / `animator.js` / `main.js`
- [x] `package.json` (`type: module`, `npm test` = `node --test tests/`)

---

## 1. 렉서 (Lexer)

- [ ] 토큰 정의
  - `LAMBDA`: `λ` 또는 `\`
  - `DOT`: `.`
  - `IDENT`: 알파벳/숫자 식별자 (변수명)
  - `LPAREN` / `RPAREN`
  - `EOF`
- [ ] 공백 스킵
- [ ] 잘못된 문자/토큰에 대한 에러 메시지 (위치 포함)
- [ ] 입력: `(λx. x) y` 같은 표준 문법 지원

---

## 2. 파서 (Parser) → AST

- [ ] 재귀 하강 파서, 문법:
  ```
  expr       := abstraction | application
  abstraction := (λ|\) IDENT+ . expr      // 여러 파라미터는 커리 지원
  application := atom+                     // 좌결합 (left-associative)
  atom       := IDENT | '(' expr ')'
  ```
- [ ] AST 노드 타입
  - `{ type: 'var', name }`
  - `{ type: 'lambda', param, body }` (abstraction)
  - `{ type: 'app', func, arg }` (application)
- [ ] 파싱 실패 시 위치 정보와 함께 에러 표시
- [ ] 파싱된 AST를 텍스트/트리 형태로 콘솔 또는 화면에 출력해 디버깅 가능하게

---

## 3. 베타 축약 (Beta Reduction)

- [ ] 자유 변수(free variable) 계산 함수
- [ ] 대입(substitution) 함수 `subst(expr, name, replacement)`
  - **변수 캡처 주의**: 충돌 시 알파 변환(alpha conversion, 파라미터 이름 변경) 수행
- [ ] 한 단계 축약 함수 (normal order: leftmost-outermost redex 탐색)
  - 축약 가능한 redex가 없으면 종료 상태 반환
  - 어떤 `app` 노드가 축약되었는지 정보를 반환 (애니메이션에 필요)
- [ ] 전체 축약 루프 (스텝별 / 자동 진행)
- [ ] 무한 루프 방지: 최대 스텝 수 제한
- [ ] 람다 식을 문자열로 되돌리는 pretty-printer (괄호 최소화)

---

## 4. 트리맵 레이아웃 (Treemap Layout)

AST 기반 2D binary treemap의 사각형 영역을 계산한다.

- [ ] 각 노드에 가중치 부여 (예: 리프 개수 기반 면적 분배)
- [ ] 노드별 렌더링 규칙
  - **변수(var)**: 고유 색으로 채운 사각형
    - 변수 이름 → 해시 → 색상(HSL 등) 매핑으로 unique color 보장
    - 같은 이름(또는 같은 바인딩)의 변수는 항상 같은 색
  - **추상화(lambda)**: 사각형 **테두리만** 그리고 내부에 body의 treemap 배치
  - **적용(app)**: 사각형을 분할해 `func`(대상 식)과 `arg`(대입 식)을 **좌우 또는 상하**로 배치
    - 깊이에 따라 좌우/상하 교차 (aspect ratio 개선) 또는 고정 규칙 중 하나 선택
- [ ] 색상 안정성 고려
  - 알파 변환으로 변수명이 바뀌어도 시각적 연속성 유지되도록
  - (예: 바인딩마다 고유 ID를 부여하고 ID 기반으로 색 할당)

---

## 5. Canvas 렌더러

- [ ] 트리맵 레이아웃 결과를 canvas에 그리기
  - 채운 사각형(변수), 테두리 사각형(추상화), 분할(적용)
- [ ] devicePixelRatio 처리로 선명한 렌더링
- [ ] 리사이즈 대응
- [ ] (선택) 호버 시 노드 정보 표시

---

## 6. 베타 축약 애니메이션

- [ ] 축약 발생 시:
  1. `app` 노드의 `arg`에 해당하는 treemap 사각형(들)을 **복제**
  2. `func` 내부에서 파라미터 변수에 해당하는 위치(들)로 **interpolate** 이동
     - 위치 + 크기 보간 (x, y, w, h)
     - 변수 발생이 여러 곳이면 전부 복제해 동시에 이동
  3. 애니메이션 완료 후 새 AST로 재레이아웃/재렌더
- [ ] 이징 함수 (ease-in-out 등)
- [ ] requestAnimationFrame 기반 애니메이션 루프
- [ ] 스텝 축약 / 자동 축약(연속 재생) 모드

---

## 7. UI / 마무리

- [ ] 입력: 람다 식 텍스트 입력 + 예시 프리셋 (예: `(λx. λy. x) a b`)
- [ ] 버튼: 파싱, 한 스텝 축약, 자동 축약, 초기화
- [ ] 현재 식(pretty-printed) 표시, 축약 횟수 표시
- [ ] 에러 메시지 표시 영역
- [ ] 전체 동작 수동 테스트 및 폴리싱

---

## 기술적 주의사항 (구현 시 참고)

- **변수 캡처**: 순진한 subst는 `λy. λx. y` 계열 식에서 의미가 변한다. 알파 변환 필수.
- **색상 일관성**: 축약 후 변수명/바인딩이 변해도 treemap 색이 갑자기 바뀌지 않도록 색 키 설계.
- **무한 축소**: `(λx. x x) (λx. x x)` 같은 식은 정규형이 없다 — 최대 스텝 필요.
- **문자 인코딩**: `λ` 입력이 번거로우면 `\` 허용 (렉서에서 둘 다 받기).
