import { useCallback, useEffect, useRef, useState } from 'react';
import { otherRole, type DealView, type Lang } from '../../../shared/types.js';
import { ApiError, api } from '../api.js';
import { AgreementPanel } from '../components/AgreementPanel.js';
import { ChatPanel } from '../components/ChatPanel.js';
import { Composer } from '../components/Composer.js';
import { ConfirmCard } from '../components/ConfirmCard.js';
import { CopyButton } from '../components/CopyButton.js';
import { QuestionsPanel } from '../components/QuestionsPanel.js';
import { renderError, t } from '../i18n.js';
import { subscribeDeal, type SocketStatus } from '../socket.js';

const PHASE_STYLE: Record<DealView['phase'], string> = {
  negotiating: 'bg-amber-100 text-amber-900',
  confirmed: 'bg-emerald-100 text-emerald-900',
  invoiced: 'bg-sky-100 text-sky-900',
  deposit_paid: 'bg-sky-100 text-sky-900',
  paid: 'bg-emerald-200 text-emerald-950',
  shipped: 'bg-violet-100 text-violet-900',
  cancelled: 'bg-stone-200 text-stone-700',
};

export function Room({ dealId, token }: { dealId: string; token: string }) {
  const [view, setView] = useState<DealView | null>(null);
  const [status, setStatus] = useState<SocketStatus>('connecting');
  const [highlight, setHighlight] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  /** Keeps whichever snapshot is newer (socket pushes and HTTP responses can cross). */
  const accept = useCallback((v: DealView) => setView((cur) => (!cur || v.updatedAt >= cur.updatedAt ? v : cur)), []);

  useEffect(() => subscribeDeal(dealId, token, { onDeal: accept, onStatus: setStatus }), [dealId, token, accept]);
  useEffect(() => {
    api<DealView>(`/api/deals/${dealId}`, { token })
      .then(accept)
      .catch((e) => {
        if (e instanceof ApiError && (e.status === 403 || e.status === 400)) setStatus('forbidden');
      });
  }, [dealId, token, accept]);

  const lang: Lang = view ? view.parties[view.role].lang : 'en';
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const cite = useCallback((seq: number) => {
    document.getElementById(`msg-${seq}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlight(seq);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setHighlight(null), 2000);
  }, []);

  /** Runs an API action and shows its error code in the viewer's language. */
  const run = useCallback(
    async (fn: () => Promise<DealView | unknown>) => {
      setError(null);
      try {
        const r = await fn();
        if (r && typeof r === 'object' && 'agreement' in r) accept(r as DealView);
        return true;
      } catch (e) {
        setError(renderError(lang, e instanceof ApiError ? e.code : undefined));
        return false;
      }
    },
    [accept, lang],
  );

  if (status === 'forbidden') {
    return (
      <main className="mx-auto max-w-xl p-8">
        <p className="text-red-700" data-testid="forbidden">
          {t('en', 'room.forbidden')}
        </p>
      </main>
    );
  }
  if (!view) return <main className="p-8 text-stone-500">{t('en', 'room.connecting')}</main>;

  const me = view.parties[view.role];
  const other = view.parties[otherRole(view.role)];
  const inviteUrl = view.inviteUrl ? new URL(view.inviteUrl, window.location.origin).href : null;

  return (
    <div className="flex min-h-screen flex-col" data-testid="room" data-role={view.role} data-lang={lang}>
      <header className="border-b border-stone-200 bg-white px-4 py-3">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2">
          <div className="text-xl font-bold">
            {t(lang, 'app.name')} <span className="text-sm font-normal text-stone-500">SAUDA-{view.id}</span>
          </div>
          <div className="text-sm text-stone-600">
            {t(lang, 'room.you', { role: t(lang, `role.${view.role}`) })}: <b>{me.name}</b> · {t(lang, 'room.with', { name: other.name })}
          </div>
          <span data-testid="phase" data-phase={view.phase} className={`rounded-full px-3 py-1 text-xs font-semibold ${PHASE_STYLE[view.phase]}`}>
            {t(lang, `phase.${view.phase}`)}
          </span>
          {status !== 'connected' && <span className="text-xs text-amber-700">{t(lang, status === 'connecting' ? 'room.connecting' : 'room.reconnecting')}</span>}
          {inviteUrl && (
            <div className="flex items-center gap-2 text-xs sm:ml-auto">
              <span className="text-stone-500">{t(lang, 'room.invite')}</span>
              <code data-testid="invite-url" className="max-w-56 truncate rounded bg-stone-100 px-2 py-1">
                {inviteUrl}
              </code>
              <CopyButton text={inviteUrl} label={t(lang, 'room.copy')} done={t(lang, 'room.copied')} />
            </div>
          )}
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-6xl flex-1 gap-4 p-4 lg:grid-cols-[1fr_380px]">
        <section className="flex min-h-[60vh] flex-col overflow-hidden rounded-xl border border-stone-200 bg-white lg:h-[calc(100vh-7rem)]">
          <h2 className="border-b border-stone-100 px-4 py-2 text-sm font-semibold text-stone-600">{t(lang, 'chat.title')}</h2>
          <ChatPanel
            view={view}
            lang={lang}
            highlight={highlight}
            onRetry={(id) => void run(() => api(`/api/deals/${dealId}/turns/${id}/retry`, { method: 'POST', token }))}
          />
          {error && (
            <p className="px-4 py-1 text-sm text-red-700" data-testid="room-error">
              {error}
            </p>
          )}
          <Composer
            lang={lang}
            otherName={other.name}
            onSend={(text) => run(() => api(`/api/deals/${dealId}/turns`, { token, body: { text } }))}
          />
        </section>
        <aside className="flex flex-col gap-4 lg:h-[calc(100vh-7rem)] lg:overflow-y-auto">
          <AgreementPanel view={view} lang={lang} onCite={cite} />
          <QuestionsPanel
            view={view}
            lang={lang}
            onCite={cite}
            onDismiss={(qid) => void run(() => api<DealView>(`/api/deals/${dealId}/questions/${qid}/dismiss`, { method: 'POST', token }))}
          />
          <ConfirmCard
            view={view}
            lang={lang}
            onConfirm={() => run(() => api<DealView>(`/api/deals/${dealId}/confirm`, { token, body: { hash: view.agreement.hash } }))}
          />
        </aside>
      </div>
    </div>
  );
}
