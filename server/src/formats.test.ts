import test from 'node:test';
import assert from 'node:assert/strict';
import { FORMATS, getFormat } from './formats.ts';

test('format ids are unique and resolvable', () => {
  assert.equal(new Set(FORMATS.map(f => f.id)).size, FORMATS.length);
  for (const f of FORMATS) assert.equal(getFormat(f.id), f);
  assert.equal(getFormat('nope'), undefined);
});
test('every platform has an image format and a video format (so each works without ffmpeg too)', () => {
  for (const p of ['instagram', 'tiktok', 'youtube']) {
    assert.ok(FORMATS.some(f => f.platform === p && f.kind === 'image'), p + ' image');
    assert.ok(FORMATS.some(f => f.platform === p && f.kind === 'video'), p + ' video');
  }
});
test('dimensions follow platform rules (even sizes, 1:1, 9:16 or 16:9)', () => {
  for (const f of FORMATS) {
    assert.ok(f.width % 2 === 0 && f.height % 2 === 0, f.id);
    const ratio = f.width / f.height;
    assert.ok([1, 9 / 16, 16 / 9].some(r => Math.abs(r - ratio) < 0.001), f.id);
  }
});
test('video formats declare a sane duration; image formats do not', () => {
  for (const f of FORMATS) f.kind === 'video' ? assert.ok(f.seconds! >= 3 && f.seconds! <= 60, f.id) : assert.equal(f.seconds, undefined);
});
