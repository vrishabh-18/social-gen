// Pure layout maths for the composed frame, kept free of image libraries so it is unit-testable.
const strip = (s: string) => s.replace(/[\u{1F000}-\u{1FFFF}\u{2190}-\u{2BFF}\u{FE0F}\u{200D}]/gu, '').replace(/\s+/g, ' ').trim();
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function wrapText(s: string, max: number, maxLines = 3): string[] {
  const words = s.split(' ').filter(Boolean).flatMap(w => (w.length > max ? w.match(new RegExp(`.{1,${max}}`, 'g'))! : [w]));
  const lines: string[] = []; let cur = '';
  for (const w of words) {
    const next = cur ? cur + ' ' + w : w;
    if (next.length > max) { lines.push(cur); cur = w; } else cur = next;
  }
  if (cur) lines.push(cur);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = kept[maxLines - 1].slice(0, Math.max(0, max - 1)).trimEnd() + '…';
  return kept;
}

// Product photo sits in the upper area; text sits above the bottom margin. On tall formats the bottom
// ~17% is covered by app UI (captions, buttons), so we keep text out of it.
export function fgBox(w: number, h: number) {
  const tall = h > w;
  return { maxW: Math.round(w * 0.88), boxH: Math.round(h * (tall ? 0.56 : 0.64)), top: Math.round(h * (tall ? 0.1 : 0.06)) };
}

export function captionSvg(w: number, h: number, hook: string): string {
  const text = strip(hook);
  const size = Math.round(Math.min(w, h) * 0.065);
  const maxChars = Math.floor((w * 0.86) / (size * 0.6));
  const lines = wrapText(text, maxChars);
  const bottom = Math.round(h * (1 - (h > w ? 0.17 : 0.07)));
  const lh = Math.round(size * 1.25);
  const gradTop = Math.max(0, bottom - lines.length * lh - size * 2);
  const tspans = lines.map((l, i) =>
    `<text x="${w / 2}" y="${bottom - (lines.length - 1 - i) * lh}" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-weight="700" font-size="${size}" fill="#ffffff">${esc(l)}</text>`).join('');
  return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.7"/></linearGradient></defs>` +
    (lines.length ? `<rect x="0" y="${gradTop}" width="${w}" height="${h - gradTop}" fill="url(#g)"/>` : '') + tspans + `</svg>`;
}
