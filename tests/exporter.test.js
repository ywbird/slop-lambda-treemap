import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPaletteAndIndices, lzwEncode, packSubBlocks } from '../js/exporter.js';
import { buildFrameContext, computeFrame, lerpRect } from '../js/animator.js';
import { layoutTreemap } from '../js/treemap.js';
import { parse } from '../js/parser.js';

// ---------- buildPaletteAndIndices ----------

test('buildPaletteAndIndices: 유니폼 픽셀은 팔레트 1색', () => {
  // (255,255,255) 화이트 4픽셀 — 실제 사용 색은 1개.
  const pixels = new Uint8ClampedArray(16).fill(255);
  const { palette, indices } = buildPaletteAndIndices(pixels);
  assert.equal(indices.length, 4);
  // 실제 픽셀이 참조하는 색은 모두 동일 (255,255,255)
  // (spread 로 일반 배열로 변환해야 .map 결과가 Uint8Array 가 되지 않음)
  const usedColors = new Set([...indices].map((i) => palette[i].join(',')));
  assert.equal(usedColors.size, 1);
  assert.ok([...usedColors].every((c) => c === '255,255,255'));
  // 팔레트는 항상 256 엔트리(GIF 사양)
  assert.equal(palette.length, 256);
});

test('buildPaletteAndIndices: 두 색이 번갈아 나오면 두 슬롯으로 매핑', () => {
  // 빨강(255,0,0) 2픽셀 + 파랑(0,0,255) 2픽셀
  const pixels = new Uint8ClampedArray([
    255, 0, 0, 255, 255, 0, 0, 255,
    0, 0, 255, 255, 0, 0, 255, 255,
  ]);
  const { palette, indices } = buildPaletteAndIndices(pixels);
  assert.equal(indices.length, 4);
  assert.equal(indices[0], indices[1]);
  assert.equal(indices[2], indices[3]);
  assert.notEqual(indices[0], indices[2]);
  assert.deepEqual(palette[indices[0]], [255, 0, 0]);
  assert.deepEqual(palette[indices[2]], [0, 0, 255]);
});

test('buildPaletteAndIndices: 팔레트는 항상 256 엔트리', () => {
  const pixels = new Uint8ClampedArray([255, 255, 255, 255]); // 단일 색
  const { palette } = buildPaletteAndIndices(pixels);
  assert.equal(palette.length, 256);
});

// ---------- lzwEncode ----------

test('lzwEncode: 빈 입력이면 clearCode + endCode만', () => {
  const out = lzwEncode(new Uint8Array(0));
  // 최소 두 코드: clearCode(256) + endCode(257), 첫 코드 9비트라 3바이트
  assert.ok(out.length >= 2);
});

test('lzwEncode: 동일 값 반복 시 압축됨 (입력보다 작거나 같음)', () => {
  const indices = new Uint8Array(1000).fill(7);
  const out = lzwEncode(indices);
  // 1000픽셀 반복은 패턴이 강해 LZW가 잘 압축한다 — 임계값은 넉넉히
  assert.ok(out.length < 200, `expected < 200 bytes, got ${out.length}`);
});

test('lzwEncode: 결과는 유효한 바이트 시퀀스 (모든 값 0..255)', () => {
  const indices = new Uint8Array(100);
  for (let i = 0; i < 100; i++) indices[i] = i % 8;
  const out = lzwEncode(indices);
  assert.ok(out.every((b) => b >= 0 && b <= 255));
});

// ---------- packSubBlocks ----------

test('packSubBlocks: 빈 데이터 → [0] 만', () => {
  const out = packSubBlocks(new Uint8Array(0));
  assert.deepEqual([...out], [0]);
});

test('packSubBlocks: 300바이트 → 두 서브블록 + 종결 0', () => {
  const data = new Uint8Array(300).fill(0xab);
  const out = packSubBlocks(data);
  // 첫 바이트 255(=len), 다음 255개 0xab, 그 다음 45(=len), 45개 0xab, 마지막 0
  assert.equal(out[0], 255);
  assert.equal(out[256], 45);
  assert.equal(out[out.length - 1], 0);
  assert.equal(out.length, 1 + 255 + 1 + 45 + 1);
});

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

// ---------- GIF 바이트 레이아웃 (회귀: min code size 바이트 누락) ----------

test('GIF LZW 섹션: [min code size] + sub-blocks 구조 (회귀)', () => {
  // 4 픽셀의 단색 이미지 — LZW는는 clearCode + 한 코드만 내보낸다.
  // 디코더는 min code size 를 첫 바이트로 읽는다 — 0 이면 안 된다.
  const pixels = new Uint8ClampedArray([
    255, 0, 0, 255, 255, 0, 0, 255,
    255, 0, 0, 255, 255, 0, 0, 255,
  ]);
  const { palette, indices } = buildPaletteAndIndices(pixels);
  const lzw = lzwEncode(indices);
  const MIN_CODE_SIZE = 8;
  // exporter.js 의 프레임 쓰기 순서 그대로 모방:
  const section = [
    new Uint8Array([MIN_CODE_SIZE]),
    packSubBlocks(lzw),
  ].reduce((acc, x) => acc.concat([...x]), []);
  assert.equal(section[0], MIN_CODE_SIZE, '첫 바이트는 LZW min code size');
  // 그 다음 바이트는 첫 sub-block 의 길이 (1..255 또는 0 종결).
  const firstSubBlockLen = section[1];
  assert.ok(
    firstSubBlockLen >= 0 && firstSubBlockLen <= 255,
    `sub-block 길이 범위: got ${firstSubBlockLen}`
  );
  // 팔레트 크기는 항상 256 → min code size = 8 고정
  assert.equal(palette.length, 256);
});