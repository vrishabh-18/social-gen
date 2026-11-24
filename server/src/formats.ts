// Single source of truth for platform format rules. The UI reads these via GET /api/formats.
export type Platform = 'instagram' | 'tiktok' | 'youtube';
export type Format = {
  id: string; platform: Platform; label: string;
  width: number; height: number; kind: 'image' | 'video'; seconds?: number;
};
export const FORMATS: Format[] = [
  { id: 'ig-post',  platform: 'instagram', label: 'Post (1:1)',   width: 1080, height: 1080, kind: 'image' },
  { id: 'ig-reel',  platform: 'instagram', label: 'Reel (9:16)',  width: 1080, height: 1920, kind: 'video', seconds: 8 },
  { id: 'tt-video', platform: 'tiktok',    label: 'Video (9:16)', width: 1080, height: 1920, kind: 'video', seconds: 8 },
  { id: 'tt-photo', platform: 'tiktok',    label: 'Photo (9:16)', width: 1080, height: 1920, kind: 'image' },
  { id: 'yt-video', platform: 'youtube',   label: 'Video (16:9)', width: 1920, height: 1080, kind: 'video', seconds: 8 },
  { id: 'yt-short', platform: 'youtube',   label: 'Short (9:16)', width: 1080, height: 1920, kind: 'video', seconds: 8 },
  { id: 'yt-thumb', platform: 'youtube',   label: 'Thumbnail (16:9)', width: 1280, height: 720, kind: 'image' },
];
export const PLATFORM_NAME: Record<Platform, string> = { instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube' };
export const getFormat = (id: string) => FORMATS.find(f => f.id === id);
