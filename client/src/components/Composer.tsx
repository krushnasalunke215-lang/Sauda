import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { Lang, Message, PhotoKind, SampleInfo } from '../../../shared/types.js';
import type { Clip } from '../audio/recorder.js';
import { t, tMaybe } from '../i18n.js';
import { ui, useCloseOnOutside } from '../ui.js';
import { Icon } from './Icon.js';
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
  /** Sample messages shown as chips above the input; a tap sends one. */
  sampleTexts?: readonly string[];
  /** Uploads the built-in sample photo for photoKind; absent when there is none. */
  onSamplePhoto?: () => Promise<boolean>;
}

export function Composer(props: ComposerProps) {
  const { lang, otherName, messages, samples, photoKind, onSend, onVoice, onSample, onPhoto, sampleTexts = [], onSamplePhoto } = props;
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [samplePhotoBusy, setSamplePhotoBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [voiceId, setVoiceId] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const menu = useRef<HTMLDetailsElement>(null);
  useCloseOnOutside(menu);

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

  async function sendSample(v: string) {
    if (busy) return;
    setBusy(true);
    await onSend(v);
    setBusy(false);
  }

  async function sendSamplePhoto() {
    if (!onSamplePhoto || samplePhotoBusy) return;
    setSamplePhotoBusy(true);
    await onSamplePhoto();
    setSamplePhotoBusy(false);
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
    <div className="p-3 sm:p-4">
      {sampleTexts.length > 0 && (
        <div className="scroll-quiet -mx-1 mb-2 flex gap-1.5 overflow-x-auto px-1 pb-0.5" role="group" aria-label={t(lang, 'composer.sampleTexts')} data-testid="sample-texts">
          {sampleTexts.map((s, i) => (
            <button key={s} type="button" data-testid="sample-text" data-index={i} title={s} disabled={busy} onClick={() => void sendSample(s)} className={`${ui.chip} max-w-[18rem]`}>
              <span className="truncate">{s}</span>
            </button>
          ))}
        </div>
      )}
      <div className="rounded-2xl bg-stone-50 ring-1 ring-stone-200 transition-shadow focus-within:bg-white focus-within:ring-2 focus-within:ring-emerald-600">
        <textarea
          data-testid="composer-input"
          className="block max-h-40 min-h-12 w-full resize-none bg-transparent px-4 pt-3 pb-1 text-[15px] leading-relaxed text-stone-900 placeholder:text-stone-400 focus:outline-none"
          rows={2}
          maxLength={1000}
          value={text}
          title={t(lang, 'composer.hint')}
          placeholder={t(lang, 'composer.placeholder', { name: otherName, lang: t(lang, `lang.${lang}`) })}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
        />
        <div className="flex flex-wrap items-center gap-1 px-2 pb-2">
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
            title={t(lang, 'voice.note')}
            className={ui.btnTool}
          >
            <Icon name="upload" />
            <span className="hidden sm:inline">{t(lang, 'voice.note')}</span>
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
              <summary className={`${ui.btnTool} ${ui.summary}`} title={t(lang, 'voice.samples')}>
                <Icon name="headphones" />
                <span className="hidden sm:inline">{t(lang, 'voice.samples')}</span>
              </summary>
              <div className={`${ui.menu} absolute bottom-full left-0 mb-2 w-72`}>
                {samples.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    data-testid="sample-clip"
                    data-id={s.id}
                    disabled={voiceBusy || recording}
                    onClick={() => pickSample(s.id)}
                    className={ui.menuItem}
                  >
                    <Icon name="play" size={12} className="text-emerald-700" />
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
          {photoKind && onSamplePhoto && (
            <button
              type="button"
              data-testid="sample-photo"
              data-kind={photoKind}
              disabled={recording || samplePhotoBusy}
              onClick={() => void sendSamplePhoto()}
              title={t(lang, photoKind === 'reference' ? 'photo.sampleReference' : 'photo.sampleProgress')}
              className={ui.btnTool}
            >
              <Icon name="image" />
              <span className="hidden sm:inline">
                {samplePhotoBusy ? t(lang, 'photo.uploading') : t(lang, photoKind === 'reference' ? 'photo.sampleReference' : 'photo.sampleProgress')}
              </span>
            </button>
          )}
          {stage !== 'idle' && (
            <span data-testid="voice-stage" data-stage={stage} className={`px-1 text-xs ${stage === 'failed' ? 'text-red-700' : 'text-stone-500'}`}>
              {t(lang, `voice.stage.${stage}`)}
            </span>
          )}
          <button
            type="button"
            data-testid="composer-send"
            disabled={busy || !text.trim()}
            onClick={() => void send()}
            aria-label={t(lang, 'composer.send')}
            title={t(lang, 'composer.send')}
            className="ml-auto inline-flex h-9 w-9 items-center justify-center rounded-full bg-emerald-700 text-white transition-colors hover:bg-emerald-800 disabled:bg-stone-200 disabled:text-stone-400"
          >
            <Icon name="arrowUp" size={18} />
          </button>
        </div>
      </div>
      {hint && (
        <p data-testid="voice-hint" className="mt-2 px-2 text-xs text-amber-700">
          {hint}
        </p>
      )}
    </div>
  );
}
