// Tiny, dependency-free extraction of the metadata we need from a product page.
const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
  if (e[0] === '#') {
    const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
  }
  return ENT[e.toLowerCase()] ?? m;
});
const attrs = (tag: string) => {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([a-zA-Z_:][-\w:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g))
    out[m[1].toLowerCase()] = decode(m[2] ?? m[3] ?? m[4] ?? '');
  return out;
};
const clean = (s?: string) => (s ?? '').replace(/\s+/g, ' ').trim();

export function extractMeta(html: string): { title: string; description: string; image: string } {
  const meta: Record<string, string> = {};
  for (const m of html.matchAll(/<meta\b(?:"[^"]*"|'[^']*'|[^'">])*>/gi)) {
    const a = attrs(m[0]);
    const key = (a.property || a.name || '').toLowerCase();
    if (key && a.content !== undefined && !(key in meta)) meta[key] = a.content;
  }
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return {
    title: clean(meta['og:title'] || meta['twitter:title'] || (t ? decode(t[1]) : '')),
    description: clean(meta['og:description'] || meta['twitter:description'] || meta['description']),
    image: clean(meta['og:image'] || meta['og:image:url'] || meta['og:image:secure_url'] || meta['twitter:image']),
  };
}
