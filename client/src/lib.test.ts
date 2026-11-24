import test from 'node:test';
import assert from 'node:assert/strict';
import { validateUrl, validateFile, timeAgo, formatBytes, MAX_UPLOAD } from './lib.ts';

test('validateUrl accepts http(s) links, including long CDN image URLs', () => {
  assert.equal(validateUrl('https://shop.example.com/p/1'), null);
  assert.equal(validateUrl('  http://a.test/x.jpg?sig=abc&_nc_ohc=1  '), null);
  assert.equal(validateUrl('https://instagram.fhyd1-2.fna.fbcdn.net/v/t51.82787-15/928941476_186601.jpg?stp=dst-jpg&_nc_ht=x'), null);
});
test('validateUrl rejects empty, malformed and non-http links', () => {
  assert.match(validateUrl('')!, /Paste/); assert.match(validateUrl('   ')!, /Paste/);
  assert.match(validateUrl('banana')!, /valid link/); assert.match(validateUrl('ftp://a.test/x')!, /http/); assert.match(validateUrl('javascript:alert(1)')!, /http/);
});
test('validateFile checks type and size', () => {
  assert.equal(validateFile({ type: 'image/jpeg', size: 1000 }), null);
  assert.equal(validateFile({ type: 'image/avif', size: MAX_UPLOAD }), null);
  assert.match(validateFile({ type: 'image/png', size: MAX_UPLOAD + 1 })!, /8 MB/);
  for (const type of ['application/pdf', 'image/svg+xml', 'video/mp4', '']) assert.match(validateFile({ type, size: 1 })!, /JPG/, type);
});
test('timeAgo and formatBytes', () => {
  const now = 1_000_000_000;
  assert.equal(timeAgo(now - 5_000, now), 'just now'); assert.equal(timeAgo(now - 5 * 60_000, now), '5 min ago');
  assert.equal(timeAgo(now - 3 * 3600_000, now), '3 h ago'); assert.equal(timeAgo(now - 2 * 86400_000, now), '2 d ago'); assert.equal(timeAgo(now + 9999, now), 'just now');
  assert.equal(formatBytes(10), '1 KB'); assert.equal(formatBytes(2048), '2 KB'); assert.equal(formatBytes(3 * 1024 * 1024), '3.0 MB');
});
