import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { Lang, Message, PhotoKind, SampleInfo } from '../../../shared/types.js';
import type { Clip } from '../audio/recorder.js';
import { t, tMaybe } from '../i18n.js';
import { PhotoButton } from './PhotoButton.js';
import { PushToTalk } from './PushToTalk.js';

const MAX_VOICE_BYTES = 4 * 1024 * 1024;

/** Content types for voice-note files the browser reports without one (e.g. WhatsApp .opus exports). */
const TYPE_BY_EXT: Record<string, string> = {
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  webm: 'audio/webm',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  aac: 'audio/aac',
  flac: 'audio/flac',
};

type Stage = 'idle' | 'recording' | 'uploading' | 'interpreting' | 'done' | 'failed';

export interface ComposerProps {
  lang: Lang;
  otherName: string;
  messages: Message[];
  /** Built-in sample clips for this role (the maker's Hindi clips). */
  samples: SampleInfo[];
  /** Which photo this party can send now, if any. */
  photoKind: PhotoKind | null;
  onSend: (text: string) => Promise<boolean>;
  /** Uploads a voice clip; resolves to the new message id, or null on an error (shown by the room). */
  onVoice: (blob: Blob, contentType: string) => Promise<string | null>;
  onSample: (id: string) => Promise<string | null>;
  onPhoto: (kind: PhotoKind, jpeg: Blob) => Promise<boolean>;
}

export function Composer({ lang, otherName, messages, samples, photoKind, onSend, onVoice, onSample, onPhoto }: ComposerProps) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [voiceId, setVoiceId] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const menu = useRef<HTMLDetailsElement>(null);

  const voiceMsg = voiceId ? messages.find((m) => m.id === voiceId) : undefined;
  const stage: Stage = recording
    ? 'recording'
    : uploading
      ? 'uploading'
      : voiceMsg
        ? voiceMsg.status === 'done'
          ? 'done'
          : voiceMsg.status === 'failed'
            ? 'failed'
            : 'interpreting'
        : 'idle';

  // "Done" shows briefly, then the stage line clears.
  useEffect(() => {
    if (stage !== 'done' && stage !== 'failed') return;
    const id = setTimeout(() => setVoiceId(null), stage === 'done' ? 3000 : 6000);
    return () => clearTimeout(id);
  }, [stage]);

  async function send() {
    const v = text.trim();
    if (!v || busy) return;
    setBusy(true);
    const ok = await onSend(v);
    setBusy(false);
    if (ok) setText('');
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  }

  async function uploadVoice(run: () => Promise<string | null>) {
    setHint(null);
    setUploading(true);
    setVoiceId(null);
    const id = await run();
    setUploading(false);
    if (id) setVoiceId(id);
  }

  function onClip(clip: Clip) {
    void uploadVoice(() => onVoice(clip.blob, clip.mimeType));
  }

  function onFile(file: File | undefined) {
    if (fileInput.current) fileInput.current.value = '';
    if (!file) return;
    if (file.size > MAX_VOICE_BYTES) return setHint(t(lang, 'voice.tooBig'));
    const type = file.type || TYPE_BY_EXT[file.name.split('.').pop()?.toLowerCase() ?? ''] || 'application/octet-stream';
    void uploadVoice(() => onVoice(file, type));
  }

  function pickSample(id: string) {
    if (menu.current) menu.current.open = false;
    void uploadVoice(() => onSample(id));
  }

  const voiceBusy = uploading || stage === 'interpreting';

  return (
    <div className="border-t border-stone-200 p-3">
      <div className="flex items-end gap-2">
        <textarea
          data-testid="composer-input"
          className="min-h-11 flex-1 resize-none rounded-xl border border-stone-300 px-3 py-2 text-base focus:border-emerald-600 focus:outline-none"
          rows={2}
          maxLength={1000}
          value={text}
          placeholder={t(lang, 'composer.placeholder', { name: otherName, lang: t(lang, `lang.${lang}`) })}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
        />
        <button
          type="button"
          data-testid="composer-send"
          disabled={busy || !text.trim()}
          onClick={() => void send()}
          className="rounded-xl bg-emerald-700 px-4 py-2 font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
        >
          {t(lang, 'composer.send')}
        </button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <PushToTalk
          lang={lang}
          disabled={voiceBusy}
          onClip={onClip}
          onRecording={(on) => {
            setRecording(on);
            if (on) setHint(null);
          }}
          onError={(code) => setHint(tMaybe(lang, `voice.error.${code}`, {}, t(lang, 'voice.error.mic_error')))}
        />
        <button
          type="button"
          data-testid="voice-file-button"
          disabled={voiceBusy || recording}
          onClick={() => fileInput.current?.click()}
          className="flex items-center gap-1 rounded-xl bg-stone-100 px-3 py-2 text-sm text-stone-800 ring-1 ring-stone-300 hover:bg-stone-200 disabled:opacity-50"
        >
          <span aria-hidden>📎</span>
          {t(lang, 'voice.note')}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="audio/*,video/mp4"
          data-testid="voice-file"
          className="hidden"
          onChange={(e) => onFile(e.target.files?.[0])}
        />
        {samples.length > 0 && (
          <details ref={menu} className="relative" data-testid="samples-menu">
            <summary className="cursor-pointer list-none rounded-xl bg-stone-100 px-3 py-2 text-sm text-stone-800 ring-1 ring-stone-300 hover:bg-stone-200">
              <span aria-hidden>🎧</span> {t(lang, 'voice.samples')}
            </summary>
            <div className="absolute bottom-full left-0 z-10 mb-1 w-72 rounded-xl border border-stone-200 bg-white p-1 shadow-lg">
              {samples.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  data-testid="sample-clip"
                  data-id={s.id}
                  disabled={voiceBusy || recording}
                  onClick={() => pickSample(s.id)}
                  className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-stone-100 disabled:opacity-50"
                >
                  {s.label[lang] ?? s.label.en}
                </button>
              ))}
            </div>
          </details>
        )}
        {photoKind && (
          <PhotoButton
            kind={photoKind}
            label={t(lang, photoKind === 'reference' ? 'photo.addReference' : 'photo.sendProgress')}
            busyLabel={t(lang, 'photo.uploading')}
            disabled={recording}
            onUpload={(jpeg) => onPhoto(photoKind, jpeg)}
          />
        )}
        {stage !== 'idle' && (
          <span data-testid="voice-stage" data-stage={stage} className={`text-xs ${stage === 'failed' ? 'text-red-700' : 'text-stone-600'}`}>
            {t(lang, `voice.stage.${stage}`)}
          </span>
        )}
        {hint && (
          <span data-testid="voice-hint" className="text-xs text-amber-700">
            {hint}
          </span>
        )}
      </div>
      <p className="mt-1 text-[11px] text-stone-400">{t(lang, 'composer.hint')}</p>
    </div>
  );
}
