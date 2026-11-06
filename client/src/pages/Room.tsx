import { useCallback, useEffect, useRef, useState } from 'react';
import { depositPaid, otherRole, type DealView, type Lang, type Message, type PhotoKind, type SampleInfo } from '../../../shared/types.js';
import { ApiError, api, upload } from '../api.js';
import { playUrl, speak } from '../audio/speech.js';
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
          {sound === 'unset' ? (
            <button
              type="button"
              data-testid="enable-sound"
              className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-900 hover:bg-amber-200"
              onClick={() => setSound('on')}
            >
              🔈 {t(lang, 'sound.enable')}
            </button>
          ) : (
            <button
              type="button"
              data-testid="sound-toggle"
              data-state={sound}
              aria-pressed={sound === 'on'}
              className="rounded-full bg-stone-100 px-3 py-1 text-xs text-stone-700 ring-1 ring-stone-300 hover:bg-stone-200"
              onClick={() => setSound(sound === 'on' ? 'off' : 'on')}
            >
              {sound === 'on' ? `🔊 ${t(lang, 'sound.on')}` : `🔇 ${t(lang, 'sound.off')}`}
            </button>
          )}
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
            actions={{
              onRetry: (id) => void run(() => api(`/api/deals/${dealId}/turns/${id}/retry`, { method: 'POST', token })),
              mediaUrl,
              onListen: (m) => void say(m),
              onDecide: (mid, approve) => void run(() => api<DealView>(`/api/deals/${dealId}/photos/${mid}/decision`, { token, body: { approve } })),
            }}
          />
          {error && (
            <p className="px-4 py-1 text-sm text-red-700" data-testid="room-error">
              {error}
            </p>
          )}
          {notice && (
            <p className="px-4 py-1 text-sm text-amber-800" data-testid="speech-notice">
              {notice}
            </p>
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
