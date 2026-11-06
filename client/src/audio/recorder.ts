/** Microphone recording with MediaRecorder (WebM/Opus in Chromium and Firefox, MP4 in Safari). */

const PREFERRED = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'];
export const MAX_RECORD_MS = 30_000;
export const MIN_RECORD_MS = 500;

export type RecordErrorCode = 'unsupported' | 'mic_denied' | 'mic_error';

export class RecordError extends Error {
  constructor(readonly code: RecordErrorCode) {
    super(code);
  }
}

export interface Clip {
  blob: Blob;
  mimeType: string;
  ms: number;
}

/** The first type MediaRecorder accepts from the preferred list, or null to let the browser choose. */
export function pickMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return null;
  return PREFERRED.find((t) => MediaRecorder.isTypeSupported(t)) ?? null;
}

export const canRecord = (): boolean => typeof MediaRecorder !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);

/**
 * One recording. start() asks for the microphone; stop() returns the clip, or null for a clip under
 * 0.5 s. A recording stops by itself at 30 s and hands its clip to onAutoStop.
 */
export class Recorder {
  private rec: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private readonly chunks: Blob[] = [];
  private startedAt = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private starting: Promise<void> | null = null;
  private stopping: Promise<Clip | null> | null = null;

  constructor(private readonly onAutoStop: (clip: Clip | null) => void) {}

  start(): Promise<void> {
    if (!canRecord()) return Promise.reject(new RecordError('unsupported'));
    this.starting ??= (async () => {
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      } catch (e) {
        const name = e instanceof DOMException ? e.name : '';
        throw new RecordError(name === 'NotAllowedError' || name === 'SecurityError' ? 'mic_denied' : 'mic_error');
      }
      if (this.stopping) return; // stopped while the permission prompt was open
      const mimeType = pickMimeType();
      const rec = new MediaRecorder(this.stream, mimeType ? { mimeType, audioBitsPerSecond: 32_000 } : undefined);
      rec.ondataavailable = (e) => {
        if (e.data.size) this.chunks.push(e.data);
      };
      rec.start();
      this.rec = rec;
      this.startedAt = performance.now();
      this.timer = setTimeout(() => void this.stop().then(this.onAutoStop), MAX_RECORD_MS);
    })();
    return this.starting;
  }

  stop(): Promise<Clip | null> {
    this.stopping ??= (async () => {
      try {
        await this.starting;
      } catch {
        return null;
      }
      clearTimeout(this.timer);
      const rec = this.rec;
      const ms = rec ? performance.now() - this.startedAt : 0;
      if (rec && rec.state !== 'inactive') {
        await new Promise<void>((resolve) => {
          rec.onstop = () => resolve();
          rec.stop();
        });
      }
      this.stream?.getTracks().forEach((t) => t.stop());
      if (!rec || ms < MIN_RECORD_MS || !this.chunks.length) return null;
      const type = rec.mimeType || this.chunks[0]!.type || 'audio/webm';
      return { blob: new Blob(this.chunks, { type }), mimeType: type, ms };
    })();
    return this.stopping;
  }
}
