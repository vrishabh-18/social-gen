import type { CSSProperties } from 'react';

export type Platform = 'instagram' | 'tiktok' | 'youtube';
export type Format = { id: string; platform: Platform; label: string; width: number; height: number; kind: 'image' | 'video'; seconds?: number; available?: boolean };
export type Copy = { hook: string; caption: string; hashtags: string[] };
export type Job = {
  id: string; status: 'queued' | 'processing' | 'done' | 'failed'; step: string; progress: number; error?: string;
  format: Format; source: string; copy?: Copy; outputUrl?: string; downloadUrl?: string; createdAt: number;
};

export const PLATFORMS: { id: Platform; name: string }[] = [
  { id: 'instagram', name: 'Instagram' }, { id: 'tiktok', name: 'TikTok' }, { id: 'youtube', name: 'YouTube' },
];
export const PLATFORM_NAME: Record<Platform, string> = { instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube' };
export const DEFAULT_FORMAT: Format = { id: 'ig-post', platform: 'instagram', label: 'Post (1:1)', width: 1080, height: 1080, kind: 'image' };
export const MAX_UPLOAD = 8 * 1024 * 1024;

export const isActive = (j?: Job | null) => !!j && (j.status === 'queued' || j.status === 'processing');

export function validateUrl(v: string): string | null {
  const s = v.trim();
  if (!s) return 'Paste a product link or an image link.';
  try { if (!/^https?:$/.test(new URL(s).protocol)) return 'Links must start with http:// or https://'; }
  catch { return 'That does not look like a valid link.'; }
  return null;
}

export function validateFile(f: { type: string; size: number }): string | null {
  if (!/^image\/(jpeg|png|webp|gif|avif)$/.test(f.type)) return 'Use a JPG, PNG, WebP, GIF or AVIF image.';
  if (f.size > MAX_UPLOAD) return 'Image must be 8 MB or smaller.';
  return null;
}

export function formatBytes(n: number): string {
  return n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function timeAgo(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

// Frame size is driven by these custom properties so it always matches the real output ratio.
export const ratioVars = (f: { width: number; height: number }) =>
  ({ '--w': f.width, '--h': f.height, '--ar': f.width / f.height }) as CSSProperties;

export const outputLabel = (f: Format) => (f.kind === 'video' ? 'MP4 video' : 'PNG image');
