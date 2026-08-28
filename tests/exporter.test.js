import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFrameContext, computeFrame, lerpRect } from '../js/animator.js';
import { layoutTreemap } from '../js/treemap.js';
import { parse } from '../js/parser.js';

// GIF 인코딩은 이제 gif.js(jnordberg/gif.js, vendor/) 가 담당하므로 LZW/팔레트/서브블록
// 단위 테스트는 더 이상 의미가 없다 — E2E 디코딩 테스트가 회귀 잡는다.
// 이 파일에는 morph 프레임 계산 + (향후) 기타 exporter 헬퍼 검증만 남긴다.

// ---------- computeFrame math (GUI 없이 morph 만 검증) ----------

test('buildFrameContext + computeFrame: e=0 → 옛 rect, e=1 → 새 rect', () => {
  // redex 를 루트가 아닌 내부에 둔다 (path = ['arg']) — 그래야 root rect 가 양 극값과 일치.
  const oldAst = parse('a ((λx. x) (λy. y))');
  const newAst = parse('a (λy. y)');
  const innerApp = oldAst.arg;
  const redex = { app: innerApp, param: 'x', arg: innerApp.arg };
  const bounds = { x: 0, y: 0, w: 400, h: 300 };
  const ctx = buildFrameContext({ oldAst, newAst, redex, bounds });
  assert.ok(ctx);
  assert.deepEqual(ctx.path, ['arg']);
  const at0 = computeFrame(ctx, 0);
  const at1 = computeFrame(ctx, 1);
  const oldTop = layoutTreemap(oldAst, bounds);
  const newTop = layoutTreemap(newAst, bounds);
  assert.deepEqual(at0.tree.rect, oldTop.rect);
  assert.deepEqual(at1.tree.rect, newTop.rect);
});

test('computeFrame: 중간 e는 rect 가 양 극값 사이의 선형 보간', () => {
  const oldAst = parse('a ((λx. x) (λy. y))');
  const newAst = parse('a (λy. y)');
  const redex = { app: oldAst.arg, param: 'x', arg: oldAst.arg.arg };
  const bounds = { x: 0, y: 0, w: 400, h: 300 };
  const ctx = buildFrameContext({ oldAst, newAst, redex, bounds });
  const oldTop = layoutTreemap(oldAst, bounds);
  const newTop = layoutTreemap(newAst, bounds);
  const expectedHalf = lerpRect(oldTop.rect, newTop.rect, 0.5);
  const atHalf = computeFrame(ctx, 0.5);
  for (const k of ['x', 'y', 'w', 'h']) {
    assert.ok(
      Math.abs(atHalf.tree.rect[k] - expectedHalf[k]) < 0.01,
      `rect.${k}: ${atHalf.tree.rect[k]} vs ${expectedHalf[k]}`
    );
  }
});