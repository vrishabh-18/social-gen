// End-to-end API tests against the real Express app, real sharp and real ffmpeg.
// Only the outbound URL fetcher is replaced with a fake so no test touches the network.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import sharp from 'sharp';
import { createApp, type AppOptions } from './app.ts';
import { UserError } from './errors.ts';
import { ffmpegAvailable } from './video.ts';

const hasFfmpeg = await ffmpegAvailable();
const dirs: string[] = []; const servers: Server[] = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-')); dirs.push(d); return d; };

let jpeg: Buffer, png: Buffer, exif: Buffer;
const pages: Record<string, { type: string; body?: Buffer | string; error?: Error }> = {};
const fetchUrl: AppOptions['fetchUrl'] = async (url) => {
  const p = pages[url];
  if (!p) throw new UserError('That page or image no longer exists (HTTP 404).');
  if (p.error) throw p.error;
  return { buf: Buffer.from(p.body ?? ''), type: p.type, finalUrl: url };
};

async function start(extra: Partial<AppOptions> = {}) {
  const dataDir = extra.dataDir ?? tmp();
  const app = await createApp({ dataDir, fetchUrl, videoEnabled: hasFfmpeg, ...extra });
  const server = await new Promise<Server>(res => { const s = app.listen(0, '127.0.0.1', () => res(s)); });
  servers.push(server);
  return { dataDir, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}
const post = (base: string, fields: Record<string, string>, file?: { name: string; type: string; data: Buffer }) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  if (file) fd.append('file', new Blob([file.data], { type: file.type }), file.name);
  return fetch(base + '/api/jobs', { method: 'POST', body: fd });
};
const waitDone = async (base: string, id: string) => {
  for (let i = 0; i < 300; i++) {
    const j: any = await (await fetch(`${base}/api/jobs/${id}`)).json();
    if (j.status === 'done' || j.status === 'failed') return j;
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('job did not finish');
};
const upload = async (base: string, formatId: string, f = { name: 'mug.jpg', type: 'image/jpeg', data: jpeg }) => {
  const r = await post(base, { formatId }, f); assert.equal(r.status, 202); return waitDone(base, ((await r.json()) as any).id);
};

let main: { dataDir: string; base: string };
before(async () => {
  jpeg = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#3355aa' } }).jpeg().toBuffer();
  png = await sharp({ create: { width: 300, height: 300, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0.5 } } }).png().toBuffer();
  exif = await sharp({ create: { width: 400, height: 200, channels: 3, background: '#aa3355' } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const html = (b: string) => ({ type: 'text/html; charset=utf-8', body: `<html><head><title>T</title>${b}</head></html>` });
  pages['https://shop.test/product'] = html('<meta property="og:title" content="Blue Mug"><meta property="og:image" content="/img/mug.jpg">');
  pages['https://shop.test/img/mug.jpg'] = { type: 'image/jpeg', body: jpeg };
  pages['https://shop.test/direct.png'] = { type: 'image/png', body: png };
  pages['https://shop.test/octet'] = { type: 'application/octet-stream', body: jpeg }; // wrong content-type, still a valid image
  pages['https://shop.test/noimage'] = html('<meta property="og:title" content="No image">');
  pages['https://shop.test/badimg'] = html('<meta property="og:image" content="/img/missing.jpg">');
  pages['https://shop.test/notimage'] = { type: 'application/octet-stream', body: 'hello' };
  pages['https://shop.test/blocked'] = { type: '', error: new UserError('The website refused the request (HTTP 403). Try uploading the image instead.') };
  pages['https://shop.test/crash'] = { type: '', error: new Error('secret internal boom') };
  main = await start();
});
after(() => { for (const s of servers) { s.close(); s.closeAllConnections(); } for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

test('GET /api/formats lists every format with availability', async () => {
  const f: any[] = await (await fetch(main.base + '/api/formats')).json();
  assert.equal(f.length, 7); assert.ok(f.every(x => typeof x.available === 'boolean'));
  assert.ok(f.filter(x => x.kind === 'image').every(x => x.available));
});
test('image upload -> Instagram post: exact 1080x1080 PNG, preview URL, download as attachment', async () => {
  const j = await upload(main.base, 'ig-post');
  assert.equal(j.status, 'done'); assert.equal(j.format.kind, 'image'); assert.ok(j.outputUrl.endsWith('.png'));
  const img = Buffer.from(await (await fetch(main.base + j.outputUrl)).arrayBuffer());
  const m = await sharp(img).metadata(); assert.equal(m.format, 'png'); assert.equal(m.width, 1080); assert.equal(m.height, 1080);
  const d = await fetch(main.base + j.downloadUrl);
  assert.match(d.headers.get('content-disposition')!, /attachment.*ig-post-1080x1080\.png/);
  assert.match(d.headers.get('content-type')!, /image\/png/);
  assert.ok(j.copy.hook && j.copy.caption && j.copy.hashtags.length);
});
test('the job carries its own format, so the preview never depends on the current dropdown', async () => {
  const j = await upload(main.base, 'ig-post');
  assert.equal(j.format.id, 'ig-post'); assert.equal(j.format.width, 1080);
  assert.ok(j.outputUrl.endsWith('.png') && j.downloadUrl.includes(j.id));
});
test('video format -> real MP4 with video content type, intermediate PNG removed', { skip: !hasFfmpeg && 'ffmpeg not installed' }, async () => {
  const j = await upload(main.base, 'ig-reel');
  assert.equal(j.status, 'done'); assert.ok(j.outputUrl.endsWith('.mp4'));
  const d = await fetch(main.base + j.downloadUrl);
  assert.match(d.headers.get('content-type')!, /video\/mp4/); assert.match(d.headers.get('content-disposition')!, /ig-reel-1080x1920\.mp4/);
  assert.ok((await d.arrayBuffer()).byteLength > 1000);
  assert.equal((await fetch(main.base + j.outputUrl.replace('.mp4', '.png'))).status, 404);
});
test('same image, image then video: each result keeps its own type and download', { skip: !hasFfmpeg && 'ffmpeg not installed' }, async () => {
  const a = await upload(main.base, 'ig-post'); const b = await upload(main.base, 'tt-video');
  assert.ok(a.downloadUrl !== b.downloadUrl);
  assert.match((await fetch(main.base + a.downloadUrl)).headers.get('content-type')!, /image/);
  assert.match((await fetch(main.base + b.downloadUrl)).headers.get('content-type')!, /video/);
});
test('accepts PNG with transparency, and phone photos with EXIF orientation', async () => {
  assert.equal((await upload(main.base, 'ig-post', { name: 'a.png', type: 'image/png', data: png })).status, 'done');
  assert.equal((await upload(main.base, 'ig-post', { name: 'b.jpg', type: 'image/jpeg', data: exif })).status, 'done');
});
test('URL flow: product page with a relative og:image', async () => {
  const r = await post(main.base, { formatId: 'ig-post', url: 'https://shop.test/product' });
  const j = await waitDone(main.base, ((await r.json()) as any).id);
  assert.equal(j.status, 'done');
});
test('URL flow: a direct image link works (the case that previously failed)', async () => {
  const r = await post(main.base, { formatId: 'ig-post', url: 'https://shop.test/direct.png' });
  assert.equal((await waitDone(main.base, ((await r.json()) as any).id)).status, 'done');
});
test('URL flow: an image served with a generic content-type still works', async () => {
  const r = await post(main.base, { formatId: 'ig-post', url: 'https://shop.test/octet' });
  assert.equal((await waitDone(main.base, ((await r.json()) as any).id)).status, 'done');
});
test('URL flow failures show readable errors and never leak internals', async () => {
  const cases: [string, RegExp][] = [
    ['https://shop.test/noimage', /No product image found/], ['https://shop.test/badimg', /no longer exists/],
    ['https://shop.test/notimage', /not a supported image/], ['https://shop.test/blocked', /refused the request/],
    ['https://shop.test/crash', /Something went wrong/], ['https://shop.test/unknown', /no longer exists/],
  ];
  for (const [url, re] of cases) {
    const r = await post(main.base, { formatId: 'ig-post', url });
    const j = await waitDone(main.base, ((await r.json()) as any).id);
    assert.equal(j.status, 'failed', url); assert.match(j.error, re, url); assert.ok(!/boom/.test(j.error), url);
    assert.equal(j.downloadUrl, undefined);
  }
});
test('input validation returns 400 with a message', async () => {
  const bad = async (fields: Record<string, string>, file?: Parameters<typeof post>[2]) => { const r = await post(main.base, fields, file); assert.equal(r.status, 400); return ((await r.json()) as any).error as string; };
  assert.match(await bad({ formatId: 'ig-post' }), /Paste a product link/);
  assert.match(await bad({ formatId: 'nope', url: 'https://shop.test/product' }), /Choose a platform/);
  assert.match(await bad({ url: 'https://shop.test/product' }), /Choose a platform/);
  assert.match(await bad({ formatId: 'ig-post', url: 'ftp://shop.test/a' }), /valid link/);
  assert.match(await bad({ formatId: 'ig-post', url: 'banana' }), /valid link/);
  assert.match(await bad({ formatId: 'ig-post' }, { name: 'x.txt', type: 'text/plain', data: Buffer.from('hello') }), /not a supported image/);
  assert.match(await bad({ formatId: 'ig-post' }, { name: 'x.svg', type: 'image/svg+xml', data: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>') }), /not a supported image/);
});
test('files over 8 MB are rejected with 413', async () => {
  const r = await post(main.base, { formatId: 'ig-post' }, { name: 'big.jpg', type: 'image/jpeg', data: Buffer.alloc(9 * 1024 * 1024, 1) });
  assert.equal(r.status, 413); assert.match(((await r.json()) as any).error, /8 MB/);
});
test('unknown job ids return 404 for status and download', async () => {
  assert.equal((await fetch(main.base + '/api/jobs/nope')).status, 404);
  assert.equal((await fetch(main.base + '/api/jobs/nope/download')).status, 404);
});
test('a failed job has no download', async () => {
  const r = await post(main.base, { formatId: 'ig-post', url: 'https://shop.test/noimage' });
  const j = await waitDone(main.base, ((await r.json()) as any).id);
  assert.equal((await fetch(main.base + `/api/jobs/${j.id}/download`)).status, 404);
});
test('several jobs queued at once all finish, in order', async () => {
  const ids = await Promise.all([1, 2, 3].map(async () => ((await (await post(main.base, { formatId: 'ig-post' }, { name: 'q.jpg', type: 'image/jpeg', data: jpeg })).json()) as any).id));
  for (const id of ids) assert.equal((await waitDone(main.base, id)).status, 'done');
});
test('video formats are refused cleanly when ffmpeg is unavailable', async () => {
  const s = await start({ videoEnabled: false });
  const f: any[] = await (await fetch(s.base + '/api/formats')).json();
  assert.ok(f.filter(x => x.kind === 'video').every(x => x.available === false));
  const r = await post(s.base, { formatId: 'ig-reel' }, { name: 'a.jpg', type: 'image/jpeg', data: jpeg });
  assert.equal(r.status, 400); assert.match(((await r.json()) as any).error, /ffmpeg/);
  assert.equal((await upload(s.base, 'ig-post')).status, 'done');
});
test('rate limit applies to creating jobs but never to status polling', async () => {
  const s = await start({ rateLimitPerMin: 3 });
  for (let i = 0; i < 3; i++) assert.equal((await post(s.base, { formatId: 'ig-post' })).status, 400);
  const r = await post(s.base, { formatId: 'ig-post' });
  assert.equal(r.status, 429); assert.match(((await r.json()) as any).error, /Too many requests/);
  for (let i = 0; i < 60; i++) assert.equal((await fetch(s.base + '/api/jobs/x')).status, 404);
});
test('jobs persist across restarts and interrupted jobs are marked failed', async () => {
  const dataDir = tmp();
  const a = await start({ dataDir });
  const j = await upload(a.base, 'ig-post');
  const file = path.join(dataDir, 'jobs.json');
  const jobs = JSON.parse(fs.readFileSync(file, 'utf8'));
  jobs.push({ ...jobs[0], id: 'stuck', status: 'processing', file: undefined });
  fs.writeFileSync(file, JSON.stringify(jobs));
  const b = await start({ dataDir });
  assert.equal(((await (await fetch(`${b.base}/api/jobs/${j.id}`)).json()) as any).status, 'done');
  const stuck: any = await (await fetch(`${b.base}/api/jobs/stuck`)).json();
  assert.equal(stuck.status, 'failed'); assert.match(stuck.error, /restarted/);
});
test('a corrupt jobs file does not stop the server from starting', async () => {
  const dataDir = tmp(); fs.writeFileSync(path.join(dataDir, 'jobs.json'), '{{{ not json');
  const s = await start({ dataDir });
  assert.equal((await fetch(s.base + '/health')).status, 200);
});
test('a jobs file written by an older version is cleaned up instead of crashing the API', async () => {
  const dataDir = tmp();
  fs.writeFileSync(path.join(dataDir, 'jobs.json'), JSON.stringify([
    { id: 'old-done', status: 'done', formatId: 'ig-post', outputUrl: '/outputs/old.png', createdAt: 1 },
    { id: 'old-failed', status: 'failed', formatId: 'ig-post', error: 'x', step: 'Failed', createdAt: 2 },
  ]));
  const s = await start({ dataDir });
  const list: any[] = await (await fetch(s.base + '/api/jobs')).json();
  assert.ok(list.every(j => j.format && j.format.platform));
  assert.equal(list.some(j => j.id === 'old-done'), false);
});
