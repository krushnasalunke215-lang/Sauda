import { useState } from 'react';
import { otherRole, type DealView, type Lang } from '../../../shared/types.js';
import { t } from '../i18n.js';
import { useJudge } from '../judge.js';
import { ui } from '../ui.js';
import { Icon } from './Icon.js';

/** The confirm footer of the agreement card. The terms themselves are listed just above it. */
export function ConfirmCard({ view, lang, onConfirm }: { view: DealView; lang: Lang; onConfirm: () => Promise<boolean> }) {
  const judge = useJudge();
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
  // Nothing to confirm yet: the empty agreement card stays a single hint.
  if (a.rows.length === 0 && !me && !other) return null;

  return (
    <div className="mt-4 border-t border-stone-100 pt-4" data-testid="confirm-card" data-confirmed={both ? 'both' : me?.current ? 'me' : 'none'}>
      {changed && !both && (
        <p data-testid="confirm-changed" className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
          {t(lang, 'confirm.changed')}
        </p>
      )}
      {both ? (
        <p data-testid="confirm-both" className="flex items-center gap-2 text-sm font-medium text-emerald-800">
          <Icon name="checkCircle" />
          {t(lang, 'confirm.both')}
        </p>
      ) : (
        <>
          {!me?.current && (
            <button
              type="button"
              data-testid="confirm-button"
              disabled={!canConfirm}
              onClick={async () => {
                setBusy(true);
                await onConfirm();
                setBusy(false);
              }}
              className={`${ui.btnPrimary} w-full`}
            >
              {t(lang, 'confirm.button')}
            </button>
          )}
          {/* Who has confirmed, as two chips: "✓ You" and the other side's name. */}
          <div className={`flex flex-wrap items-center gap-1.5 ${me?.current ? '' : 'mt-2.5'}`}>
            {me?.current && (
              <span data-testid="confirm-mine" className={`${ui.pill} ${ui.tone.done}`}>
                <Icon name="check" size={12} />
                {t(lang, 'confirm.you')}
              </span>
            )}
            <span data-testid="confirm-other" data-state={other?.current ? 'confirmed' : 'waiting'} className={`${ui.pill} ${other?.current ? ui.tone.done : ui.tone.quiet}`}>
              {other?.current ? (
                <>
                  <Icon name="check" size={12} />
                  {otherName}
                </>
              ) : (
                t(lang, 'confirm.otherWaiting', { name: otherName })
              )}
            </span>
          </div>
        </>
      )}
      {judge && (
        <p className="mt-3 text-[11px] text-stone-400">
          {t(lang, 'confirm.hash')} <code data-testid="confirm-hash" className="font-mono text-stone-500">{a.hash.slice(0, 12)}</code>
        </p>
      )}
      {a.locked && (
        <p className="mt-1.5 flex items-center gap-1.5 text-xs text-stone-500">
          <Icon name="lock" size={14} />
          {t(lang, 'confirm.locked')}
        </p>
      )}
    </div>
  );
}
