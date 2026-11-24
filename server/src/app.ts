import express from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { FORMATS, PLATFORM_NAME, getFormat } from './formats.ts';
import { safeFetch } from './safeFetch.ts';
import { UserError } from './errors.ts';
import { extractMeta } from './html.ts';
import { writeCopy } from './ai.ts';
import { composeImage, validateImage } from './render.ts';
import { toVideo, ffmpegAvailable } from './video.ts';
import { sanitizeJobs, type Job } from './jobs.ts';

export type AppOptions = { dataDir: string; fetchUrl?: typeof safeFetch; videoEnabled?: boolean; rateLimitPerMin?: number };

const MAX_UPLOAD = 8 * 1024 * 1024;
const MAX_FETCH = 8 * 1024 * 1024;
const MAX_JOBS = 50;
const MAX_ACTIVE = 10;
const active = (j: Job) => j.status === 'queued' || j.status === 'processing';

function parseHttpUrl(s: string): URL | null {
  try { const u = new URL(s); return u.protocol === 'http:' || u.protocol === 'https:' ? u : null; } catch { return null; }
}

export async function createApp(opts: AppOptions) {
  const fetchUrl = opts.fetchUrl ?? safeFetch;
  const videoEnabled = opts.videoEnabled ?? (await ffmpegAvailable());
  const OUT = path.join(opts.dataDir, 'outputs');
  fs.mkdirSync(OUT, { recursive: true });

  // Persistence: a JSON file survives restarts (swap for Postgres to run more than one instance).
  const DB = path.join(opts.dataDir, 'jobs.json');
  const jobs = new Map<string, Job>();
  try { for (const j of sanitizeJobs(JSON.parse(fs.readFileSync(DB, 'utf8')))) jobs.set(j.id, j); } catch { /* first run or unreadable file */ }
  for (const j of jobs.values()) if (active(j)) { j.status = 'failed'; j.error = 'The server restarted while this was running. Please try again.'; }
  const save = () => {
    try { fs.writeFileSync(DB + '.tmp', JSON.stringify([...jobs.values()])); fs.renameSync(DB + '.tmp', DB); }
    catch (e) { console.error('Could not save jobs', e); }
  };
  save();
  const update = (j: Job, patch: Partial<Job>) => { Object.assign(j, patch); save(); };
  const prune = () => {
    const all = [...jobs.values()].sort((a, b) => a.createdAt - b.createdAt);
    while (all.length > MAX_JOBS) {
      const old = all.shift()!;
      if (active(old)) continue;
      if (old.file) fs.rmSync(path.join(OUT, old.file), { force: true });
      jobs.delete(old.id);
    }
  };
  const pub = (j: Job) => ({
    id: j.id, status: j.status, step: j.step, progress: j.progress, error: j.error, format: j.format, source: j.source,
    copy: j.copy, createdAt: j.createdAt,
    outputUrl: j.status === 'done' && j.file ? `/outputs/${j.file}` : undefined,
    downloadUrl: j.status === 'done' && j.file ? `/api/jobs/${j.id}/download` : undefined,
  });

  // Queue: in-process, one job at a time (swap for BullMQ + Redis to scale out).
  let chain: Promise<void> = Promise.resolve();
  const enqueue = (fn: () => Promise<void>) => { chain = chain.then(fn).catch(() => {}); };

  async function runJob(job: Job, input: { url?: string; file?: Buffer; name?: string }) {
    const png = path.join(OUT, `${job.id}.png`), mp4 = path.join(OUT, `${job.id}.mp4`);
    try {
      const f = job.format;
      update(job, { status: 'processing', step: 'Reading your input', progress: 15 });
      let img: Buffer, title = input.name ?? '', desc = '';
      if (input.file) img = input.file;
      else {
        const page = await fetchUrl(input.url!, MAX_FETCH);
        if (/^(text\/html|application\/xhtml)/i.test(page.type)) {
          const meta = extractMeta(page.buf.toString('utf8'));
          if (!meta.image) throw new UserError('No product image found on that page. Paste a direct image link or upload the image instead.');
          let imageUrl: string;
          try { imageUrl = new URL(meta.image, page.finalUrl).toString(); } catch { throw new UserError('The page lists an invalid image address.'); }
          title = meta.title; desc = meta.description;
          img = (await fetchUrl(imageUrl, MAX_FETCH)).buf;
        } else img = page.buf; // a direct image link; decoding below confirms it really is an image
      }
      await validateImage(img);

      update(job, { step: 'Writing copy', progress: 40 });
      const copy = await writeCopy({ title, desc, platform: PLATFORM_NAME[f.platform] });
      update(job, { copy, step: `Composing ${f.label}`, progress: 60 });
      await composeImage(img, f, copy.hook, png);

      let file = `${job.id}.png`;
      if (f.kind === 'video') {
        update(job, { step: 'Rendering video', progress: 80 });
        file = `${job.id}.mp4`;
        await toVideo(png, f, mp4);
        fs.rmSync(png, { force: true });
      }
      update(job, { status: 'done', step: 'Done', progress: 100, file });
    } catch (e: any) {
      console.error(JSON.stringify({ job: job.id, error: e?.message, stack: e instanceof UserError ? undefined : e?.stack }));
      fs.rmSync(png, { force: true }); fs.rmSync(mp4, { force: true });
      update(job, { status: 'failed', step: 'Failed', error: e instanceof UserError ? e.message : 'Something went wrong while generating. Please try again.' });
    }
  }

  const app = express();
  app.set('trust proxy', 1);
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD, files: 1 } });
  // Only creating jobs is limited. Status polling (GET) must stay unlimited or long renders would hit 429.
  const limiter = rateLimit({ windowMs: 60_000, limit: opts.rateLimitPerMin ?? 20, message: { error: 'Too many requests. Wait a minute and try again.' } });

  app.get('/health', (_q, r) => { r.json({ ok: true, video: videoEnabled }); });
  app.get('/api/formats', (_q, r) => { r.json(FORMATS.map(f => ({ ...f, available: f.kind === 'image' || videoEnabled }))); });
  app.get('/api/jobs', (_q, r) => { r.json([...jobs.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, 10).map(pub)); });
  app.get('/api/jobs/:id', (q, r) => { const j = jobs.get(q.params.id); j ? r.json(pub(j)) : r.status(404).json({ error: 'Job not found' }); });
  app.get('/api/jobs/:id/download', (q, r) => {
    const j = jobs.get(q.params.id);
    if (!j || j.status !== 'done' || !j.file) return void r.status(404).json({ error: 'File not found' });
    r.download(path.join(OUT, j.file), `${j.format.id}-${j.format.width}x${j.format.height}${path.extname(j.file)}`);
  });

  app.post('/api/jobs', limiter, upload.single('file'), async (q, r) => {
    try {
      const format = getFormat(String(q.body?.formatId ?? ''));
      if (!format) return void r.status(400).json({ error: 'Choose a platform and format.' });
      if (format.kind === 'video' && !videoEnabled) return void r.status(400).json({ error: 'Video output needs ffmpeg, which is not installed on the server. Choose an image format.' });
      const url = typeof q.body?.url === 'string' ? q.body.url.trim() : '';
      const file = q.file;
      if (!file && !url) return void r.status(400).json({ error: 'Paste a product link or upload an image.' });
      if (!file && !parseHttpUrl(url)) return void r.status(400).json({ error: 'Enter a valid link starting with http:// or https://' });
      if (file) await validateImage(file.buffer);
      if ([...jobs.values()].filter(active).length >= MAX_ACTIVE) return void r.status(503).json({ error: 'The server is busy. Try again in a minute.' });

      const job: Job = { id: randomUUID(), status: 'queued', step: 'Queued', progress: 5, format, source: (file ? file.originalname : url).slice(0, 200), createdAt: Date.now() };
      jobs.set(job.id, job); prune(); save();
      enqueue(() => runJob(job, file ? { file: file.buffer, name: file.originalname.replace(/\.[^.]+$/, '') } : { url }));
      r.status(202).json(pub(job));
    } catch (e) {
      if (e instanceof UserError) return void r.status(400).json({ error: e.message });
      console.error(e);
      r.status(500).json({ error: 'Server error. Please try again.' });
    }
  });

  app.use('/outputs', express.static(OUT, { index: false }));
  const dist = path.resolve(process.env.CLIENT_DIST || '../client/dist');
  if (fs.existsSync(dist)) app.use(express.static(dist));
  app.use((e: any, _q: express.Request, r: express.Response, _n: express.NextFunction) => {
    if (e instanceof multer.MulterError) return void r.status(e.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: e.code === 'LIMIT_FILE_SIZE' ? 'Image must be 8 MB or smaller.' : 'Upload failed. Send a single image file.' });
    console.error(e);
    r.status(500).json({ error: 'Server error. Please try again.' });
  });
  return app;
}
