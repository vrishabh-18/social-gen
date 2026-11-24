import test from 'node:test';
import assert from 'node:assert/strict';
import { wrapText, captionSvg, fgBox } from './layout.ts';
import { FORMATS } from './formats.ts';

test('wrapText wraps on words and respects the max width', () => {
  assert.deepEqual(wrapText('a bb ccc dddd', 7), ['a bb', 'ccc', 'dddd']);
  for (const l of wrapText('the quick brown fox jumps over the lazy dog', 12)) assert.ok(l.length <= 12, l);
});
test('wrapText splits words longer than a line', () => {
  assert.deepEqual(wrapText('abcdefghij', 4), ['abcd', 'efgh', 'ij']);
});
test('wrapText truncates with an ellipsis after maxLines', () => {
  const lines = wrapText('one two three four five six seven eight nine ten', 8, 3);
  assert.equal(lines.length, 3); assert.ok(lines[2].endsWith('…')); assert.ok(lines.every(l => l.length <= 8));
});
test('wrapText returns no lines for empty input', () => { assert.deepEqual(wrapText('', 10), []); assert.deepEqual(wrapText('   ', 10), []); });

test('captionSvg escapes markup and strips emoji', () => {
  const svg = captionSvg(1080, 1080, '<script>alert(1)</script> 🔥 Deal & more');
  assert.ok(!svg.includes('<script>')); assert.ok(svg.includes('&lt;script&gt;')); assert.ok(svg.includes('&amp;')); assert.ok(!svg.includes('🔥'));
});
test('captionSvg draws no text or gradient for an empty hook', () => {
  const svg = captionSvg(1080, 1080, '🔥🔥');
  assert.ok(!svg.includes('<text') && !svg.includes('<rect'));
});
test('captionSvg keeps text out of the bottom safe zone on tall formats and inside the canvas everywhere', () => {
  for (const f of FORMATS) {
    const ys = [...captionSvg(f.width, f.height, 'A fairly long hook that needs several lines to fit').matchAll(/ y="(\d+)"/g)].map(m => Number(m[1]));
    const lowest = Math.max(...ys.slice(1));
    assert.ok(lowest <= f.height * (f.height > f.width ? 0.83 : 0.93) + 1, f.id);
    assert.ok(Math.min(...ys.slice(1)) > 0, f.id);
  }
});
test('fgBox fits inside every format and leaves room for text', () => {
  for (const f of FORMATS) {
    const b = fgBox(f.width, f.height);
    assert.ok(b.maxW <= f.width && b.top >= 0 && b.top + b.boxH <= f.height * 0.8, f.id);
  }
});
