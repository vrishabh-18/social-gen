export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

// Never throws: network failures and non-JSON error pages become a readable message.
export async function api<T>(url: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const r = await fetch(url, init);
    let body: any = null;
    try { body = await r.json(); } catch { /* not JSON */ }
    if (r.ok) return { ok: true, data: body as T };
    const fallback = r.status === 429 ? 'Too many requests. Wait a minute and try again.' : `Request failed (${r.status}).`;
    return { ok: false, status: r.status, error: body?.error || fallback };
  } catch {
    return { ok: false, status: 0, error: 'Cannot reach the server. Check your connection and try again.' };
  }
}
