import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FORMATS } from './formats.ts';
import { ffmpegAvailable, ffmpegBin, toVideo } from './video.ts';
import { UserError } from './errors.ts';

const has = await ffmpegAvailable();
const probe = (file: string) => {
  const o = execFileSync(ffmpegBin().replace(/ffmpeg(\.exe)?$/, 'ffprobe$1'), ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,codec_name,pix_fmt,nb_read_frames', '-of', 'json', file]);
  return JSON.parse(o.toString()).streams[0];
};

for (const f of FORMATS.filter(f => f.kind === 'video')) {
  test(`renders ${f.id} at exactly ${f.width}x${f.height}, H.264, yuv420p, ${f.seconds}s`, { skip: !has && 'ffmpeg not installed' }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vid-'));
    const png = path.join(dir, 'in.png'), mp4 = path.join(dir, 'out.mp4');
    execFileSync(ffmpegBin(), ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc=s=${f.width}x${f.height}`, '-frames:v', '1', png]);
    await toVideo(png, f, mp4);
    const s = probe(mp4);
    assert.equal(s.width, f.width); assert.equal(s.height, f.height);
    assert.equal(s.codec_name, 'h264'); assert.equal(s.pix_fmt, 'yuv420p');
    assert.equal(Number(s.nb_read_frames), f.seconds! * 25);
    fs.rmSync(dir, { recursive: true, force: true });
  });
}

test('a missing ffmpeg binary gives a readable error', async () => {
  const prev = process.env.FFMPEG_PATH; process.env.FFMPEG_PATH = '/definitely/not/ffmpeg';
  try { await assert.rejects(toVideo('a.png', FORMATS[1], 'b.mp4'), (e: unknown) => e instanceof UserError && /ffmpeg/.test((e as Error).message)); }
  finally { prev === undefined ? delete process.env.FFMPEG_PATH : (process.env.FFMPEG_PATH = prev); }
});
test('a corrupt input image fails without a UserError (logged as a server fault)', { skip: !has && 'ffmpeg not installed' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vid-')); const bad = path.join(dir, 'bad.png'); fs.writeFileSync(bad, 'not an image');
  await assert.rejects(toVideo(bad, FORMATS[1], path.join(dir, 'o.mp4')), (e: unknown) => !(e instanceof UserError));
  fs.rmSync(dir, { recursive: true, force: true });
});
