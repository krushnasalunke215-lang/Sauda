import { useEffect, useRef, useState } from 'react';
import { otherRole, type Bi, type DealView, type Lang, type Message, type Role } from '../../../shared/types.js';
import { modelBadge, renderError, renderEvent, t, tMaybe } from '../i18n.js';
import { useJudge } from '../judge.js';
import { ui } from '../ui.js';
import { Icon, type IconName } from './Icon.js';

export interface ChatActions {
  onRetry: (id: string) => void;
  /** URL of a stored clip or photo (the token goes in the query string). */
  mediaUrl: (file: string) => string;
  /** Speaks the translation of the other side's message. */
  onListen: (m: Message) => void;
  /** The buyer's decision on a progress photo. */
  onDecide: (messageId: string, approve: boolean) => void;
}

/** Plays the original voice clip. */
function OriginalAudio({ url, lang }: { url: string; lang: Lang }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  return (
    <span className="inline-flex items-center">
      <button
        type="button"
        data-testid="voice-play"
        className={ui.btnBubble}
        onClick={() => {
          const a = audio.current;
          if (!a) return;
          if (a.paused) void a.play().catch(() => setPlaying(false));
          else a.pause();
        }}
      >
        <Icon name={playing ? 'pause' : 'play'} size={11} />
        {playing ? t(lang, 'voice.pause') : t(lang, 'voice.play')}
      </button>
      <audio ref={audio} src={url} preload="none" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} />
    </span>
  );
}

const CHECK_ICON: Record<'matches' | 'differs' | 'cannot_verify', IconName> = { matches: 'check', differs: 'x', cannot_verify: 'help' };
const CHECK_STYLE = {
  matches: 'bg-emerald-100 text-emerald-700',
  differs: 'bg-red-100 text-red-700',
  cannot_verify: 'bg-stone-200 text-stone-500',
} as const;

function PhotoBody({ m, view, lang, actions }: { m: Message; view: DealView; lang: Lang; actions: ChatActions }) {
  const p = m.photo!;
  const mine = (b: Bi | undefined) => (b ? b[view.role] || b[otherRole(view.role)] : '');
  const buyerName = view.parties.buyer.name;
  const done = m.status === 'done';
  return (
    <div className="space-y-3">
      <div className="text-xs font-medium text-stone-500">{t(lang, p.kind === 'reference' ? 'photo.reference' : 'photo.progress')}</div>
      {m.media && (
        <a href={actions.mediaUrl(m.media.file)} target="_blank" rel="noreferrer" className="block">
          <img
            data-testid="photo-image"
            src={actions.mediaUrl(m.media.file)}
            alt={mine(p.description) || t(lang, `photo.${p.kind}`)}
            className="max-h-64 rounded-xl object-cover ring-1 ring-black/5"
          />
        </a>
      )}
      {done && p.description && (
        <p data-testid="photo-description" className="whitespace-pre-wrap text-sm leading-relaxed text-stone-800">
          {mine(p.description)}
        </p>
      )}
      {done && p.checks && (
        <ul className="space-y-2 text-sm">
          {p.checks.map((c, i) => (
            <li key={i} data-testid="photo-check" data-field={c.field} data-status={c.status} className="flex gap-2.5">
              <span
                className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${CHECK_STYLE[c.status]}`}
                aria-label={t(lang, `photo.status.${c.status}`)}
              >
                <Icon name={CHECK_ICON[c.status]} size={12} />
              </span>
              <span className="min-w-0">
                <span className="font-medium text-stone-900">{t(lang, `field.${c.field}`)}</span>{' '}
                <span className="text-xs text-stone-400">· {t(lang, `photo.status.${c.status}`)}</span>
                {mine(c.note) && <span className="block text-[13px] leading-relaxed text-stone-600">{mine(c.note)}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {done && p.summary && mine(p.summary) && <p className="text-sm leading-relaxed text-stone-700">{mine(p.summary)}</p>}
      {done && p.details && p.details.length > 0 && (
        <details className="group">
          <summary className={`${ui.summary} inline-flex items-center gap-1 text-xs font-medium text-stone-500 hover:text-stone-800`}>
            {t(lang, 'photo.details')}
            <Icon name="chevronDown" size={13} className="transition-transform group-open:rotate-180" />
          </summary>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-[13px] text-stone-600">
            {p.details.map((d, i) => (
              <li key={i} data-testid="photo-detail">
                {mine(d.value)}
              </li>
            ))}
          </ul>
        </details>
      )}
      {done && (
        <p className="flex items-center gap-1 text-[11px] text-stone-400">
          <Icon name="sparkle" size={12} />
          {t(lang, 'photo.advisory')}
        </p>
      )}
      {done && p.kind === 'progress' && (
        <div data-testid="photo-decision" data-decision={p.decision ? (p.decision.approve ? 'approved' : 'changes') : 'none'} className="flex flex-wrap items-center gap-2">
          {p.decision && (
            <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${p.decision.approve ? 'text-emerald-800' : 'text-amber-800'}`}>
              <Icon name={p.decision.approve ? 'checkCircle' : 'alert'} />
              {t(lang, p.decision.approve ? 'photo.approved' : 'photo.changesRequested', { name: buyerName })}
            </span>
          )}
          {view.role === 'buyer' && (
            <>
              {p.decision?.approve !== true && (
                <button type="button" data-testid="photo-approve" className={`${ui.btnPrimary} px-3 py-1.5`} onClick={() => actions.onDecide(m.id, true)}>
                  {t(lang, 'photo.approve')}
                </button>
              )}
              {p.decision === undefined && (
                <button type="button" data-testid="photo-reject" className={`${ui.btnSecondary} py-1.5`} onClick={() => actions.onDecide(m.id, false)}>
                  {t(lang, 'photo.requestChanges')}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Milestones stand out in the conversation; other system events stay quiet. */
const MILESTONES = new Set(['agreement_confirmed', 'invoice_created', 'deposit_received', 'balance_received', 'paid_in_full', 'shipped', 'progress_approved']);
const ALERTS = new Set(['invoice_text_changed', 'invoice_cancelled', 'terms_changed', 'progress_changes_requested']);

function SystemLine({ m, view, lang, ring }: { m: Message; view: DealView; lang: Lang; ring: string }) {
  const judge = useJudge();
  const type = m.event?.type ?? '';
  const tone = MILESTONES.has(type) ? 'bg-emerald-50 text-emerald-800' : ALERTS.has(type) ? 'bg-amber-50 text-amber-900' : 'text-stone-500';
  return (
    <div className="flex justify-center">
      <div
        id={`msg-${m.seq}`}
        data-testid="message"
        data-seq={m.seq}
        data-from="system"
        className={`inline-flex max-w-md items-start gap-1.5 rounded-xl px-3 py-1.5 text-center text-xs leading-relaxed ${tone} ${ring}`}
      >
        {MILESTONES.has(type) && <Icon name="checkCircle" size={14} className="mt-px" />}
        <span>{m.event ? renderEvent(lang, m.event, view.parties, judge) : ''}</span>
      </div>
    </div>
  );
}

function Bubble({ m, view, lang, highlight, actions }: { m: Message; view: DealView; lang: Lang; highlight: boolean; actions: ChatActions }) {
  const judge = useJudge();
  const ring = highlight ? 'cite-flash' : '';
  if (m.from === 'system') return <SystemLine m={m} view={view} lang={lang} ring={ring} />;
  const from: Role = m.from;
  const mine = from === view.role;
  const other = view.parties[otherRole(view.role)];
  const done = m.status === 'done';
  const photo = m.kind === 'photo' && m.photo;
  // The viewer's language is prominent: their own words, or the translation of the other side's.
  const main = photo ? null : mine ? m.original?.text : done ? m.translation?.text : null;
  const sub = photo ? null : mine ? (done ? m.translation?.text : null) : m.original?.text;
  const working = m.status === 'pending' || m.status === 'interpreting';
  const workingText = t(lang, photo ? 'photo.looking' : m.status === 'pending' ? 'chat.pending' : 'chat.interpreting');
  const voice = m.kind === 'voice' && m.media;
  const listen = !mine && done && m.translation?.text;
  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div
        id={`msg-${m.seq}`}
        data-testid="message"
        data-seq={m.seq}
        data-from={from}
        data-kind={m.kind}
        data-status={m.status}
        className={`max-w-[80%] rounded-2xl px-4 py-3 ${mine ? 'rounded-br-md bg-emerald-50' : 'rounded-bl-md bg-stone-100'} ${ring}`}
      >
        {photo ? (
          <PhotoBody m={m} view={view} lang={lang} actions={actions} />
        ) : main ? (
          <p data-testid="message-main" className="whitespace-pre-wrap text-[15px] leading-relaxed text-stone-900">
            {main}
          </p>
        ) : (
          <p className={`text-sm ${m.status === 'failed' ? 'text-stone-500' : 'animate-pulse text-stone-500'}`}>{m.status === 'failed' ? t(lang, 'chat.failed') : workingText}</p>
        )}
        {sub && (
          <p data-testid="message-sub" className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-stone-500">
            <span className="block text-[11px] font-medium text-stone-400">{mine ? t(lang, 'chat.translatedFor', { name: other.name }) : t(lang, 'chat.original')}</span>
            {sub}
          </p>
        )}
        {working && (photo || (mine && main)) && <p className="mt-1.5 animate-pulse text-xs text-stone-500">{workingText}</p>}
        {m.status === 'failed' && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-red-700">
            <Icon name="alert" size={14} />
            <span>{renderError(lang, m.error)}</span>
            {mine && (
              <button type="button" data-testid="retry" className={`${ui.btnBubble} text-red-700 ring-red-200`} onClick={() => actions.onRetry(m.id)}>
                <Icon name="refresh" size={11} />
                {t(lang, 'chat.retry')}
              </button>
            )}
          </div>
        )}
        {m.warnings?.map((w) => (
          <p key={w} className="mt-1.5 text-xs text-amber-700">
            {tMaybe(lang, `warning.${w}`, {}, w)}
          </p>
        ))}
        {(voice || listen || m.sample || judge) && (
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-stone-400">
            {voice && <OriginalAudio url={actions.mediaUrl(m.media!.file)} lang={lang} />}
            {listen && (
              <button type="button" data-testid="listen" title={t(lang, 'voice.listen')} className={ui.btnBubble} onClick={() => actions.onListen(m)}>
                <Icon name="volume" size={12} />
                {t(lang, 'voice.listen')}
              </button>
            )}
            {m.sample && (
              <span data-testid="sample-tag" className="text-amber-700">
                {t(lang, 'voice.sampleTag')}
              </span>
            )}
            {/* Judge mode only: which model answered, how fast, and the message number. */}
            {judge && (
              <span className="ml-auto flex items-center gap-2">
                {m.ai && <span data-testid="model-badge">{modelBadge(lang, m.ai)}</span>}
                <span className="font-mono">#{m.seq}</span>
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function ChatPanel({ view, lang, highlight, actions }: { view: DealView; lang: Lang; highlight: number | null; actions: ChatActions }) {
  const end = useRef<HTMLDivElement>(null);
  const last = view.messages.at(-1);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [view.messages.length, last?.status]);
  return (
    <div className="scroll-quiet flex-1 space-y-4 overflow-y-auto px-4 py-6 sm:px-6" data-testid="chat">
      {view.messages.length <= 1 && <p className="mx-auto max-w-xs text-center text-sm leading-relaxed text-stone-400">{t(lang, 'chat.empty')}</p>}
      {view.messages.map((m) => (
        <Bubble key={m.id} m={m} view={view} lang={lang} highlight={highlight === m.seq} actions={actions} />
      ))}
      <div ref={end} />
    </div>
  );
}
