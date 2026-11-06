import { useEffect, useRef } from 'react';
import { otherRole, type DealView, type Lang, type Message } from '../../../shared/types.js';
import { modelBadge, renderError, renderEvent, t, tMaybe } from '../i18n.js';

function Bubble({ m, view, lang, highlight, onRetry }: { m: Message; view: DealView; lang: Lang; highlight: boolean; onRetry: (id: string) => void }) {
  const ring = highlight ? 'cite-flash' : '';
  if (m.from === 'system') {
    return (
      <div id={`msg-${m.seq}`} data-testid="message" data-seq={m.seq} data-from="system" className={`mx-auto max-w-md rounded-lg px-3 py-1 text-center text-xs text-stone-500 ${ring}`}>
        <span className="mr-1 text-stone-400">#{m.seq}</span>
        {m.event ? renderEvent(lang, m.event, view.parties) : ''}
      </div>
    );
  }
  const mine = m.from === view.role;
  const other = view.parties[otherRole(view.role)];
  const done = m.status === 'done';
  // The viewer's language is prominent: their own words, or the translation of the other side's.
  const main = mine ? m.original?.text : done ? m.translation?.text : null;
  const sub = mine ? (done ? m.translation?.text : null) : m.original?.text;
  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div
        id={`msg-${m.seq}`}
        data-testid="message"
        data-seq={m.seq}
        data-from={m.from}
        data-status={m.status}
        className={`max-w-[85%] rounded-2xl px-4 py-2 shadow-sm ${mine ? 'bg-emerald-50 text-stone-900' : 'bg-stone-100 text-stone-900'} ${ring}`}
      >
        <div className="flex items-center gap-2 text-[11px] text-stone-500">
          <span>#{m.seq}</span>
          <span className="font-medium">{view.parties[m.from].name}</span>
          {m.ai && (
            <span data-testid="model-badge" className="rounded bg-white/70 px-1.5 py-0.5 text-[10px] text-stone-600 ring-1 ring-stone-200">
              {modelBadge(lang, m.ai)}
            </span>
          )}
        </div>
        {main ? (
          <p data-testid="message-main" className="mt-1 whitespace-pre-wrap text-base leading-relaxed">
            {main}
          </p>
        ) : (
          <p className="mt-1 text-sm italic text-stone-500">{t(lang, m.status === 'failed' ? 'chat.failed' : m.status === 'pending' ? 'chat.pending' : 'chat.interpreting')}</p>
        )}
        {sub && (
          <p data-testid="message-sub" className="mt-1 whitespace-pre-wrap border-t border-stone-200/70 pt-1 text-xs text-stone-500">
            <span className="mr-1 font-medium">{mine ? t(lang, 'chat.translatedFor', { name: other.name }) : t(lang, 'chat.original')}:</span>
            {sub}
          </p>
        )}
        {mine && (m.status === 'pending' || m.status === 'interpreting') && (
          <p className="mt-1 text-xs italic text-stone-500">{t(lang, m.status === 'pending' ? 'chat.pending' : 'chat.interpreting')}</p>
        )}
        {m.status === 'failed' && (
          <div className="mt-1 flex items-center gap-2 text-xs text-red-700">
            <span>{renderError(lang, m.error)}</span>
            {mine && (
              <button type="button" data-testid="retry" className="rounded border border-red-300 px-2 py-0.5 hover:bg-red-50" onClick={() => onRetry(m.id)}>
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

export function ChatPanel({ view, lang, highlight, onRetry }: { view: DealView; lang: Lang; highlight: number | null; onRetry: (id: string) => void }) {
  const end = useRef<HTMLDivElement>(null);
  const last = view.messages.at(-1);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [view.messages.length, last?.status]);
  return (
    <div className="flex-1 space-y-3 overflow-y-auto p-4" data-testid="chat">
      {view.messages.length <= 1 && <p className="text-center text-sm text-stone-500">{t(lang, 'chat.empty')}</p>}
      {view.messages.map((m) => (
        <Bubble key={m.id} m={m} view={view} lang={lang} highlight={highlight === m.seq} onRetry={onRetry} />
      ))}
      <div ref={end} />
    </div>
  );
}
