import { useState, type FormEvent } from 'react';
import { LANGS, type CreateDealInput, type CreateDealResult, type Lang } from '../../../shared/types.js';
import { ApiError, api } from '../api.js';
import { CopyButton } from '../components/CopyButton.js';
import { Icon } from '../components/Icon.js';
import { t } from '../i18n.js';
import { ui } from '../ui.js';

const UI: Lang = 'en';

function PartyFields(props: {
  title: string;
  name: string;
  lang: Lang;
  onName: (v: string) => void;
  onLang: (v: Lang) => void;
  testId: string;
}) {
  return (
    <fieldset className="space-y-3">
      <legend className="mb-3 text-sm font-semibold text-stone-900">{props.title}</legend>
      <label className="block">
        <span className={ui.label}>{t(UI, 'home.name')}</span>
        <input
          data-testid={`${props.testId}-name`}
          className={`${ui.input} mt-1`}
          value={props.name}
          maxLength={60}
          required
          onChange={(e) => props.onName(e.target.value)}
        />
      </label>
      <label className="block">
        <span className={ui.label}>{t(UI, 'home.language')}</span>
        <select
          data-testid={`${props.testId}-lang`}
          className={`${ui.input} mt-1`}
          value={props.lang}
          onChange={(e) => props.onLang(e.target.value as Lang)}
        >
          {LANGS.map((l) => (
            <option key={l} value={l}>
              {t(UI, `lang.${l}`)}
            </option>
          ))}
        </select>
      </label>
    </fieldset>
  );
}

function LinkRow({ label, url, open, testId }: { label: string; url: string; open: string; testId: string }) {
  return (
    <div className="flex flex-wrap items-center gap-3 p-4 sm:flex-nowrap">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-stone-900">{label}</div>
        <code data-testid={`${testId}-url`} className="mt-0.5 block truncate text-xs text-stone-500">
          {url}
        </code>
      </div>
      <CopyButton text={url} label={t(UI, 'home.copy')} done={t(UI, 'home.copied')} />
      <a data-testid={`${testId}-open`} href={url} target="_blank" rel="noopener noreferrer" className={`${ui.btnSecondary} px-3 py-1.5 text-xs`}>
        {open}
      </a>
    </div>
  );
}

/** The default parties, used by the form and by the /demo split screen. */
export const DEMO_DEAL: CreateDealInput = { makerName: 'Ravi Chikan', makerLang: 'hi', buyerName: 'Emily Carter', buyerLang: 'en' };

const STEPS = ['home.step1', 'home.step2', 'home.step3', 'home.step4', 'home.step5'] as const;

export function Home() {
  const [makerName, setMakerName] = useState(DEMO_DEAL.makerName);
  const [makerLang, setMakerLang] = useState<Lang>(DEMO_DEAL.makerLang);
  const [buyerName, setBuyerName] = useState(DEMO_DEAL.buyerName);
  const [buyerLang, setBuyerLang] = useState<Lang>(DEMO_DEAL.buyerLang);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CreateDealResult | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (makerLang === buyerLang) return setError(t(UI, 'home.sameLanguage'));
    setBusy(true);
    setError(null);
    try {
      setResult(await api<CreateDealResult>('/api/deals', { body: { makerName, makerLang, buyerName, buyerLang } }));
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'same_language' ? t(UI, 'home.sameLanguage') : t(UI, 'error.generic'));
    } finally {
      setBusy(false);
    }
  }

  const abs = (u: string) => new URL(u, window.location.origin).href;

  return (
    <main className="mx-auto max-w-xl px-4 py-16 sm:py-24">
      <header className="text-center">
        <h1 className="text-4xl font-bold tracking-tight text-stone-900">
          {t(UI, 'app.name')} <span className="text-emerald-700">सौदा</span>
        </h1>
        <p data-testid="home-problem" className="mx-auto mt-3 max-w-md text-base leading-relaxed text-stone-600">
          {t(UI, 'home.problem')}
        </p>
        <a data-testid="try-demo" href="/demo" className={`${ui.btnPrimary} mt-8`}>
          {t(UI, 'home.tryDemo')}
        </a>
      </header>

      <form onSubmit={submit} className={`${ui.card} mt-10 p-6 sm:p-8`}>
        <h2 className="text-base font-semibold text-stone-900">{t(UI, 'home.title')}</h2>
        <p className="mt-1 text-sm leading-relaxed text-stone-500">{t(UI, 'home.intro')}</p>
        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          <PartyFields title={t(UI, 'role.maker')} name={makerName} lang={makerLang} onName={setMakerName} onLang={setMakerLang} testId="maker" />
          <PartyFields title={t(UI, 'role.buyer')} name={buyerName} lang={buyerLang} onName={setBuyerName} onLang={setBuyerLang} testId="buyer" />
        </div>
        <button data-testid="create-deal" type="submit" disabled={busy} className={`${ui.btnSecondary} mt-8 w-full`}>
          {busy ? t(UI, 'home.creating') : t(UI, 'home.create')}
        </button>
        {error && (
          <p className="mt-3 flex items-center gap-2 text-sm text-red-700">
            <Icon name="alert" />
            {error}
          </p>
        )}
      </form>

      {result && (
        <section className={`${ui.card} mt-4 divide-y divide-stone-100`} data-testid="deal-links">
          <LinkRow label={t(UI, 'home.makerLink')} url={abs(result.maker.url)} open={t(UI, 'home.openMaker')} testId="maker" />
          <LinkRow label={t(UI, 'home.buyerLink')} url={abs(result.buyer.url)} open={t(UI, 'home.openBuyer')} testId="buyer" />
        </section>
      )}

      <section className="mt-10 px-1" data-testid="home-steps">
        <h2 className={ui.title}>{t(UI, 'home.stepsTitle')}</h2>
        <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-stone-600">
          {STEPS.map((k) => (
            <li key={k}>{t(UI, k)}</li>
          ))}
        </ol>
      </section>

      <footer className={`${ui.meta} mt-12 text-center`} data-testid="home-footer">
        {t(UI, 'home.footer')}
      </footer>
    </main>
  );
}
