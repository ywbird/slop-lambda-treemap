import { test } from 'node:test';
import assert from 'node:assert/strict';
import { easeInOutCubic, lerpRect } from '../js/animator.js';

test('easeInOutCubic: 끝점과 중간값', () => {
  assert.equal(easeInOutCubic(0), 0);
  assert.equal(easeInOutCubic(1), 1);
  assert.equal(easeInOutCubic(0.5), 0.5);
});

test('easeInOutCubic: 단조 증가', () => {
  let prev = -Infinity;
  for (let i = 0; i <= 20; i++) {
    const v = easeInOutCubic(i / 20);
    assert.ok(v >= prev, `t=${i / 20}에서 감소함`);
    prev = v;
  }
});

test('lerpRect: t에 따라 from에서 to로 보간', () => {
  const from = { x: 0, y: 10, w: 100, h: 20 };
  const to = { x: 50, y: 30, w: 40, h: 60 };
  assert.deepEqual(lerpRect(from, to, 0), from);
  assert.deepEqual(lerpRect(from, to, 1), to);
  const mid = lerpRect(from, to, 0.5);
  assert.deepEqual(mid, { x: 25, y: 20, w: 70, h: 40 });
});
