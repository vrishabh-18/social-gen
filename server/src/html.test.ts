import test from 'node:test';
import assert from 'node:assert/strict';
import { extractMeta } from './html.ts';

test('reads Open Graph tags', () => {
  const m = extractMeta('<head><title>Fallback</title><meta property="og:title" content="Blue Mug"><meta property="og:description" content="A mug."><meta property="og:image" content="https://cdn.test/mug.jpg"></head>');
  assert.deepEqual(m, { title: 'Blue Mug', description: 'A mug.', image: 'https://cdn.test/mug.jpg' });
});
test('handles reversed attribute order, single and missing quotes, and tag case', () => {
  const m = extractMeta(`<META CONTENT='x.jpg' PROPERTY='og:image'><meta content=Hello property=og:title>`);
  assert.equal(m.image, 'x.jpg'); assert.equal(m.title, 'Hello');
});
test('decodes entities and collapses whitespace', () => {
  const m = extractMeta('<meta property="og:title" content="Tom &amp; Jerry&#39;s &quot;Mug&quot;&#x21;\n  deal"><meta name="description" content="a&nbsp;b">');
  assert.equal(m.title, 'Tom & Jerry\'s "Mug"! deal'); assert.equal(m.description, 'a b');
});
test('falls back to twitter tags, meta description and <title>', () => {
  const m = extractMeta('<title>Page &amp; Co</title><meta name="description" content="Plain"><meta name="twitter:image" content="t.png">');
  assert.deepEqual(m, { title: 'Page & Co', description: 'Plain', image: 't.png' });
});
test('first occurrence wins and a ">" inside a quoted value does not break parsing', () => {
  const m = extractMeta('<meta property="og:title" content="A > B"><meta property="og:title" content="Second">');
  assert.equal(m.title, 'A > B');
});
test('returns empty strings when nothing is present', () => {
  assert.deepEqual(extractMeta('<html><body>hi</body></html>'), { title: '', description: '', image: '' });
  assert.deepEqual(extractMeta(''), { title: '', description: '', image: '' });
});
