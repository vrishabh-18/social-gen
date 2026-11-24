import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeJobs } from './jobs.ts';

const good = { id: 'a', status: 'done', step: 'Done', progress: 100, format: { id: 'ig-post' }, source: 'x', file: 'a.png', createdAt: 1, copy: { hook: 'h', caption: 'c', hashtags: ['#a'] } };

test('keeps valid jobs and restores the canonical format', () => {
  const [j] = sanitizeJobs([good]);
  assert.equal(j.format.width, 1080); assert.equal(j.format.platform, 'instagram'); assert.equal(j.file, 'a.png');
});
test('repairs a legacy job that only had formatId', () => {
  const [j] = sanitizeJobs([{ ...good, format: undefined, formatId: 'tt-video', status: 'failed', file: undefined }]);
  assert.equal(j.format.id, 'tt-video'); assert.equal(j.status, 'failed');
});
test('drops legacy done jobs (no file), unknown formats, bad statuses and junk', () => {
  const legacyDone = { id: 'old', status: 'done', formatId: 'ig-post', outputUrl: '/outputs/old.png', createdAt: 1 };
  assert.deepEqual(sanitizeJobs([legacyDone, { ...good, format: { id: 'gone' } }, { ...good, status: 'weird' }, null, 5, {}, { id: 1 }]), []);
});
test('tolerates non-array input and malformed copy', () => {
  assert.deepEqual(sanitizeJobs(null), []); assert.deepEqual(sanitizeJobs({}), []);
  assert.equal(sanitizeJobs([{ ...good, copy: { hook: 5 } }])[0].copy, undefined);
});
