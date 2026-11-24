import dns from 'node:dns/promises';
import net from 'node:net';
import { UserError } from './errors.ts';

function v4Private(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19));
}

export function isPrivate(ip: string): boolean {
  if (net.isIPv4(ip)) return v4Private(ip);
  const v6 = ip.toLowerCase();
  const dotted = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) return v4Private(dotted[1]);
  const hex = v6.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) { const n = (parseInt(hex[1], 16) << 16) | parseInt(hex[2], 16); return v4Private([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.')); }
  return v6 === '::' || v6 === '::1' || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6) || v6.startsWith('64:ff9b:');
}

export type FetchResult = { buf: Buffer; type: string; finalUrl: string };
export type FetchDeps = { lookup?: (host: string) => Promise<{ address: string }[]>; fetchImpl?: typeof fetch };

// SSRF-safe fetch: http(s) only, private/loopback/link-local blocked (re-checked on every redirect),
// timeout, redirect limit and size cap. Known limit: DNS may change between the check and the connect
// (rebinding); the production fix is to pin the resolved IP in a custom dispatcher.
export async function safeFetch(startUrl: string, maxBytes: number, deps: FetchDeps = {}): Promise<FetchResult> {
  const lookup = deps.lookup ?? ((h: string) => dns.lookup(h, { all: true }));
  const doFetch = deps.fetchImpl ?? fetch;
  let url = startUrl;
  for (let hop = 0; hop <= 3; hop++) {
    let u: URL;
    try { u = new URL(url); } catch { throw new UserError('That does not look like a valid link.'); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new UserError('Only http and https links are supported.');
    const host = u.hostname.replace(/^\[|\]$/g, '');
    let addrs: { address: string }[];
    if (net.isIP(host)) addrs = [{ address: host }];
    else {
      try { addrs = await lookup(host); } catch { throw new UserError('Could not find that website. Check the link.'); }
    }
    if (!addrs.length || addrs.some(a => isPrivate(a.address))) throw new UserError('That link points to a private or internal address, which is not allowed.');

    let res: Response;
    try {
      res = await doFetch(u, { redirect: 'manual', signal: AbortSignal.timeout(10_000), headers: { 'user-agent': 'Mozilla/5.0 (compatible; SocialGen/1.0)', accept: 'text/html,image/*;q=0.9,*/*;q=0.5' } });
    } catch (e: any) {
      throw new UserError(e?.name === 'TimeoutError' ? 'That website took too long to respond.' : 'Could not reach that website.');
    }
    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc) { url = new URL(loc, u).toString(); continue; }
    if (res.status === 401 || res.status === 403) throw new UserError('The website refused the request (HTTP ' + res.status + '). The link may have expired or blocks automated access. Try uploading the image instead.');
    if (res.status === 404 || res.status === 410) throw new UserError('That page or image no longer exists (HTTP ' + res.status + ').');
    if (!res.ok) throw new UserError('The website returned an error (HTTP ' + res.status + ').');
    if (Number(res.headers.get('content-length')) > maxBytes) throw new UserError('That file is too large.');

    const chunks: Buffer[] = []; let n = 0;
    try {
      for await (const c of res.body as any) { n += c.length; if (n > maxBytes) throw new UserError('That file is too large.'); chunks.push(Buffer.from(c)); }
    } catch (e: any) {
      if (e instanceof UserError) throw e;
      throw new UserError(e?.name === 'TimeoutError' ? 'That website took too long to respond.' : 'The download was interrupted.');
    }
    return { buf: Buffer.concat(chunks), type: res.headers.get('content-type') || '', finalUrl: u.toString() };
  }
  throw new UserError('That link redirects too many times.');
}
