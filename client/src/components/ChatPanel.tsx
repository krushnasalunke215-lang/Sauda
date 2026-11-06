import { useEffect, useRef, useState } from 'react';
import { otherRole, type Bi, type DealView, type Lang, type Message, type Role } from '../../../shared/types.js';
import { modelBadge, renderError, renderEvent, t, tMaybe } from '../i18n.js';

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
        className="rounded-full bg-white/80 px-2 py-0.5 text-xs text-stone-700 ring-1 ring-stone-300 hover:bg-white"
        onClick={() => {
          const a = audio.current;
          if (!a) return;
          if (a.paused) void a.play().catch(() => setPlaying(false));
          else a.pause();
        }}
      >
        {playing ? `⏸ ${t(lang, 'voice.pause')}` : `▶ ${t(lang, 'voice.play')}`}
      </button>
      <audio ref={audio} src={url} preload="none" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} />
    </span>
  );
}

const CHECK_ICON = { matches: '✓', differs: '✗', cannot_verify: '?' } as const;
const CHECK_STYLE = { matches: 'text-emerald-700', differs: 'text-red-700', cannot_verify: 'text-stone-500' } as const;

function PhotoBody({ m, view, lang, actions }: { m: Message; view: DealView; lang: Lang; actions: ChatActions }) {
  const p = m.photo!;
  const mine = (b: Bi | undefined) => (b ? b[view.role] || b[otherRole(view.role)] : '');
  const buyerName = view.parties.buyer.name;
  return (
    <div className="mt-1 space-y-2">
      <div className="text-[11px] font-medium uppercase tracking-wide text-stone-500">{t(lang, p.kind === 'reference' ? 'photo.reference' : 'photo.progress')}</div>
      {m.media && (
        <a href={actions.mediaUrl(m.media.file)} target="_blank" rel="noreferrer">
          <img data-testid="photo-image" src={actions.mediaUrl(m.media.file)} alt={mine(p.description) || t(lang, `photo.${p.kind}`)} className="max-h-64 rounded-lg ring-1 ring-stone-200" />
        </a>
      )}
      {m.status === 'done' && p.description && (
        <p data-testid="photo-description" className="whitespace-pre-wrap text-sm leading-relaxed">
          {mine(p.description)}
        </p>
      )}
      {m.status === 'done' && p.details && p.details.length > 0 && (
        <ul className="list-disc pl-5 text-sm text-stone-700">
          {p.details.map((d, i) => (
            <li key={i} data-testid="photo-detail">
              {mine(d.value)}
            </li>
          ))}
        </ul>
      )}
      {m.status === 'done' && p.checks && (
        <ul className="space-y-1 text-sm">
          {p.checks.map((c, i) => (
            <li key={i} data-testid="photo-check" data-field={c.field} data-status={c.status} className="flex gap-2">
              <span className={`w-4 font-bold ${CHECK_STYLE[c.status]}`} aria-label={t(lang, `photo.status.${c.status}`)}>
                {CHECK_ICON[c.status]}
              </span>
              <span>
                <b className="font-medium">{t(lang, `field.${c.field}`)}</b> <span className="text-stone-500">({t(lang, `photo.status.${c.status}`)})</span>
                {mine(c.note) && <span className="block text-stone-700">{mine(c.note)}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {m.status === 'done' && p.summary && mine(p.summary) && <p className="text-sm text-stone-700">{mine(p.summary)}</p>}
      {m.status === 'done' && <p className="text-[11px] italic text-stone-500">{t(lang, 'photo.advisory')}</p>}
      {m.status === 'done' && p.kind === 'progress' && (
        <div data-testid="photo-decision" data-decision={p.decision ? (p.decision.approve ? 'approved' : 'changes') : 'none'} className="flex flex-wrap items-center gap-2">
          {p.decision && (
            <span className={`text-sm font-medium ${p.decision.approve ? 'text-emerald-800' : 'text-amber-800'}`}>
              {t(lang, p.decision.approve ? 'photo.approved' : 'photo.changesRequested', { name: buyerName })}
            </span>
          )}
          {view.role === 'buyer' && (
            <>
              {p.decision?.approve !== true && (
                <button
                  type="button"
                  data-testid="photo-approve"
                  className="rounded-lg bg-emerald-700 px-3 py-1 text-sm font-medium text-white hover:bg-emerald-800"
                  onClick={() => actions.onDecide(m.id, true)}
                >
                  {t(lang, 'photo.approve')}
                </button>
              )}
              {p.decision === undefined && (
                <button
                  type="button"
                  data-testid="photo-reject"
                  className="rounded-lg border border-amber-400 px-3 py-1 text-sm text-amber-900 hover:bg-amber-50"
                  onClick={() => actions.onDecide(m.id, false)}
                >
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

function Bubble({ m, view, lang, highlight, actions }: { m: Message; view: DealView; lang: Lang; highlight: boolean; actions: ChatActions }) {
  const ring = highlight ? 'cite-flash' : '';
  if (m.from === 'system') {
    return (
      <div id={`msg-${m.seq}`} data-testid="message" data-seq={m.seq} data-from="system" className={`mx-auto max-w-md rounded-lg px-3 py-1 text-center text-xs text-stone-500 ${ring}`}>
        <span className="mr-1 text-stone-400">#{m.seq}</span>
        {m.event ? renderEvent(lang, m.event, view.parties) : ''}
      </div>
    );
  }
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
  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div
        id={`msg-${m.seq}`}
        data-testid="message"
        data-seq={m.seq}
        data-from={from}
        data-kind={m.kind}
        data-status={m.status}
        className={`max-w-[85%] rounded-2xl px-4 py-2 shadow-sm ${mine ? 'bg-emerald-50 text-stone-900' : 'bg-stone-100 text-stone-900'} ${ring}`}
      >
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-stone-500">
          <span>#{m.seq}</span>
          <span className="font-medium">{view.parties[from].name}</span>
          {m.kind === 'voice' && <span aria-label={t(lang, 'voice.voiceMessage')}>🎤</span>}
          {m.sample && (
            <span data-testid="sample-tag" className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-800 ring-1 ring-amber-200">
              {t(lang, 'voice.sampleTag')}
            </span>
          )}
          {m.ai && (
            <span data-testid="model-badge" className="rounded bg-white/70 px-1.5 py-0.5 text-[10px] text-stone-600 ring-1 ring-stone-200">
              {modelBadge(lang, m.ai)}
            </span>
          )}
          {m.kind === 'voice' && m.media && <OriginalAudio url={actions.mediaUrl(m.media.file)} lang={lang} />}
          {!mine && done && m.translation?.text && (
            <button
              type="button"
              data-testid="listen"
              title={t(lang, 'voice.listen')}
              className="rounded-full bg-white/80 px-2 py-0.5 text-xs text-stone-700 ring-1 ring-stone-300 hover:bg-white"
              onClick={() => actions.onListen(m)}
            >
              🔊 {t(lang, 'voice.listen')}
            </button>
          )}
        </div>
        {photo ? (
          <PhotoBody m={m} view={view} lang={lang} actions={actions} />
        ) : main ? (
          <p data-testid="message-main" className="mt-1 whitespace-pre-wrap text-base leading-relaxed">
            {main}
          </p>
        ) : (
          <p className="mt-1 text-sm italic text-stone-500">{m.status === 'failed' ? t(lang, 'chat.failed') : workingText}</p>
        )}
        {sub && (
          <p data-testid="message-sub" className="mt-1 whitespace-pre-wrap border-t border-stone-200/70 pt-1 text-xs text-stone-500">
            <span className="mr-1 font-medium">{mine ? t(lang, 'chat.translatedFor', { name: other.name }) : t(lang, 'chat.original')}:</span>
            {sub}
          </p>
        )}
        {working && (photo || (mine && main)) && <p className="mt-1 text-xs italic text-stone-500">{workingText}</p>}
        {m.status === 'failed' && (
          <div className="mt-1 flex items-center gap-2 text-xs text-red-700">
            <span>{renderError(lang, m.error)}</span>
            {mine && (
              <button type="button" data-testid="retry" className="rounded border border-red-300 px-2 py-0.5 hover:bg-red-50" onClick={() => actions.onRetry(m.id)}>
                {t(lang, 'chat.retry')}
              </button>
            )}
          </div>
        )}
        {m.warnings?.map((w) => (
          <p key={w} className="mt-1 text-xs text-amber-700">
            {tMaybe(lang, `warning.${w}`, {}, w)}
          </p>
        ))}
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
    <div className="flex-1 space-y-3 overflow-y-auto p-4" data-testid="chat">
      {view.messages.length <= 1 && <p className="text-center text-sm text-stone-500">{t(lang, 'chat.empty')}</p>}
      {view.messages.map((m) => (
        <Bubble key={m.id} m={m} view={view} lang={lang} highlight={highlight === m.seq} actions={actions} />
      ))}
      <div ref={end} />
    </div>
  );
}
