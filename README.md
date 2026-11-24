# Social content generator

Turn a product link or an image into a platform-ready image or short video for Instagram, TikTok and YouTube.

## Run
**Docker (recommended, includes ffmpeg):**
```
docker build -t social-gen .
docker run -p 3000:3000 -v sgdata:/data --env-file .env social-gen
```
Open http://localhost:3000.

**Local (Node 20+):**
```
cd server && npm install && npm run dev     # API on :3000
cd client && npm install && npm run dev     # UI on :5173
```
Video formats need **ffmpeg** on the machine. Windows: `winget install Gyan.FFmpeg`, then open a new terminal (or set `FFMPEG_PATH` to ffmpeg.exe). Without it the app still works for images and the video formats are shown as unavailable.

## Formats
| Platform | Formats |
|---|---|
| Instagram | Post 1080x1080 (image), Reel 1080x1920 (video) |
| TikTok | Photo 1080x1920 (image), Video 1080x1920 (video) |
| YouTube | Thumbnail 1280x720 (image), Video 1920x1080 and Short 1080x1920 (video) |

Rules live in `server/src/formats.ts` and drive both the UI and the renderer. Videos are 8 s H.264 MP4 (yuv420p, 25 fps).

## Inputs
- **Product link:** a product page (title, description and `og:image` are read) or a direct image link.
- **Upload:** JPG, PNG, WebP, GIF or AVIF up to 8 MB. Phone photos are auto-rotated from EXIF.

## Architecture
React (Vite) UI -> Express API -> in-process queue -> pipeline: fetch input -> LLM copy -> sharp compose -> ffmpeg render.
`POST /api/jobs` returns 202 and a job id; the UI polls `GET /api/jobs/:id`. Each job carries a snapshot of its own format, so the preview and download always match what was generated, whatever the form currently shows. Download goes through `GET /api/jobs/:id/download` (correct content type and filename).

## Real vs simulated
| Part | Status |
|---|---|
| Link and image input, resize/blur-fill to exact platform size, hook text | Real |
| Video (8 s zoom clip, H.264 MP4) | Real, but programmatic. It is not generative video. |
| Hook, caption, hashtags | Real LLM call when `ANTHROPIC_API_KEY` is set, otherwise template copy |
| Generative image/video models, video input | Not included |

## Security and failure handling
- URL fetching: http(s) only, private/loopback/link-local/mapped-IPv6 addresses blocked on every redirect, 10 s timeout, 8 MB cap, max 3 redirects.
- Uploads: 8 MB cap, validated by decoding (SVG and PDF rejected), pixel limit.
- LLM output is coerced and length-capped; any failure falls back to template copy.
- Errors shown to users are readable; internal errors are logged and replaced with a generic message.
- Rate limit on job creation only (status polling is not limited). Queue depth cap. ffmpeg timeout.
- Jobs persist to disk; jobs interrupted by a restart are marked failed; a corrupt jobs file does not block startup; only the last 50 jobs and their files are kept.

## Tests
```
cd server && npm run test:unit   # no browser or network: formats, SSRF guard, HTML parsing, AI copy, layout, real ffmpeg renders
cd server && npm test            # adds API end-to-end tests (real Express + sharp + ffmpeg, fake URL fetcher)
cd client && npm test            # validation helpers
```

## Trade-offs and known issues
- Queue and storage are in-process and file-based so setup is one container. Limit: one instance, one job at a time.
- DNS rebinding between the SSRF check and the connection is not fully closed (fix: pin the resolved IP).
- Pages that render their image with JavaScript have no `og:image`; use a direct image link or upload.
- Some CDN links (for example social-media image URLs) expire or refuse automated access; the app says so and suggests uploading.
- Hook text is drawn with DejaVu Sans, so scripts it lacks (Devanagari, CJK) will not render in the overlay.

## Next steps
1. BullMQ + Redis and Postgres so workers scale separately from the API.
2. Object storage (S3/R2) with signed URLs and retention.
3. Video input, plus a real generative provider behind a `Generator` interface.
4. Auth, quotas and per-job cost tracking.
5. Editable text, brand colors and fonts on the result.
