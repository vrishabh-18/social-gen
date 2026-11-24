import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { writeCopy, normalizeCopy, fallbackCopy } from './ai.ts';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; delete process.env.ANTHROPIC_API_KEY; });
const llm = (text: unknown, status = 200) => { globalThis.fetch = (async () => new Response(JSON.stringify({ content: [{ type: 'text', text }] }), { status })) as typeof fetch; };
const p = { title: 'Blue ceramic mug', desc: 'Holds 350ml', platform: 'Instagram' };

test('no API key: returns template copy and makes no network call', async () => {
  globalThis.fetch = (async () => { throw new Error('should not be called'); }) as typeof fetch;
  const c = await writeCopy(p);
  assert.equal(c.hook, 'Blue ceramic mug'); assert.ok(c.hashtags.includes('#ceramic'));
});
test('parses fenced JSON from the model', async () => {
  process.env.ANTHROPIC_API_KEY = 'k';
  llm('```json\n{"hook":"Sip in style","caption":"Your new daily mug","hashtags":["mug","#coffee"]}\n```');
  assert.deepEqual(await writeCopy(p), { hook: 'Sip in style', caption: 'Your new daily mug', hashtags: ['#mug', '#coffee'] });
});
test('falls back on HTTP errors, bad JSON, empty content and network failures', async () => {
  process.env.ANTHROPIC_API_KEY = 'k';
  const fb = fallbackCopy(p.title, p.desc);
  llm('{}', 500); assert.deepEqual(await writeCopy(p), fb);
  llm('sorry, no JSON here'); assert.deepEqual(await writeCopy(p), fb);
  llm('{not json}'); assert.deepEqual(await writeCopy(p), fb);
  globalThis.fetch = (async () => { throw new Error('offline'); }) as typeof fetch; assert.deepEqual(await writeCopy(p), fb);
});
test('normalizeCopy coerces wrong types, caps lengths and falls back per field', () => {
  const fb = fallbackCopy('Mug', '');
  const c = normalizeCopy({ hook: 42, caption: 'x'.repeat(1000), hashtags: ['ok', 7, '', '#', 'two words', null] }, fb);
  assert.equal(c.hook, fb.hook); assert.equal(c.caption.length, 300); assert.deepEqual(c.hashtags, ['#ok', '#twowords']);
  assert.deepEqual(normalizeCopy(null, fb), fb); assert.deepEqual(normalizeCopy('str', fb), fb);
});
test('fallback copy handles empty input', () => {
  const c = fallbackCopy('', '');
  assert.ok(c.hook && c.caption && c.hashtags.length);
});
