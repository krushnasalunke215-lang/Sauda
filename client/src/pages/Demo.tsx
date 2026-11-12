import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { CreateDealResult, Lang, Role } from '../../../shared/types.js';
import { ApiError, api } from '../api.js';
import { Icon } from '../components/Icon.js';
import { renderError, t } from '../i18n.js';
import { ui } from '../ui.js';
import { DEMO_DEAL } from './Home.js';

const UI: Lang = 'en';

/** The room path for an iframe: same origin as this page, in judge mode (technical labels shown). */
function judgeUrl(url: string): string {
  const u = new URL(url, window.location.origin);
  u.searchParams.set('judge', '1');
  return `${u.pathname}${u.search}`;
}

/** Each room renders at least this wide, so it keeps its desktop layout (agreement beside the chat) in half a screen. */
const ROOM_WIDTH = 1100;
/** Smaller than this and the text gets hard to read; the room then gets less width and its own narrower layout. */
const MIN_SCALE = 0.62;

/**
 * Side by side (lg and up), a half is often narrower than the room's desktop layout (1024 px): at
 * 1600 px the agreement dropped under the chat and the composer was cut off. So the room renders at
 * ROOM_WIDTH and is scaled down to fit, like a browser zoom, and fills the half's full height.
 */
function ScaledFrame({ children }: { children: (style: CSSProperties | undefined) => ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const split = typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches;
  let style: CSSProperties | undefined;
  if (split && size && size.w > 0 && size.w < ROOM_WIDTH) {
    const width = Math.max(size.w, Math.min(ROOM_WIDTH, size.w / MIN_SCALE));
    const scale = size.w / width;
    style = { width, height: size.h / scale, transform: `scale(${scale})`, transformOrigin: '0 0' };
  }
  return (
    <div ref={box} className="h-[85dvh] overflow-hidden rounded-2xl bg-white ring-1 ring-stone-200 lg:h-auto lg:min-h-0 lg:flex-1">
      {children(style)}
    </div>
  );
}

/**
 * Judge mode: a fresh deal with the default parties, the maker on the left and the buyer on the
 * right, both real rooms in iframes. "Start over" opens a new deal.
 */
export function Demo() {
  const [deal, setDeal] = useState<CreateDealResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  const start = useCallback(async () => {
    setBusy(true);
    setError(null);
    setDeal(null);
    try {
      setDeal(await api<CreateDealResult>('/api/deals', { body: DEMO_DEAL }));
    } catch (e) {
      setError(renderError(UI, e instanceof ApiError ? e.code : undefined));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    // Once per page load (StrictMode runs effects twice in development).
    if (started.current) return;
    started.current = true;
    void start();
  }, [start]);

  const frames: { role: Role; lang: Lang }[] = [
    { role: 'maker', lang: DEMO_DEAL.makerLang },
    { role: 'buyer', lang: DEMO_DEAL.buyerLang },
  ];

  return (
    <div className="flex min-h-dvh flex-col lg:h-dvh" data-testid="demo">
      <header className="h-14 shrink-0 border-b border-stone-200 bg-white/95">
        <div className="flex h-full items-center gap-3 px-4">
          <a href="/" className="text-base font-bold tracking-tight text-stone-900">
            {t(UI, 'app.name')}
          </a>
          <span className="h-6 w-px bg-stone-200" aria-hidden />
          <span className="min-w-0 flex-1">
            <span data-testid="demo-judge" title={t(UI, 'demo.title')} className={`${ui.pill} ${ui.tone.quiet}`}>
              {t(UI, 'demo.judge')}
            </span>
          </span>
          <button type="button" data-testid="demo-restart" className={ui.btnSecondary} disabled={busy} onClick={() => void start()}>
            <Icon name="refresh" className={busy ? 'animate-spin' : undefined} />
            {t(UI, 'demo.restart')}
          </button>
        </div>
      </header>

      {error && (
        <p className="mx-4 mt-4 flex items-center gap-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800" data-testid="demo-error">
          <Icon name="alert" />
          {error}
        </p>
      )}

      <main className="grid flex-1 gap-4 p-4 lg:min-h-0 lg:grid-cols-2">
        {frames.map(({ role, lang }) => (
          <section key={role} className="flex min-h-0 flex-col">
            <div className="mb-1.5 px-1">
              <span data-testid={`demo-caption-${role}`} className={`${ui.pill} ${ui.role[role].chip}`}>
                {t(UI, `role.${role}`)} · <span lang={lang}>{t(lang, `langName.${lang}`)}</span>
              </span>
            </div>
            <ScaledFrame>
              {(style) =>
              deal ? (
                <iframe
                  key={deal.id}
                  data-testid={`demo-${role}`}
                  title={`${t(UI, `role.${role}`)} · ${t(lang, `langName.${lang}`)}`}
                  src={judgeUrl(deal[role].url)}
                  allow="microphone; autoplay"
                  className="block h-full w-full"
                  style={style}
                />
              ) : (
                <div className="flex h-full min-h-80 flex-col gap-4 p-5" data-testid="demo-loading" aria-busy="true">
                  <div className={`${ui.skeleton} h-8 w-1/2 rounded-lg`} />
                  <div className={`${ui.skeleton} h-1.5 w-full rounded-full`} />
                  <div className={`${ui.skeleton} h-16 w-3/5 rounded-2xl`} />
                  <div className={`${ui.skeleton} ml-auto h-20 w-1/2 rounded-2xl`} />
                  <p className={`${ui.meta} mt-auto text-center`}>{error ? '' : t(UI, 'demo.starting')}</p>
                </div>
              )
              }
            </ScaledFrame>
          </section>
        ))}
      </main>
    </div>
  );
}
