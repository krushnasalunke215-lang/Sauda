import { useCallback, useEffect, useRef, useState } from 'react';
import { depositPaid, otherRole, type DealView, type Lang, type Message, type PhotoKind, type SampleInfo } from '../../../shared/types.js';
import { ApiError, api, upload } from '../api.js';
import { sayAloud } from '../audio/speech.js';
import { AgreementPanel } from '../components/AgreementPanel.js';
import { ChatPanel } from '../components/ChatPanel.js';
import { Composer } from '../components/Composer.js';
import { ConfirmCard } from '../components/ConfirmCard.js';
import { CopyButton } from '../components/CopyButton.js';
import { DealProgress } from '../components/DealProgress.js';
import { Icon } from '../components/Icon.js';
import { MoneyTimeline } from '../components/MoneyTimeline.js';
import { PaymentMoment } from '../components/PaymentMoment.js';
import { isSandboxLink, PaymentPanel } from '../components/PaymentPanel.js';
import { ProductionBoard } from '../components/ProductionBoard.js';
import { ProposalsPanel } from '../components/ProposalCard.js';
import { QrImage } from '../components/QrImage.js';
import { QuestionsPanel } from '../components/QuestionsPanel.js';
import { PayBar, YourTurn } from '../components/YourTurn.js';
import { renderError, t } from '../i18n.js';
import { JudgeMode } from '../judge.js';
import { nextAction } from '../nextAction.js';
import { subscribeDeal, type SocketStatus } from '../socket.js';
import { ui, useCloseOnOutside } from '../ui.js';

/** The maker's buyer invite, in a small popover: a QR code to scan and the link with a copy button. */
function InviteMenu({ url, lang, buyer }: { url: string; lang: Lang; buyer: string }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useCloseOnOutside(ref);
  return (
    <details ref={ref} className="relative" data-testid="invite-menu">
      <summary className={`${ui.btnSecondary} ${ui.summary} py-1.5`} title={t(lang, 'room.invite')} aria-label={t(lang, 'room.invite')}>
        <Icon name="userPlus" />
        <span className="hidden md:inline">{t(lang, 'room.invite')}</span>
      </summary>
      <div className={`${ui.menu} absolute right-0 top-full mt-2 w-80 max-w-[calc(100vw-2rem)] p-4`}>
        <div className={ui.title}>{t(lang, 'invite.title', { name: buyer })}</div>
        <p className={`${ui.meta} mt-1 leading-relaxed`}>{t(lang, 'invite.text', { name: buyer })}</p>
        <div className="mt-4 flex justify-center">
          <QrImage url={url} size={168} alt={t(lang, 'invite.qr')} testId="invite-qr" />
        </div>
        <code data-testid="invite-url" className="mt-4 block truncate rounded-lg bg-stone-50 px-2.5 py-1.5 text-xs text-stone-700 ring-1 ring-stone-200">
          {url}
        </code>
        <div className="mt-3">
          <CopyButton primary text={url} label={t(lang, 'invite.copy')} done={t(lang, 'room.copied')} testId="invite-copy" />
        </div>
      </div>
    </details>
  );
}

/** Grey placeholders in the shape of the room while the first snapshot loads. */
function RoomSkeleton() {
  return (
    <div className="flex min-h-dvh flex-col" data-testid="room-loading" aria-busy="true">
      <span className="sr-only">{t('en', 'room.connecting')}</span>
      <div className="h-14 shrink-0 border-b border-stone-200 bg-white">
        <div className="mx-auto flex h-full max-w-7xl items-center gap-4 px-4">
          <div className={`${ui.skeleton} h-5 w-14 rounded-lg`} />
          <div className="space-y-1.5">
            <div className={`${ui.skeleton} h-3.5 w-36 rounded-full`} />
            <div className={`${ui.skeleton} h-2.5 w-24 rounded-full`} />
          </div>
          <div className={`${ui.skeleton} ml-auto hidden h-1.5 w-96 rounded-full lg:block`} />
          <div className={`${ui.skeleton} ml-auto h-9 w-9 rounded-full lg:ml-0`} />
        </div>
      </div>
      <div className="mx-auto grid w-full max-w-7xl flex-1 gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className={`${ui.card} flex min-h-[60vh] flex-col gap-4 p-6`}>
          <div className={`${ui.skeleton} mx-auto h-3 w-56 rounded-full`} />
          <div className={`${ui.skeleton} h-20 w-3/5 rounded-2xl`} />
          <div className={`${ui.skeleton} ml-auto h-24 w-1/2 rounded-2xl`} />
          <div className="mt-auto flex items-end gap-3">
            <div className={`${ui.skeleton} h-14 w-14 rounded-full`} />
            <div className={`${ui.skeleton} h-24 flex-1 rounded-2xl`} />
          </div>
        </div>
        <div className="hidden space-y-4 lg:block">
          <div className={`${ui.skeleton} h-10 rounded-xl`} />
          <div className={`${ui.card} space-y-4 p-5`}>
            <div className={`${ui.skeleton} h-4 w-24 rounded-full`} />
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex gap-3">
                <div className={`${ui.skeleton} h-8 w-8 rounded-lg`} />
                <div className="flex-1 space-y-1.5">
                  <div className={`${ui.skeleton} h-2.5 w-20 rounded-full`} />
                  <div className={`${ui.skeleton} h-3.5 w-4/5 rounded-full`} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Sample English messages for the buyer (judges tap one instead of typing). */
export const BUYER_SAMPLE_TEXTS: readonly string[] = [
  'Hi! I would like a light green chikankari kurta, size medium, 44 inches long, by December 10.',
  'Does the 120 dollars include shipping to Ohio?',
  'Looks great, approved!',
];

const MOBILE_TABS = ['chat', 'agreement', 'pay', 'timeline'] as const;
type MobileTab = (typeof MOBILE_TABS)[number];

/** True below 768 px (Tailwind's md breakpoint). */
function useNarrow(): boolean {
  const query = '(max-width: 767.98px)';
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return narrow;
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

/** `judge` turns on judge mode (technical labels shown), see judge.ts. */
export function Room({ dealId, token, judge = false }: { dealId: string; token: string; judge?: boolean }) {
  const [view, setView] = useState<DealView | null>(null);
  const [status, setStatus] = useState<SocketStatus>('connecting');
  const [highlight, setHighlight] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [samples, setSamples] = useState<SampleInfo[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<'deal' | 'timeline' | 'board'>('deal');
  const [mobileTab, setMobileTab] = useState<MobileTab>('chat');
  const narrow = useNarrow();
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
      .then((all) => setSamples(all.filter((s) => s.role === role)))
      .catch(() => setSamples([]));
  }, [role]);

  const mediaUrl = useCallback((file: string) => `/api/deals/${dealId}/media/${encodeURIComponent(file)}?t=${encodeURIComponent(token)}`, [dealId, token]);

  /** Reads a translation aloud in its speaker's Gemini voice, or a browser voice when that fails or is slow. */
  const say = useCallback(
    async (m: Message) => {
      const tr = m.translation;
      if (!tr?.text) return;
      setNotice(null);
      const url = `/api/deals/${dealId}/messages/${m.id}/tts?t=${encodeURIComponent(token)}`;
      if (!(await sayAloud(url, tr.text, tr.lang).catch(() => false))) {
        setNotice(t(lang, 'speech.noVoice', { lang: t(lang, `langName.${tr.lang}`) }));
      }
    },
    [dealId, token, lang],
  );
  const { sound, setSound } = useAutoPlay(view, say);

  const cite = useCallback((seq: number) => {
    // In the mobile layout the message may be on the chat tab, which renders on the next frame.
    setMobileTab('chat');
    requestAnimationFrame(() => document.getElementById(`msg-${seq}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
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
  if (!view) return <RoomSkeleton />;

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

  // The built-in sample photo for this role (buyer: reference, maker: progress), uploaded like a picked file.
  const samplePhoto = samples.find((s) => s.kind === 'photo');
  const onSamplePhoto =
    samplePhoto && photoKind
      ? async () => {
          const kind = photoKind;
          return (
            (await startTurn(async () => {
              const res = await fetch(`/api/samples/${encodeURIComponent(samplePhoto.id)}/file`);
              if (!res.ok) throw new ApiError(res.status, 'sample_not_found');
              const blob = await res.blob();
              return upload<{ messageId: string }>(`/api/deals/${dealId}/photos?kind=${kind}`, { token, body: blob, contentType: blob.type || 'image/jpeg' });
            })) !== null
          );
        }
      : undefined;
  // Sample English messages for the buyer while the terms are still open.
  const sampleTexts = view.role === 'buyer' && lang === 'en' && !view.invoice ? BUYER_SAMPLE_TEXTS : [];

  const notices = (error || notice) && (
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
  );

  const chat = (
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
  );

  const composer = (
    <Composer
      lang={lang}
      otherName={other.name}
      otherLang={other.lang}
      messages={view.messages}
      rows={view.agreement.rows}
      samples={samples.filter((s) => s.kind === 'voice')}
      photoKind={photoKind}
      sampleTexts={sampleTexts}
      onSamplePhoto={onSamplePhoto}
      onSend={(text) => run(() => api(`/api/deals/${dealId}/turns`, { token, body: { text } }))}
      onVoice={(blob, contentType) => startTurn(() => upload(`/api/deals/${dealId}/turns`, { token, body: blob, contentType }))}
      onSample={(id) => startTurn(() => api(`/api/deals/${dealId}/turns?sample=${encodeURIComponent(id)}`, { method: 'POST', token }))}
      onPhoto={async (kind, jpeg) =>
        (await startTurn(() => upload(`/api/deals/${dealId}/photos?kind=${kind}`, { token, body: jpeg, contentType: jpeg.type || 'image/jpeg' }))) !== null
      }
    />
  );

  const payment = (
    <PaymentPanel
      view={view}
      lang={lang}
      onRefresh={() => run(() => api<DealView>(`/api/deals/${dealId}/refresh-payment`, { method: 'POST', token }))}
      onRemind={() => run(() => api(`/api/deals/${dealId}/proposals`, { token, body: { tool: 'send_reminder' } }))}
    />
  );

  const proposals = (
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
  );

  const agreement = (
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
  );

  // Below 768 px the buyer gets one column with tabs and a sticky composer; the maker keeps the stacked columns.
  const mobile = narrow && view.role === 'buyer';

  // "with {name}": the other name in their role colour.
  const [withBefore, withAfter = ''] = t(lang, 'room.with', { name: '\u0000' }).split('\u0000');
  const action = nextAction(view);
  const yourTurn = <YourTurn view={view} lang={lang} action={action} />;
  // Phone tab dots: only where something is waiting for me.
  const attention: Record<MobileTab, boolean> = {
    chat: action?.kind === 'reviewPhoto',
    agreement: action?.kind === 'confirm' || view.questions.some((q) => q.status === 'open' && q.to === view.role),
    pay: action?.kind === 'payDeposit' || action?.kind === 'payBalance',
    timeline: false,
  };
  const payLink = view.invoice && isSandboxLink(view.invoice.payerUrl) ? view.invoice.payerUrl : null;
  const payBar =
    mobile && payLink && mobileTab !== 'pay' && (action?.kind === 'payDeposit' || action?.kind === 'payBalance') ? (
      <PayBar
        url={payLink}
        label={t(lang, action.kind === 'payDeposit' ? 'pay.payDeposit' : 'pay.payBalance', { amount: `$${(action.cents / 100).toFixed(2)}` })}
      />
    ) : null;
  // The production board is the maker's (FEAT-005).
  const board = tab === 'board' && view.role === 'maker';

  return (
    <JudgeMode.Provider value={judge}>
    <div className="flex min-h-dvh flex-col" data-testid="room" data-role={view.role} data-lang={lang} data-judge={judge ? 'on' : 'off'} data-layout={mobile ? 'tabs' : 'columns'}>
      <div className="sticky top-0 z-20">
      <header className="shrink-0 border-b border-stone-200 bg-white/95 backdrop-blur">
        {/* One row from lg up (the progress bar sits between the names and the buttons); below lg the progress bar is a second row. */}
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 px-4 sm:gap-x-4 lg:h-14 lg:flex-nowrap">
          <div className="flex h-14 min-w-0 flex-1 items-center gap-3 sm:gap-4 lg:max-w-xs">
            <span className="text-base font-bold tracking-tight text-stone-900">{t(lang, 'app.name')}</span>
            <span className="h-6 w-px shrink-0 bg-stone-200" aria-hidden />
            <div className="min-w-0 flex-1 leading-tight">
              <div className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-stone-900">
                <span className="truncate">{me.name}</span>
                <span data-testid="role-chip" className={`${ui.pill} ${ui.role[view.role].chip} shrink-0`}>
                  {t(lang, `role.${view.role}`)}
                </span>
              </div>
              <div className="truncate text-xs text-stone-500">
                {withBefore}
                <span className={`font-medium ${ui.role[otherRole(view.role)].text}`}>{other.name}</span>
                {withAfter}
                {judge && ` · SAUDA-${view.id}`}
              </div>
            </div>
          </div>
          <DealProgress view={view} lang={lang} className="order-last h-10 w-full lg:order-none lg:h-auto lg:w-auto lg:flex-1 lg:px-2" />
          <div className="flex h-14 shrink-0 items-center gap-2">
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
          {inviteUrl && <InviteMenu url={inviteUrl} lang={lang} buyer={view.parties.buyer.name} />}
          </div>
        </div>
      </header>
      {/* The buyer's phone tabs stick with the header. */}
      {mobile && (
          <div className="bg-stone-50 px-3 pt-3">
            <div className="flex gap-1 rounded-xl bg-stone-200/60 p-1 text-sm" role="tablist">
              {MOBILE_TABS.map((k) => (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  aria-selected={mobileTab === k}
                  data-testid={`mobile-tab-${k}`}
                  data-attention={attention[k] ? 'true' : 'false'}
                  onClick={() => setMobileTab(k)}
                  className={`flex min-w-0 flex-1 items-center justify-center gap-1 rounded-lg px-1 py-1.5 font-medium transition-colors ${
                    mobileTab === k ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-600 hover:text-stone-900'
                  }`}
                >
                  <span className="truncate">{t(lang, `mtab.${k}`)}</span>
                  {attention[k] && <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" aria-hidden />}
                </button>
              ))}
            </div>
          </div>
      )}
      </div>

      <PaymentMoment view={view} lang={lang} />

      {mobile ? (
        <>
          <main className="flex flex-1 flex-col gap-3 p-3" data-testid={`mobile-panel-${mobileTab}`}>
            {!payBar && yourTurn}
            {mobileTab === 'chat' && <section className={`${ui.card} flex flex-1 flex-col overflow-hidden`}>{chat}</section>}
            {mobileTab === 'agreement' && agreement}
            {mobileTab === 'pay' &&
              (view.invoice || view.proposals.length > 0 ? (
                <>
                  {payment}
                  {proposals}
                </>
              ) : (
                <p className={`${ui.meta} px-2 py-8 text-center`} data-testid="pay-empty">
                  {t(lang, 'pay.empty')}
                </p>
              ))}
            {mobileTab === 'timeline' && <MoneyTimeline view={view} lang={lang} />}
          </main>
          <div className="sticky bottom-0 z-10 border-t border-stone-200 bg-white" data-testid="mobile-composer">
            {payBar}
            {notices}
            {composer}
          </div>
        </>
      ) : (
        <div
          className={`mx-auto grid w-full max-w-7xl flex-1 gap-4 p-4 lg:h-[calc(100dvh-3.5rem-1px)] lg:flex-none lg:grid-rows-[minmax(0,1fr)] ${
            // The production board needs a wide side panel; the chat narrows while it is open.
            board ? 'lg:grid-cols-[minmax(340px,1fr)_minmax(0,1.6fr)]' : 'lg:grid-cols-[minmax(0,1fr)_400px]'
          }`}
        >
          <section className={`${ui.card} flex min-h-[70vh] flex-col overflow-hidden lg:min-h-0`}>
            {chat}
            {notices}
            {composer}
          </section>

          <aside className="scroll-quiet flex min-h-0 flex-col gap-4 lg:-mr-2 lg:overflow-y-auto lg:pr-2">
            {yourTurn}
            <div className="flex shrink-0 gap-1 rounded-xl bg-stone-200/60 p-1 text-sm" role="tablist">
              {(view.role === 'maker' ? (['deal', 'timeline', 'board'] as const) : (['deal', 'timeline'] as const)).map((k) => (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  aria-selected={tab === k}
                  data-testid={`tab-${k}`}
                  onClick={() => setTab(k)}
                  className={`flex flex-auto items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 font-medium transition-colors ${
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
            {board ? (
              <ProductionBoard view={view} lang={lang} />
            ) : tab === 'timeline' ? (
              <MoneyTimeline view={view} lang={lang} />
            ) : (
              <>
                {payment}
                {proposals}
                {agreement}
              </>
            )}
          </aside>
        </div>
      )}
    </div>
    </JudgeMode.Provider>
  );
}