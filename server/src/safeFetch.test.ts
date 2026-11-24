import test from 'node:test';
import assert from 'node:assert/strict';
import { isPrivate, safeFetch } from './safeFetch.ts';
import { UserError } from './errors.ts';

const pub = async () => [{ address: '93.184.216.34' }];
const res = (body: string | null, init: ResponseInit = {}) => new Response(body, init);

test('isPrivate flags private, loopback, link-local and mapped addresses', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.5', '172.16.0.1', '172.31.255.255', '169.254.169.254', '0.0.0.0', '224.0.0.1',
    '100.64.0.1', '::1', '::', 'fe80::1', 'fc00::1', 'fd12::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:a00:1', '64:ff9b::1'])
    assert.ok(isPrivate(ip), ip);
});
test('isPrivate allows public addresses', () => {
  for (const ip of ['8.8.8.8', '93.184.216.34', '172.32.0.1', '100.63.255.255', '2606:4700:4700::1111']) assert.ok(!isPrivate(ip), ip);
});
test('rejects non-http schemes and malformed URLs', async () => {
  for (const u of ['file:///etc/passwd', 'ftp://example.com/a', 'javascript:alert(1)', 'not a url'])
    await assert.rejects(safeFetch(u, 1000, { lookup: pub }), UserError, u);
});
test('rejects private IP literals, including IPv6 and obfuscated forms', async () => {
  for (const u of ['http://127.0.0.1/', 'http://[::1]/', 'http://2130706433/', 'http://0x7f.1/', 'http://169.254.169.254/latest/meta-data', 'http://[::ffff:127.0.0.1]/'])
    await assert.rejects(safeFetch(u, 1000, { lookup: pub, fetchImpl: async () => res('x') }), /private|internal/, u);
});
test('rejects hosts that resolve to private addresses, even if only one record is private', async () => {
  await assert.rejects(safeFetch('http://evil.test/', 1000, { lookup: async () => [{ address: '10.0.0.5' }] }), /private/);
  await assert.rejects(safeFetch('http://evil.test/', 1000, { lookup: async () => [{ address: '8.8.8.8' }, { address: '127.0.0.1' }] }), /private/);
});
test('reports unknown hosts clearly', async () => {
  await assert.rejects(safeFetch('http://nope.test/', 1000, { lookup: async () => { throw new Error('ENOTFOUND'); } }), /Could not find that website/);
});
test('blocks a redirect to an internal host and never fetches it', async () => {
  const seen: string[] = [];
  const lookup = async (h: string) => [{ address: h === 'internal.test' ? '127.0.0.1' : '93.184.216.34' }];
  const fetchImpl = (async (u: URL) => { seen.push(u.hostname); return res(null, { status: 302, headers: { location: 'http://internal.test/admin' } }); }) as unknown as typeof fetch;
  await assert.rejects(safeFetch('http://good.test/', 1000, { lookup, fetchImpl }), /private/);
  assert.deepEqual(seen, ['good.test']);
});
test('follows redirects (relative too) and reports the final URL', async () => {
  let n = 0;
  const fetchImpl = (async () => (n++ === 0 ? res(null, { status: 301, headers: { location: '/final' } }) : res('hello', { headers: { 'content-type': 'text/html' } }))) as unknown as typeof fetch;
  const r = await safeFetch('https://shop.test/a', 1000, { lookup: pub, fetchImpl });
  assert.equal(r.buf.toString(), 'hello'); assert.equal(r.type, 'text/html'); assert.equal(r.finalUrl, 'https://shop.test/final');
});
test('gives up after too many redirects', async () => {
  const fetchImpl = (async () => res(null, { status: 302, headers: { location: 'https://shop.test/loop' } })) as unknown as typeof fetch;
  await assert.rejects(safeFetch('https://shop.test/', 1000, { lookup: pub, fetchImpl }), /too many times/);
});
test('enforces the size cap by header and by streamed bytes', async () => {
  await assert.rejects(safeFetch('https://a.test/', 100, { lookup: pub, fetchImpl: (async () => res('x', { headers: { 'content-length': '5000' } })) as unknown as typeof fetch }), /too large/);
  await assert.rejects(safeFetch('https://a.test/', 100, { lookup: pub, fetchImpl: (async () => res('x'.repeat(5000))) as unknown as typeof fetch }), /too large/);
});
test('maps HTTP errors to readable messages', async () => {
  const mk = (status: number) => ({ lookup: pub, fetchImpl: (async () => res('no', { status })) as unknown as typeof fetch });
  await assert.rejects(safeFetch('https://a.test/', 100, mk(403)), /refused the request.*upload/s);
  await assert.rejects(safeFetch('https://a.test/', 100, mk(404)), /no longer exists/);
  await assert.rejects(safeFetch('https://a.test/', 100, mk(500)), /HTTP 500/);
});
test('maps timeouts and network failures to readable messages', async () => {
  const t = Object.assign(new Error('x'), { name: 'TimeoutError' });
  await assert.rejects(safeFetch('https://a.test/', 100, { lookup: pub, fetchImpl: (async () => { throw t; }) as unknown as typeof fetch }), /too long/);
  await assert.rejects(safeFetch('https://a.test/', 100, { lookup: pub, fetchImpl: (async () => { throw new Error('boom'); }) as unknown as typeof fetch }), /Could not reach/);
});
