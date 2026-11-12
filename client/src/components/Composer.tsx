import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { AgreementRow, Lang, Message, PhotoKind, SampleInfo } from '../../../shared/types.js';
import { MAX_RECORD_MS, type Clip } from '../audio/recorder.js';
import { t, tMaybe } from '../i18n.js';
import { ui, useCloseOnOutside } from '../ui.js';
import { Icon } from './Icon.js';
import { PhotoButton } from './PhotoButton.js';
import { PushToTalk } from './PushToTalk.js';
import { SoundWave } from './SoundWave.js';

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
  /** The other party's language (the translation target shown in the voice stages). */
  otherLang: Lang;
  messages: Message[];
  /** The agreement rows, to say how many terms a voice message set. */
  rows: AgreementRow[];
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

/** Re-renders every 250 ms while `on`, and returns the current time. */
function useNow(on: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [on]);
  return now;
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

type StepState = 'done' | 'active' | 'todo' | 'failed';

function StepMark({ state }: { state: StepState }) {
  if (state === 'done') return <Icon name="checkCircle" size={14} className="text-emerald-600" />;
  if (state === 'failed') return <Icon name="alert" size={14} className="text-red-700" />;
  if (state === 'active')
    return (
      <span className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center" aria-hidden>
        <span className="h-2 w-2 animate-pulse rounded-full bg-brand" />
      </span>
    );
  return <span className="h-3 w-3 shrink-0 rounded-full ring-[1.5px] ring-inset ring-stone-300" aria-hidden />;
}

const STEP_TEXT: Record<StepState, string> = {
  done: 'text-stone-600',
  active: 'font-medium text-stone-900',
  todo: 'text-stone-400',
  failed: 'font-medium text-red-700',
};

/**
 * What happens to a voice message, step by step, with the states the app really has: the clip was
 * recorded (mic only), it is being sent, one AI call understands and translates it (with a seconds
 * counter), and the agreement was updated. There is no separate translation call, so understanding
 * and translating are one step.
 */
function VoiceStages(props: { lang: Lang; otherLang: Lang; stage: Stage; status: Message['status'] | null; fromMic: boolean; seconds: number; terms: number }) {
  const { lang, otherLang, stage, status, fromMic, seconds, terms } = props;
  const sending = stage === 'uploading' || status === 'pending';
  const understanding: StepState = stage === 'done' ? 'done' : stage === 'failed' ? 'failed' : sending ? 'todo' : 'active';
  const steps: { key: string; state: StepState; label: string; extra?: string }[] = [];
  if (fromMic) steps.push({ key: 'listen', state: 'done', label: t(lang, 'voice.step.listened') });
  steps.push({ key: 'send', state: sending ? 'active' : 'done', label: t(lang, sending ? 'voice.step.sending' : 'voice.step.sent') });
  steps.push({
    key: 'understand',
    state: understanding,
    label:
      understanding === 'done'
        ? t(lang, 'voice.step.understood')
        : understanding === 'failed'
          ? t(lang, 'voice.stage.failed')
          : t(lang, 'voice.step.understanding', { from: t(lang, `langName.${lang}`), to: t(lang, `langName.${otherLang}`) }),
    extra: understanding === 'active' ? t(lang, 'voice.seconds', { s: seconds }) : undefined,
  });
  if (stage !== 'failed')
    steps.push({
      key: 'agreement',
      state: stage === 'done' ? 'done' : 'todo',
      label: stage !== 'done' ? t(lang, 'voice.step.update') : terms > 0 ? t(lang, 'voice.step.updated', { n: terms }) : t(lang, 'voice.step.noTerms'),
    });
  return (
    <ol data-testid="voice-stage" data-stage={stage} aria-live="polite" className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 pt-3 text-xs">
      {steps.map((s) => (
        <li key={s.key} data-step={s.key} data-state={s.state} className={`inline-flex items-center gap-1.5 ${STEP_TEXT[s.state]}`}>
          <StepMark state={s.state} />
          {s.label}
          {s.extra && <span className="font-normal tabular-nums text-stone-500">{s.extra}</span>}
        </li>
      ))}
    </ol>
  );
}

export function Composer(props: ComposerProps) {
  const { lang, otherName, otherLang, messages, rows, samples, photoKind, onSend, onVoice, onSample, onPhoto, sampleTexts = [], onSamplePhoto } = props;
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [samplePhotoBusy, setSamplePhotoBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [recStart, setRecStart] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [voiceId, setVoiceId] = useState<string | null>(null);
  const [fromMic, setFromMic] = useState(false);
  const [workStart, setWorkStart] = useState(0);
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
  const status = voiceMsg?.status ?? null;
  const now = useNow(recording || status === 'interpreting');

  // The seconds counter of the AI step starts when the server begins interpreting.
  useEffect(() => {
    if (status === 'interpreting') setWorkStart(Date.now());
  }, [status]);

  // The finished steps stay a moment, then the stage line clears.
  useEffect(() => {
    if (stage !== 'done' && stage !== 'failed') return;
    const id = setTimeout(() => setVoiceId(null), stage === 'done' ? 4000 : 6000);
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

  async function uploadVoice(run: () => Promise<string | null>, mic: boolean) {
    setHint(null);
    setFromMic(mic);
    setUploading(true);
    setVoiceId(null);
    const id = await run();
    setUploading(false);
    if (id) setVoiceId(id);
  }

  function onClip(clip: Clip) {
    void uploadVoice(() => onVoice(clip.blob, clip.mimeType), true);
  }

  function onFile(file: File | undefined) {
    if (fileInput.current) fileInput.current.value = '';
    if (!file) return;
    if (file.size > MAX_VOICE_BYTES) return setHint(t(lang, 'voice.tooBig'));
    const type = file.type || TYPE_BY_EXT[file.name.split('.').pop()?.toLowerCase() ?? ''] || 'application/octet-stream';
    void uploadVoice(() => onVoice(file, type), false);
  }

  function pickSample(id: string) {
    if (menu.current) menu.current.open = false;
    void uploadVoice(() => onSample(id), false);
  }

  const voiceBusy = uploading || stage === 'interpreting';
  const recSeconds = recording ? Math.min(MAX_RECORD_MS / 1000, Math.floor((now - recStart) / 1000)) : 0;

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
      <div className="flex items-end gap-2.5 sm:gap-3">
        <PushToTalk
          lang={lang}
          disabled={voiceBusy}
          onClip={onClip}
          onRecording={(on) => {
            setRecording(on);
            if (on) {
              setRecStart(Date.now());
              setHint(null);
            }
          }}
          onStream={setStream}
          onError={(code) => setHint(tMaybe(lang, `voice.error.${code}`, {}, t(lang, 'voice.error.mic_error')))}
        />
        {/* A size container: the tool labels show only when the box itself is wide enough (not in the narrow chat next to the board). */}
        <div className="@container min-w-0 flex-1 rounded-2xl bg-stone-50 ring-1 ring-stone-200 transition-shadow focus-within:bg-white focus-within:ring-2 focus-within:ring-brand">
          {stage !== 'idle' && stage !== 'recording' && (
            <VoiceStages
              lang={lang}
              otherLang={otherLang}
              stage={stage}
              status={status}
              fromMic={fromMic}
              seconds={workStart ? Math.max(0, Math.floor((now - workStart) / 1000)) : 0}
              terms={voiceId ? rows.filter((r) => r.sourceMessageId === voiceId).length : 0}
            />
          )}
          {recording ? (
            <div data-testid="voice-stage" data-stage="recording" aria-live="polite" className="flex min-h-16 items-center gap-3 px-4 py-2.5">
              <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-red-600" aria-hidden />
              <div className="shrink-0 leading-tight">
                <div className="text-sm font-medium text-stone-900">{t(lang, 'voice.listening')}</div>
                <div className="mt-0.5 text-xs text-stone-500 tabular-nums">
                  {clock(recSeconds)} / {clock(MAX_RECORD_MS / 1000)}
                </div>
              </div>
              <SoundWave stream={stream} className="h-10 min-w-0 flex-1" />
            </div>
          ) : (
            <textarea
              data-testid="composer-input"
              lang={lang}
              className="block max-h-40 min-h-12 w-full resize-none bg-transparent px-4 pt-3 pb-1 text-[15px] leading-relaxed text-stone-900 placeholder:text-stone-400 focus:outline-none"
              rows={2}
              maxLength={1000}
              value={text}
              title={t(lang, 'composer.hint')}
              placeholder={t(lang, 'composer.placeholder', { name: otherName, lang: t(lang, `lang.${lang}`) })}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKey}
            />
          )}
          <div className="flex flex-wrap items-center gap-1 px-2 pb-2">
            {recording ? (
              <span className="px-2 text-xs text-stone-500">{t(lang, 'voice.stopHint')}</span>
            ) : (
              <>
                <button
                  type="button"
                  data-testid="voice-file-button"
                  disabled={voiceBusy}
                  onClick={() => fileInput.current?.click()}
                  title={t(lang, 'voice.note')}
                  aria-label={t(lang, 'voice.note')}
                  className={ui.btnTool}
                >
                  <Icon name="upload" />
                  <span className="hidden @lg:inline">{t(lang, 'voice.note')}</span>
                </button>
                {samples.length > 0 && (
                  <details ref={menu} className="relative" data-testid="samples-menu">
                    <summary className={`${ui.btnTool} ${ui.summary}`} title={t(lang, 'voice.samples')} aria-label={t(lang, 'voice.samples')}>
                      <Icon name="headphones" />
                      <span className="hidden @lg:inline">{t(lang, 'voice.samples')}</span>
                    </summary>
                    <div className={`${ui.menu} absolute bottom-full left-0 mb-2 w-72`}>
                      {samples.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          data-testid="sample-clip"
                          data-id={s.id}
                          disabled={voiceBusy}
                          onClick={() => pickSample(s.id)}
                          className={ui.menuItem}
                        >
                          <Icon name="play" size={12} className="text-brand" />
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
                    disabled={false}
                    onUpload={(jpeg) => onPhoto(photoKind, jpeg)}
                  />
                )}
                {photoKind && onSamplePhoto && (
                  <button
                    type="button"
                    data-testid="sample-photo"
                    data-kind={photoKind}
                    disabled={samplePhotoBusy}
                    onClick={() => void sendSamplePhoto()}
                    title={t(lang, photoKind === 'reference' ? 'photo.sampleReference' : 'photo.sampleProgress')}
                    aria-label={t(lang, photoKind === 'reference' ? 'photo.sampleReference' : 'photo.sampleProgress')}
                    className={ui.btnTool}
                  >
                    <Icon name="image" />
                    <span className="hidden @lg:inline">
                      {samplePhotoBusy ? t(lang, 'photo.uploading') : t(lang, photoKind === 'reference' ? 'photo.sampleReference' : 'photo.sampleProgress')}
                    </span>
                  </button>
                )}
              </>
            )}
            <button
              type="button"
              data-testid="composer-send"
              disabled={busy || recording || !text.trim()}
              onClick={() => void send()}
              aria-label={t(lang, 'composer.send')}
              title={t(lang, 'composer.send')}
              className={`${ui.btnSend} ml-auto`}
            >
              <Icon name="arrowUp" size={18} />
            </button>
          </div>
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
