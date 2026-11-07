import { useCallback, useEffect, useRef, useState } from 'react';
import { depositPaid, otherRole, type DealView, type Lang, type Message, type PhotoKind, type SampleInfo } from '../../../shared/types.js';
import { ApiError, api, upload } from '../api.js';
import { playUrl, speak } from '../audio/speech.js';
import { AgreementPanel } from '../components/AgreementPanel.js';
import { ChatPanel } from '../components/ChatPanel.js';
import { Composer } from '../components/Composer.js';
import { ConfirmCard } from '../components/ConfirmCard.js';
import { CopyButton } from '../components/CopyButton.js';
import { Icon } from '../components/Icon.js';
import { MoneyTimeline } from '../components/MoneyTimeline.js';
import { PaymentPanel } from '../components/PaymentPanel.js';
import { ProposalsPanel } from '../components/ProposalCard.js';
import { QuestionsPanel } from '../components/QuestionsPanel.js';
import { renderError, t } from '../i18n.js';
import { subscribeDeal, type SocketStatus } from '../socket.js';
import { ui, useCloseOnOutside } from '../ui.js';

/** How many of the five deal steps (confirm, invoice, deposit, balance, ship) are done in each phase. */
const PHASE_STEPS: Record<DealView['phase'], number> = {
  negotiating: 0,
  confirmed: 1,
  invoiced: 2,
  deposit_paid: 3,
  paid: 4,
  shipped: 5,
  cancelled: 0,
};

/** The deal phase: five small segments for the steps done, and the phase name. */
function PhaseBadge({ phase, lang }: { phase: DealView['phase']; lang: Lang }) {
  const done = PHASE_STEPS[phase];
  const tone = phase === 'cancelled' ? 'text-stone-500' : phase === 'negotiating' ? 'text-stone-700' : 'text-emerald-800';
  return (
    <div data-testid="phase" data-phase={phase} className="flex shrink-0 items-center gap-2.5">
      <div className="hidden gap-1 sm:flex" aria-hidden>
        {[0, 1, 2, 3, 4].map((i) => (
          <span key={i} className={`h-1.5 w-4 rounded-full ${i < done ? 'bg-emerald-600' : 'bg-stone-200'}`} />
        ))}
      </div>
      <span className={`text-sm font-medium ${tone}`}>{t(lang, `phase.${phase}`)}</span>
    </div>
  );
}

/** The maker's buyer invite link, in a small popover. */
function InviteMenu({ url, lang }: { url: string; lang: Lang }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useCloseOnOutside(ref);
  return (
    <details ref={ref} className="relative">
      <summary className={`${ui.btnSecondary} ${ui.summary} py-1.5`} title={t(lang, 'room.invite')}>
        <Icon name="link" />
        <span className="hidden md:inline">{t(lang, 'room.invite')}</span>
      </summary>
      <div className={`${ui.menu} absolute right-0 top-full mt-2 w-80 p-4`}>
        <div className={ui.label}>{t(lang, 'room.invite')}</div>
        <div className="mt-2 flex items-center gap-2">
          <code data-testid="invite-url" className="min-w-0 flex-1 truncate rounded-lg bg-stone-50 px-2.5 py-1.5 text-xs text-stone-700 ring-1 ring-stone-200">
            {url}
          </code>
          <CopyButton text={url} label={t(lang, 'room.copy')} done={t(lang, 'room.copied')} />
        </div>
      </div>
    </details>
  );
}

type Sound = 'unset' | 'on' | 'off';
const SOUND_KEY = 'sauda.autoplay';

function readSound(): Sound {
  try {
    const v = localStorage.getItem(SOUND_KEY);
    return v === 'on' || v === 'off' ? v : 'unset';
  } catch {
    return 'unset';
  }
}

/**
 * Auto-play: speaks the translation of each new message from the other side once it is interpreted.
 * Browsers only allow sound after a user gesture, so it switches on with the first click and stays
 * in localStorage; until then an "enable sound" chip shows.
 */
function useAutoPlay(view: DealView | null, say: (m: Message) => void) {
  const [sound, setSoundState] = useState<Sound>(readSound);
  const seen = useRef<Set<string> | null>(null);

  const setSound = useCallback((s: Sound) => {
    setSoundState(s);
    try {
      localStorage.setItem(SOUND_KEY, s);
    } catch {
      // private mode: the setting lasts for this page only
    }
  }, []);

  useEffect(() => {
    if (sound !== 'unset') return;
    const on = () => setSound('on');
    document.addEventListener('pointerdown', on, { once: true });
    document.addEventListener('keydown', on, { once: true });
    return () => {
      document.removeEventListener('pointerdown', on);
      document.removeEventListener('keydown', on);
    };
  }, [sound, setSound]);

  useEffect(() => {
    if (!view) return;
    const fresh = view.messages.filter((m) => m.from === otherRole(view.role) && m.status === 'done' && m.translation?.text);
    if (!seen.current) {
      // Messages already interpreted when the page opened are history, not news.
      seen.current = new Set(fresh.map((m) => m.id));
      return;
    }
    for (const m of fresh) {
      if (seen.current.has(m.id)) continue;
      seen.current.add(m.id);
      if (sound === 'on') say(m);
    }
  }, [view, sound, say]);

  return { sound, setSound };
}

export function Room({ dealId, token }: { dealId: string; token: string }) {
  const [view, setView] = useState<DealView | null>(null);
  const [status, setStatus] = useState<SocketStatus>('connecting');
  const [highlight, setHighlight] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [samples, setSamples] = useState<SampleInfo[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<'deal' | 'timeline'>('deal');
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
  const role = view?.role;
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  useEffect(() => {
    if (!role) return;
    api<SampleInfo[]>('/api/samples')
      .then((all) => setSamples(all.filter((s) => s.kind === 'voice' && s.role === role)))
      .catch(() => setSamples([]));
  }, [role]);

  const mediaUrl = useCallback((file: string) => `/api/deals/${dealId}/media/${encodeURIComponent(file)}?t=${encodeURIComponent(token)}`, [dealId, token]);

  /** Speaks a translation with a browser voice, or the server's TTS when the device has none. */
  const say = useCallback(
    async (m: Message) => {
      const tr = m.translation;
      if (!tr?.text) return;
      setNotice(null);
      try {
        if (await speak(tr.text, tr.lang)) return;
        await playUrl(`/api/deals/${dealId}/messages/${m.id}/tts?t=${encodeURIComponent(token)}`);
      } catch {
        setNotice(t(lang, 'speech.noVoice', { lang: t(lang, `langName.${tr.lang}`) }));
      }
    },
    [dealId, token, lang],
  );
  const { sound, setSound } = useAutoPlay(view, say);

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
      <main className="mx-auto max-w-md px-4 py-24 text-center">
        <p className="inline-flex items-center gap-2 text-sm text-red-700" data-testid="forbidden">
          <Icon name="alert" />
          {t('en', 'room.forbidden')}
        </p>
      </main>
    );
  }
  if (!view) return <main className="px-4 py-24 text-center text-sm text-stone-500">{t('en', 'room.connecting')}</main>;

  const me = view.parties[view.role];
  const other = view.parties[otherRole(view.role)];
  const inviteUrl = view.inviteUrl ? new URL(view.inviteUrl, window.location.origin).href : null;
  // The buyer can add a reference photo until the invoice exists; the maker sends progress photos once the deposit is paid.
  const photoKind: PhotoKind | null =
    view.role === 'buyer' ? (view.invoice ? null : 'reference') : depositPaid(view) && view.phase !== 'cancelled' ? 'progress' : null;

  /** Runs an upload or sample request and returns the new message id (errors show in the room). */
  const startTurn = async (fn: () => Promise<{ messageId: string }>): Promise<string | null> => {
    setError(null);
    try {
      return (await fn()).messageId;
    } catch (e) {
      setError(renderError(lang, e instanceof ApiError ? e.code : undefined));
      return null;
    }
  };

  const soundLabel = t(lang, sound === 'on' ? 'sound.on' : 'sound.off');

  return (
    <div className="flex min-h-dvh flex-col" data-testid="room" data-role={view.role} data-lang={lang}>
      <header className="sticky top-0 z-20 h-14 shrink-0 border-b border-stone-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-full max-w-7xl items-center gap-3 px-4 sm:gap-4">
          <span className="text-base font-bold tracking-tight text-stone-900">{t(lang, 'app.name')}</span>
          <span className="h-6 w-px bg-stone-200" aria-hidden />
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-sm font-semibold text-stone-900">
              {me.name} <span className="font-normal text-stone-500">· {t(lang, `role.${view.role}`)}</span>
            </div>
            <div className="truncate text-xs text-stone-500">
              {t(lang, 'room.with', { name: other.name })} · SAUDA-{view.id}
            </div>
          </div>
          <PhaseBadge phase={view.phase} lang={lang} />
          {status !== 'connected' && (
            <span className="hidden text-xs text-amber-700 sm:inline">{t(lang, status === 'connecting' ? 'room.connecting' : 'room.reconnecting')}</span>
          )}
          {sound === 'unset' ? (
            <button type="button" data-testid="enable-sound" className={ui.btnGhost} title={t(lang, 'sound.enable')} onClick={() => setSound('on')}>
              <Icon name="volumeOff" />
              <span className="hidden md:inline">{t(lang, 'sound.enable')}</span>
            </button>
          ) : (
            <button
              type="button"
              data-testid="sound-toggle"
              data-state={sound}
              aria-pressed={sound === 'on'}
              aria-label={soundLabel}
              title={soundLabel}
              className={ui.btnIcon}
              onClick={() => setSound(sound === 'on' ? 'off' : 'on')}
            >
              <Icon name={sound === 'on' ? 'volume' : 'volumeOff'} size={18} />
            </button>
          )}
          {inviteUrl && <InviteMenu url={inviteUrl} lang={lang} />}
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-7xl flex-1 gap-4 p-4 lg:h-[calc(100dvh-3.5rem)] lg:flex-none lg:grid-cols-[minmax(0,1fr)_400px] lg:grid-rows-[minmax(0,1fr)]">
        <section className={`${ui.card} flex min-h-[70vh] flex-col overflow-hidden lg:min-h-0`}>
          <ChatPanel
            view={view}
            lang={lang}
            highlight={highlight}
            actions={{
              onRetry: (id) => void run(() => api(`/api/deals/${dealId}/turns/${id}/retry`, { method: 'POST', token })),
              mediaUrl,
              onListen: (m) => void say(m),
              onDecide: (mid, approve) => void run(() => api<DealView>(`/api/deals/${dealId}/photos/${mid}/decision`, { token, body: { approve } })),
            }}
          />
          {(error || notice) && (
            <div className="space-y-1.5 px-4 pt-2 sm:px-5">
              {error && (
                <p className="flex items-center gap-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800" data-testid="room-error">
                  <Icon name="alert" />
                  {error}
                </p>
              )}
              {notice && (
                <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900" data-testid="speech-notice">
                  {notice}
                </p>
              )}
            </div>
          )}
          <Composer
            lang={lang}
            otherName={other.name}
            messages={view.messages}
            samples={samples}
            photoKind={photoKind}
            onSend={(text) => run(() => api(`/api/deals/${dealId}/turns`, { token, body: { text } }))}
            onVoice={(blob, contentType) => startTurn(() => upload(`/api/deals/${dealId}/turns`, { token, body: blob, contentType }))}
            onSample={(id) => startTurn(() => api(`/api/deals/${dealId}/turns?sample=${encodeURIComponent(id)}`, { method: 'POST', token }))}
            onPhoto={async (kind, jpeg) =>
              (await startTurn(() => upload(`/api/deals/${dealId}/photos?kind=${kind}`, { token, body: jpeg, contentType: jpeg.type || 'image/jpeg' }))) !== null
            }
          />
        </section>

        <aside className="scroll-quiet flex min-h-0 flex-col gap-4 lg:-mr-2 lg:overflow-y-auto lg:pr-2">
          <div className="flex shrink-0 gap-1 rounded-xl bg-stone-200/60 p-1 text-sm" role="tablist">
            {(['deal', 'timeline'] as const).map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={tab === k}
                data-testid={`tab-${k}`}
                onClick={() => setTab(k)}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 font-medium transition-colors ${
                  tab === k ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-600 hover:text-stone-900'
                }`}
              >
                {t(lang, `tab.${k}`)}
                {k === 'timeline' && view.timeline.length > 0 && (
                  <span className="rounded-full bg-stone-100 px-1.5 text-[11px] font-medium text-stone-500">{view.timeline.length}</span>
                )}
              </button>
            ))}
          </div>
          {tab === 'timeline' ? (
            <MoneyTimeline view={view} lang={lang} />
          ) : (
            <>
              <PaymentPanel
                view={view}
                lang={lang}
                onRefresh={() => run(() => api<DealView>(`/api/deals/${dealId}/refresh-payment`, { method: 'POST', token }))}
                onRemind={() => run(() => api(`/api/deals/${dealId}/proposals`, { token, body: { tool: 'send_reminder' } }))}
              />
              <ProposalsPanel
                view={view}
                lang={lang}
                actions={{
                  onApprove: (pid, args) => run(() => api(`/api/deals/${dealId}/proposals/${pid}/approve`, { token, body: args ? { args } : {} })),
                  onReject: (pid) => run(() => api<DealView>(`/api/deals/${dealId}/proposals/${pid}/reject`, { method: 'POST', token })),
                }}
                onProposeTracking={(carrier, trackingNumber) =>
                  run(() => api(`/api/deals/${dealId}/proposals`, { token, body: { tool: 'add_tracking', args: { carrier, trackingNumber } } }))
                }
              />
              <AgreementPanel view={view} lang={lang} onCite={cite}>
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
              </AgreementPanel>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
