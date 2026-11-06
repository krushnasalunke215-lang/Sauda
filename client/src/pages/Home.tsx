import { useState, type FormEvent } from 'react';
import { LANGS, type CreateDealResult, type Lang } from '../../../shared/types.js';
import { ApiError, api } from '../api.js';
import { CopyButton } from '../components/CopyButton.js';
import { t } from '../i18n.js';

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
    <fieldset className="rounded-xl border border-stone-200 bg-white p-4">
      <legend className="px-1 text-sm font-semibold text-stone-700">{props.title}</legend>
      <label className="block text-sm text-stone-600">
        {t(UI, 'home.name')}
        <input
          data-testid={`${props.testId}-name`}
          className="mt-1 block w-full rounded-lg border border-stone-300 px-3 py-2 text-stone-900"
          value={props.name}
          maxLength={60}
          required
          onChange={(e) => props.onName(e.target.value)}
        />
      </label>
      <label className="mt-3 block text-sm text-stone-600">
        {t(UI, 'home.language')}
        <select
          data-testid={`${props.testId}-lang`}
          className="mt-1 block w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-stone-900"
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
    <div className="rounded-xl border border-stone-200 bg-white p-4">
      <div className="text-sm font-semibold text-stone-700">{label}</div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <code data-testid={`${testId}-url`} className="min-w-0 flex-1 truncate rounded bg-stone-100 px-2 py-1 text-xs">
          {url}
        </code>
        <CopyButton text={url} label={t(UI, 'home.copy')} done={t(UI, 'home.copied')} />
        <a
          data-testid={`${testId}-open`}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-lg bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-800"
        >
          {open}
        </a>
      </div>
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
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-3xl font-bold tracking-tight">
        {t(UI, 'app.name')} <span className="text-emerald-700">सौदा</span>
      </h1>
      <p className="mt-2 text-stone-600">{t(UI, 'app.tagline')}</p>

      <h2 className="mt-8 text-lg font-semibold">{t(UI, 'home.title')}</h2>
      <p className="text-sm text-stone-600">{t(UI, 'home.intro')}</p>
      <form onSubmit={submit} className="mt-4 grid gap-4 sm:grid-cols-2">
        <PartyFields title={t(UI, 'role.maker')} name={makerName} lang={makerLang} onName={setMakerName} onLang={setMakerLang} testId="maker" />
        <PartyFields title={t(UI, 'role.buyer')} name={buyerName} lang={buyerLang} onName={setBuyerName} onLang={setBuyerLang} testId="buyer" />
        <div className="sm:col-span-2">
          <button
            data-testid="create-deal"
            type="submit"
            disabled={busy}
            className="rounded-lg bg-emerald-700 px-4 py-2 font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
          >
            {busy ? t(UI, 'home.creating') : t(UI, 'home.create')}
          </button>
          {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
        </div>
      </form>

      {result && (
        <section className="mt-8 grid gap-3" data-testid="deal-links">
          <LinkRow label={t(UI, 'home.makerLink')} url={abs(result.maker.url)} open={t(UI, 'home.openMaker')} testId="maker" />
          <LinkRow label={t(UI, 'home.buyerLink')} url={abs(result.buyer.url)} open={t(UI, 'home.openBuyer')} testId="buyer" />
        </section>
      )}
    </main>
  );
}
