import { useState } from 'react';
import { otherRole, type DealView, type Lang } from '../../../shared/types.js';
import { t } from '../i18n.js';

export function ConfirmCard({ view, lang, onConfirm }: { view: DealView; lang: Lang; onConfirm: () => Promise<boolean> }) {
  const [busy, setBusy] = useState(false);
  const a = view.agreement;
  const me = view.confirmations[view.role];
  const otherSide = otherRole(view.role);
  const other = view.confirmations[otherSide];
  const otherName = view.parties[otherSide].name;
  const notReady = a.missing.length > 0 || a.errors.length > 0;
  const changed = [me, other].some((c) => c && !c.current);
  const both = Boolean(me?.current && other?.current);
  const canConfirm = !a.locked && !notReady && !me?.current && !busy;

  return (
    <section className="rounded-xl border border-stone-200 bg-white p-4" data-testid="confirm-card" data-confirmed={both ? 'both' : me?.current ? 'me' : 'none'}>
      <h2 className="text-sm font-semibold text-stone-600">{t(lang, 'confirm.title')}</h2>
      {a.summary.length > 0 && (
        <ul data-testid="confirm-summary" className="mt-2 space-y-0.5 text-sm">
          {a.summary.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-xs text-stone-500">
        {t(lang, 'confirm.hash')}: <code data-testid="confirm-hash">{a.hash.slice(0, 12)}</code>
      </p>
      {changed && !both && (
        <p data-testid="confirm-changed" className="mt-2 rounded bg-amber-50 p-2 text-xs text-amber-900">
          {t(lang, 'confirm.changed')}
        </p>
      )}
      {both ? (
        <p data-testid="confirm-both" className="mt-3 rounded-lg bg-emerald-50 p-2 text-sm font-medium text-emerald-900">
          ✓ {t(lang, 'confirm.both')}
        </p>
      ) : (
        <>
          <p data-testid="confirm-other" className="mt-2 text-xs text-stone-600">
            {other?.current ? t(lang, 'confirm.otherConfirmed', { name: otherName }) : t(lang, 'confirm.otherWaiting', { name: otherName })}
          </p>
          {me?.current ? (
            <p data-testid="confirm-mine" className="mt-2 text-sm text-emerald-800">
              ✓ {t(lang, 'confirm.youConfirmed')}
            </p>
          ) : (
            <button
              type="button"
              data-testid="confirm-button"
              disabled={!canConfirm}
              onClick={async () => {
                setBusy(true);
                await onConfirm();
                setBusy(false);
              }}
              className="mt-3 w-full rounded-lg bg-emerald-700 px-4 py-2 font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
            >
              {t(lang, 'confirm.button')}
            </button>
          )}
          {notReady && !a.locked && <p className="mt-1 text-xs text-stone-500">{t(lang, 'confirm.notReady')}</p>}
        </>
      )}
      {a.locked && <p className="mt-2 text-xs text-sky-800">{t(lang, 'confirm.locked')}</p>}
    </section>
  );
}
