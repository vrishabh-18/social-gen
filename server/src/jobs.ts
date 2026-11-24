import { getFormat, type Format } from './formats.ts';
import type { Copy } from './ai.ts';

export type Status = 'queued' | 'processing' | 'done' | 'failed';
export type Job = {
  id: string; status: Status; step: string; progress: number; error?: string;
  format: Format; source: string; copy?: Copy; file?: string; createdAt: number;
};
const STATUSES: Status[] = ['queued', 'processing', 'done', 'failed'];

// Validates jobs read from disk. Entries from older versions (or hand-edited/corrupt ones) are repaired
// when possible and dropped otherwise, so stale data can never crash the API or the UI.
export function sanitizeJobs(raw: unknown): Job[] {
  if (!Array.isArray(raw)) return [];
  const out: Job[] = [];
  for (const j of raw as any[]) {
    if (!j || typeof j.id !== 'string' || !STATUSES.includes(j.status)) continue;
    const format = getFormat(j.format?.id ?? j.formatId);       // legacy jobs stored only formatId
    if (!format) continue;
    if (j.status === 'done' && typeof j.file !== 'string') continue; // legacy jobs stored outputUrl, not file
    out.push({
      id: j.id, status: j.status, format, step: typeof j.step === 'string' ? j.step : '',
      progress: typeof j.progress === 'number' ? j.progress : j.status === 'done' ? 100 : 0,
      error: typeof j.error === 'string' ? j.error : undefined, source: typeof j.source === 'string' ? j.source : '',
      copy: j.copy && typeof j.copy.hook === 'string' && typeof j.copy.caption === 'string' && Array.isArray(j.copy.hashtags) ? j.copy : undefined,
      file: typeof j.file === 'string' ? j.file : undefined, createdAt: typeof j.createdAt === 'number' ? j.createdAt : Date.now(),
    });
  }
  return out;
}
