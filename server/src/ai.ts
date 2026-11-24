export type Copy = { hook: string; caption: string; hashtags: string[] };

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

export function fallbackCopy(title: string, desc: string): Copy {
  const words = [...new Set((title.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []))].slice(0, 3).map(w => '#' + w);
  return { hook: str(title, 60) || 'Check this out', caption: str(desc || title, 200) || 'Take a look at what is new.', hashtags: [...words, '#new'] };
}

// Never trust model output: coerce every field, cap lengths, and fall back per field.
export function normalizeCopy(raw: unknown, fb: Copy): Copy {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const tags = Array.isArray(r.hashtags)
    ? r.hashtags.map(t => str(t, 30).replace(/\s+/g, '')).filter(t => t.replace('#', '')).map(t => (t.startsWith('#') ? t : '#' + t)).slice(0, 8) : [];
  return { hook: str(r.hook, 80) || fb.hook, caption: str(r.caption, 300) || fb.caption, hashtags: tags.length ? tags : fb.hashtags };
}

// Real LLM call when ANTHROPIC_API_KEY is set. On any failure we fall back to template copy,
// so a job never fails just because the AI provider is down.
export async function writeCopy(p: { title: string; desc: string; platform: string }): Promise<Copy> {
  const fb = fallbackCopy(p.title, p.desc);
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return fb;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: AbortSignal.timeout(15_000),
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: process.env.CAPTION_MODEL || 'claude-sonnet-5-5', max_tokens: 400,
        messages: [{ role: 'user', content: `Write social media copy for ${p.platform}.\nProduct: ${p.title || 'unknown'}\nDetails: ${p.desc || 'none'}\nThe hook is short text overlaid on the image. Reply with JSON only: {"hook":"max 8 words","caption":"max 200 characters","hashtags":["#a","#b","#c"]}` }],
      }),
    });
    if (!r.ok) return fb;
    const j: any = await r.json();
    const json = String(j?.content?.[0]?.text ?? '').match(/\{[\s\S]*\}/);
    return json ? normalizeCopy(JSON.parse(json[0]), fb) : fb;
  } catch { return fb; }
}
