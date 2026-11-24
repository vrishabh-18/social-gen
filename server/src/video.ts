import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Format } from './formats.ts';
import { UserError } from './errors.ts';

const run = promisify(execFile);
export const ffmpegBin = () => process.env.FFMPEG_PATH || 'ffmpeg';

export async function ffmpegAvailable(): Promise<boolean> {
  try { await run(ffmpegBin(), ['-version'], { timeout: 10_000 }); return true; } catch { return false; }
}

export function videoArgs(png: string, f: Format, out: string): string[] {
  const fps = 25, frames = (f.seconds ?? 8) * fps;
  // Upscale 2x before zoompan: it works in whole pixels, so a slow zoom on a 1x source visibly jitters.
  const vf = `scale=${f.width * 2}:${f.height * 2},zoompan=z='min(zoom+0.0006,1.12)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${f.width}x${f.height}:fps=${fps},format=yuv420p`;
  return ['-y', '-loglevel', 'error', '-i', png, '-vf', vf, '-frames:v', String(frames), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-movflags', '+faststart', out];
}

export async function toVideo(png: string, f: Format, out: string) {
  try {
    await run(ffmpegBin(), videoArgs(png, f, out), { timeout: 120_000 });
  } catch (e: any) {
    if (e?.code === 'ENOENT') throw new UserError('Video output needs ffmpeg, which is not installed on the server.');
    if (e?.killed) throw new UserError('Rendering the video took too long. Please try again.');
    throw new Error('ffmpeg failed: ' + String(e?.stderr ?? e?.message).slice(0, 500));
  }
}
