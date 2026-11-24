import sharp from 'sharp';
import type { Format } from './formats.ts';
import { UserError } from './errors.ts';
import { captionSvg, fgBox } from './layout.ts';

const OPTS = { limitInputPixels: 50_000_000 };
// SVG and PDF are deliberately not allowed. sharp reports AVIF/HEIC as "heif".
const ALLOWED = new Set(['jpeg', 'png', 'webp', 'gif', 'avif', 'heif']);

export async function validateImage(buf: Buffer) {
  try {
    const m = await sharp(buf, OPTS).metadata();
    if (!m.format || !ALLOWED.has(m.format) || !m.width || !m.height) throw new Error('unsupported');
  } catch {
    throw new UserError('That file is not a supported image. Use JPG, PNG, WebP, GIF or AVIF.');
  }
}

// Fits any image into the exact target size: blurred full-bleed background, sharp centered copy, hook text.
export async function composeImage(src: Buffer, f: Format, hook: string, out: string) {
  const { width: w, height: h } = f;
  const img = () => sharp(src, OPTS).rotate().flatten({ background: '#111111' }); // rotate() applies EXIF orientation
  try {
    const bg = await img().resize(w, h, { fit: 'cover' }).blur(30).modulate({ brightness: 0.55 }).png().toBuffer();
    const box = fgBox(w, h);
    const { data, info } = await img().resize(box.maxW, box.boxH, { fit: 'inside' }).png().toBuffer({ resolveWithObject: true });
    await sharp(bg).composite([
      { input: data, left: Math.round((w - info.width) / 2), top: box.top + Math.round((box.boxH - info.height) / 2) },
      { input: Buffer.from(captionSvg(w, h, hook)), left: 0, top: 0 },
    ]).png().toFile(out);
  } catch (e) {
    console.error(e);
    throw new UserError('Could not process that image. Try a different one.');
  }
}
