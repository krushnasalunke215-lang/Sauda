/** Media types the app accepts, how they are named on disk and how they are served back. */

export const AUDIO_MIMES = ['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/mp3', 'audio/aac', 'audio/flac'] as const;
export type AudioMime = (typeof AUDIO_MIMES)[number];

export const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type ImageMime = (typeof IMAGE_MIMES)[number];

/** Audio uploads up to 4 MB (30 s of Opus is about 120 kB; a WhatsApp note of a minute about 500 kB). */
export const MAX_AUDIO_BYTES = 4 * 1024 * 1024;
/** Images up to 6 MB (the client downscales to 1600 px first). */
export const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

const AUDIO_ALIASES: Record<string, AudioMime> = {
  'audio/x-m4a': 'audio/mp4',
  'audio/m4a': 'audio/mp4',
  // WhatsApp voice notes are audio-only MP4.
  'video/mp4': 'audio/mp4',
  'audio/mpeg': 'audio/mp3',
  'audio/x-wav': 'audio/wav',
  'audio/wave': 'audio/wav',
};

const essence = (contentType: string | undefined | null): string => (contentType ?? '').split(';')[0]!.trim().toLowerCase();

/** The canonical audio MIME type for a Content-Type header (codec parameters stripped), or null when not accepted. */
export function normalizeAudioMime(contentType: string | undefined | null): AudioMime | null {
  const e = essence(contentType);
  const m = AUDIO_ALIASES[e] ?? e;
  return (AUDIO_MIMES as readonly string[]).includes(m) ? (m as AudioMime) : null;
}

export function normalizeImageMime(contentType: string | undefined | null): ImageMime | null {
  const e = essence(contentType);
  const m = e === 'image/jpg' ? 'image/jpeg' : e;
  return (IMAGE_MIMES as readonly string[]).includes(m) ? (m as ImageMime) : null;
}

const EXT_BY_MIME: Record<AudioMime | ImageMime, string> = {
  'audio/webm': 'webm',
  'audio/mp4': 'm4a',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/mp3': 'mp3',
  'audio/aac': 'aac',
  'audio/flac': 'flac',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export const extFor = (mime: AudioMime | ImageMime): string => EXT_BY_MIME[mime];

/** The MIME type Gemini gets for a file name (smoke scripts and samples). */
export function audioMimeFromFile(file: string): AudioMime | null {
  const ext = file.toLowerCase().split('.').pop() ?? '';
  const found = (Object.entries(EXT_BY_MIME) as [AudioMime | ImageMime, string][]).find(([m, e]) => e === ext && m.startsWith('audio/'));
  if (found) return found[0] as AudioMime;
  return ext === 'mp4' ? 'audio/mp4' : null;
}

/** Stored media file names: no directories, no dots except before the extension. */
export const MEDIA_FILE_RE = /^[A-Za-z0-9_-]+\.[a-z0-9]+$/;

const SERVE_TYPES: Record<string, string> = {
  webm: 'audio/webm',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  aac: 'audio/aac',
  flac: 'audio/flac',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

/** A safe Content-Type for serving a stored file; unknown extensions are served as opaque bytes. */
export function serveType(file: string): string {
  return SERVE_TYPES[file.split('.').pop() ?? ''] ?? 'application/octet-stream';
}
