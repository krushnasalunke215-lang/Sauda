import { useState, type FormEvent } from 'react';
import { LANGS, type CreateDealResult, type Lang } from '../../../shared/types.js';
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
      <a data-testid={`${testId}-open`} href={url} target="_blank" rel="noopener noreferrer" className={`${ui.btnPrimary} px-3 py-1.5 text-xs`}>
        {open}
      </a>
    </div>
  );
}

export function Home() {
  const [makerName, setMakerName] = useState('Asha Chikan Studio');
  const [makerLang, setMakerLang] = useState<Lang>('hi');
  const [buyerName, setBuyerName] = useState('Emily Carter');
  const [buyerLang, setBuyerLang] = useState<Lang>('en');
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
        <p className="mx-auto mt-3 max-w-sm text-base leading-relaxed text-stone-600">{t(UI, 'app.tagline')}</p>
      </header>

      <form onSubmit={submit} className={`${ui.card} mt-10 p-6 sm:p-8`}>
        <h2 className="text-base font-semibold text-stone-900">{t(UI, 'home.title')}</h2>
        <p className="mt-1 text-sm leading-relaxed text-stone-500">{t(UI, 'home.intro')}</p>
        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          <PartyFields title={t(UI, 'role.maker')} name={makerName} lang={makerLang} onName={setMakerName} onLang={setMakerLang} testId="maker" />
          <PartyFields title={t(UI, 'role.buyer')} name={buyerName} lang={buyerLang} onName={setBuyerName} onLang={setBuyerLang} testId="buyer" />
        </div>
        <button data-testid="create-deal" type="submit" disabled={busy} className={`${ui.btnPrimary} mt-8 w-full`}>
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
    </main>
  );
}
