import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splashToHsl, hslToSplash, formatHsl } from '../js/treemap.js';
import { parseHsl } from '../js/treemap.js';

// splash 색 형식 (3자리 RGB, 자리당 0..9) 검증 — https://www.todepond.com/lab/splash/

test('splashToHsl: 000=black, 999=white, 900=red, 090=green, 909=magenta', () => {
  assert.deepEqual(splashToHsl('000'), { h: 0, s: 0, l: 0 });
  assert.deepEqual(splashToHsl('999'), { h: 0, s: 0, l: 100 });
  assert.deepEqual(splashToHsl('900'), { h: 0, s: 100, l: 50 });
  assert.deepEqual(splashToHsl('090'), { h: 120, s: 100, l: 50 });
  assert.deepEqual(splashToHsl('909'), { h: 300, s: 100, l: 50 });
});

test('splashToHsl: null on non-3-digit input', () => {
  assert.equal(splashToHsl(''), null);
  assert.equal(splashToHsl('12'), null);
  assert.equal(splashToHsl('abcd'), null);
  assert.equal(splashToHsl('1234'), null);
  assert.equal(splashToHsl(null), null);
});

test('hslToSplash round-trips common splashes', () => {
  assert.equal(hslToSplash('hsl(0, 100%, 50%)'), '900'); // red
  assert.equal(hslToSplash('hsl(120, 100%, 50%)'), '090'); // green
  assert.equal(hslToSplash('hsl(300, 100%, 50%)'), '909'); // magenta
  assert.equal(hslToSplash('hsl(0, 0%, 0%)'), '000'); // black
  assert.equal(hslToSplash('hsl(0, 0%, 100%)'), '999'); // white
});

test('hslToSplash(formatHsl(splashToHsl(x))) x is stable for bright primaries', () => {
  for (const s of ['000', '900', '090', '909', '999']) {
    assert.equal(hslToSplash(formatHsl(splashToHsl(s))), s);
  }
});

test('parseHsl survives in treemap module', () => {
  assert.deepEqual(parseHsl('hsl(30, 40%, 50%)'), { h: 30, s: 40, l: 50 });
});
