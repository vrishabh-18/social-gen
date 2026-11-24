import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './api';
import {
  DEFAULT_FORMAT, PLATFORMS, PLATFORM_NAME, formatBytes, isActive, outputLabel, ratioVars, timeAgo, validateFile, validateUrl,
  type Format, type Job, type Platform,
} from './lib';

const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,image/avif';

function CopyRow({ label, text }: { label: string; text: string }) {
  const [done, setDone] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* clipboard blocked */ }
  }
  return (
    <div className="copy-row">
      <div><h3>{label}</h3><p>{text}</p></div>
      <button type="button" className="ghost" onClick={copy}>{done ? 'Copied' : 'Copy'}</button>
    </div>
  );
}

export default function App() {
  const [formats, setFormats] = useState<Format[]>([]);
  const [loadError, setLoadError] = useState('');
  const [mode, setMode] = useState<'url' | 'file'>('url');
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [platform, setPlatform] = useState<Platform>('instagram');
  const [formatId, setFormatId] = useState('');
  const [job, setJob] = useState<Job | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [recent, setRecent] = useState<Job[]>([]);

  const loadFormats = useCallback(async () => {
    const r = await api<Format[]>('/api/formats');
    if (r.ok && Array.isArray(r.data)) { setFormats(r.data); setLoadError(''); } else setLoadError(r.ok ? 'Unexpected response from the server.' : r.error);
  }, []);
  const loadRecent = useCallback(async () => {
    const r = await api<Job[]>('/api/jobs');
    if (r.ok && Array.isArray(r.data)) setRecent(r.data.filter(j => j && j.format));
  }, []);
  useEffect(() => { loadFormats(); loadRecent(); }, [loadFormats, loadRecent]);

  const options = useMemo(() => formats.filter(f => f.platform === platform), [formats, platform]);
  const selected = options.find(o => o.id === formatId);
  useEffect(() => {
    if (options.length && !options.some(o => o.id === formatId && o.available !== false))
      setFormatId(options.find(o => o.available !== false)?.id ?? '');
  }, [options, formatId]);

  const busy = submitting || isActive(job);

  // Poll the job until it finishes. Stops on unmount, on a new job, and after repeated failures.
  useEffect(() => {
    if (!job || !isActive(job)) return;
    let cancelled = false, fails = 0;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const r = await api<Job>(`/api/jobs/${job.id}`);
      if (cancelled) return;
      if (r.ok && r.data?.format) { fails = 0; setJob(r.data); }
      else if (++fails >= 5) { setJob({ ...job, status: 'failed', step: 'Failed', error: !r.ok && r.status === 404 ? 'This job no longer exists on the server.' : !r.ok ? r.error : 'Unexpected response from the server.' }); return; }
      timer = setTimeout(tick, 1000);
    };
    timer = setTimeout(tick, 700);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [job?.id, job?.status]);

  useEffect(() => { if (job && !isActive(job)) loadRecent(); }, [job?.id, job?.status, loadRecent]);

  function pickFile(f?: File | null) {
    if (!f) return;
    const err = validateFile(f);
    if (err) { setFile(null); setFormError(err); } else { setFile(f); setFormError(''); }
  }

  async function generate(e?: React.FormEvent) {
    e?.preventDefault();
    if (busy || !selected) return;
    setFormError('');
    const body = new FormData();
    body.append('formatId', selected.id);
    if (mode === 'url') {
      const err = validateUrl(url);
      if (err) { setFormError(err); return; }
      body.append('url', url.trim());
    } else {
      if (!file) { setFormError('Choose an image to upload.'); return; }
      const err = validateFile(file);
      if (err) { setFormError(err); return; }
      body.append('file', file);
    }
    setSubmitting(true); setJob(null);
    const r = await api<Job>('/api/jobs', { method: 'POST', body });
    setSubmitting(false);
    if (r.ok && r.data?.format) setJob(r.data); else setFormError(r.ok ? 'Unexpected response from the server.' : r.error);
  }

  const stageFormat = job?.format ?? selected ?? DEFAULT_FORMAT;
  const state: 'working' | 'failed' | 'done' | 'empty' =
    busy ? 'working' : job?.status === 'failed' ? 'failed' : job?.status === 'done' ? 'done' : 'empty';
  const progress = job ? job.progress : 5;
  const tall = stageFormat.height > stageFormat.width;

  return (
    <div className="app" data-platform={platform}>
      <header className="top">
        <h1>Social content generator</h1>
        <p>Turn a product link or photo into a post, Reel, Short or TikTok, sized exactly for the platform.</p>
      </header>

      <div className="layout">
        <form className="panel" onSubmit={generate} noValidate>
          <fieldset>
            <legend>Source</legend>
            <div className="seg" role="group" aria-label="Source type">
              <button type="button" aria-pressed={mode === 'url'} onClick={() => { setMode('url'); setFormError(''); }}>Product link</button>
              <button type="button" aria-pressed={mode === 'file'} onClick={() => { setMode('file'); setFormError(''); }}>Upload image</button>
            </div>
            <div className="source">
              {mode === 'url' ? (
                <input className="input" type="url" inputMode="url" placeholder="https://example.com/product or an image link" aria-label="Product or image link"
                  value={url} onChange={e => { setUrl(e.target.value); setFormError(''); }} />
              ) : (
                <label className={`drop${dragging ? ' is-drag' : ''}`}
                  onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
                  onDrop={e => { e.preventDefault(); setDragging(false); pickFile(e.dataTransfer.files?.[0]); }}>
                  <input className="sr" type="file" accept={ACCEPT} onChange={e => { pickFile(e.target.files?.[0]); e.target.value = ''; }} />
                  {file ? <><strong>{file.name}</strong><span>{formatBytes(file.size)}. Click to replace.</span></>
                        : <><strong>Drop an image here or browse</strong><span>JPG, PNG, WebP, GIF or AVIF, up to 8 MB</span></>}
                </label>
              )}
            </div>
          </fieldset>

          <fieldset>
            <legend>Platform</legend>
            <div className="platforms" role="group" aria-label="Platform">
              {PLATFORMS.map(p => (
                <button key={p.id} type="button" className="chip" aria-pressed={platform === p.id} onClick={() => setPlatform(p.id)}>{p.name}</button>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend>Format</legend>
            {loadError ? (
              <p className="error" role="alert">{loadError} <button type="button" className="link" onClick={loadFormats}>Retry</button></p>
            ) : (
              <div className="tiles">
                {options.map(f => (
                  <label key={f.id} className={`tile${f.id === formatId ? ' is-selected' : ''}${f.available === false ? ' is-disabled' : ''}`}>
                    <input className="sr" type="radio" name="format" value={f.id} checked={f.id === formatId}
                      disabled={f.available === false} onChange={() => setFormatId(f.id)} />
                    <span className="glyph" style={{ aspectRatio: `${f.width} / ${f.height}` }} aria-hidden="true" />
                    <span className="tile-text">
                      <strong>{f.label}</strong>
                      <span>{f.width} × {f.height} · {f.kind === 'video' ? `${f.seconds ?? 8} s video` : 'image'}{f.available === false ? ' · needs ffmpeg on the server' : ''}</span>
                    </span>
                  </label>
                ))}
              </div>
            )}
          </fieldset>

          {formError && <p className="error" role="alert">{formError}</p>}
          <button className="btn" disabled={busy || !selected}>
            {busy ? 'Generating…' : selected?.kind === 'video' ? 'Generate video' : 'Generate image'}
          </button>
        </form>

        <section aria-label="Preview">
          <div className="stage" aria-live="polite">
            <div className={`frame ${state}`} style={ratioVars(stageFormat)}>
              {state === 'done' && job?.outputUrl && (job.format.kind === 'video'
                ? <video key={job.id} src={job.outputUrl} controls autoPlay muted loop playsInline />
                : <img key={job.id} src={job.outputUrl} alt={`Generated ${job.format.label}`} />)}
              {state === 'working' && (
                <div className="state">
                  <p className="state-title">{job ? job.step : 'Uploading'}…</p>
                  <div className="bar" role="progressbar" aria-label="Generation progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
                    <span style={{ width: `${progress}%` }} />
                  </div>
                  <p className="hint">{stageFormat.kind === 'video' ? 'Videos usually take 10 to 30 seconds.' : 'This usually takes a few seconds.'}</p>
                </div>
              )}
              {state === 'failed' && (
                <div className="state">
                  <p className="state-title">Could not generate this</p>
                  <p className="fail">{job?.error}</p>
                  <button type="button" className="ghost" onClick={() => generate()}>Try again</button>
                </div>
              )}
              {state === 'empty' && (
                <div className="state">
                  <p className="state-title">Your {stageFormat.kind === 'video' ? 'video' : 'image'} appears here</p>
                  <p className="hint">{stageFormat.width} × {stageFormat.height}{tall ? '. Text stays clear of the area apps cover on tall formats.' : ''}</p>
                </div>
              )}
            </div>
            <div className="meta">
              <span>{PLATFORM_NAME[stageFormat.platform]} · {stageFormat.label} · {stageFormat.width} × {stageFormat.height}</span>
              {state === 'done' && job?.downloadUrl && <a className="btn" href={job.downloadUrl} download>Download {outputLabel(job.format)}</a>}
            </div>
          </div>

          {state === 'done' && job?.copy && (
            <div className="panel copy">
              <h2>Suggested copy</h2>
              <CopyRow label="Hook" text={job.copy.hook} />
              <CopyRow label="Caption" text={job.copy.caption} />
              <CopyRow label="Hashtags" text={job.copy.hashtags.join(' ')} />
            </div>
          )}
        </section>
      </div>

      {recent.length > 0 && (
        <section className="recent" aria-label="Recent generations">
          <h2>Recent</h2>
          <ul>
            {recent.map(j => (
              <li key={j.id}>
                <button type="button" className="r-item" aria-current={job?.id === j.id} disabled={busy} onClick={() => setJob(j)}>
                  <strong>{PLATFORM_NAME[j.format.platform]} · {j.format.label}</strong>
                  <span className={j.status === 'failed' ? 'bad' : ''}>{j.status === 'done' ? 'Ready' : j.status === 'failed' ? 'Failed' : j.step} · {timeAgo(j.createdAt)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
