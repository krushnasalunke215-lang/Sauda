import { useEffect, useState } from 'react';
import { CARRIERS, type DealView, type Lang, type Proposal } from '../../../shared/types.js';
import { t, tMaybe } from '../i18n.js';

const usd = (v: unknown) => (typeof v === 'number' ? `$${(v / 100).toFixed(2)}` : '');
const carrierName = (lang: Lang, c: unknown) => (typeof c === 'string' && c ? tMaybe(lang, `carrier.${c}`, {}, c) : '');

const STATUS_STYLE: Record<Proposal['status'], string> = {
  pending: 'bg-amber-100 text-amber-900',
  running: 'bg-sky-100 text-sky-900',
  done: 'bg-emerald-100 text-emerald-900',
  failed: 'bg-red-100 text-red-900',
  rejected: 'bg-stone-200 text-stone-600',
  stale: 'bg-stone-200 text-stone-600',
};

function CarrierSelect({ lang, value, onChange, testId }: { lang: Lang; value: string; onChange: (v: string) => void; testId: string }) {
  return (
    <select data-testid={testId} value={value} onChange={(e) => onChange(e.target.value)} className="rounded border border-stone-300 px-2 py-1 text-sm">
      <option value="">{t(lang, 'tracking.pick')}</option>
      {CARRIERS.map((c) => (
        <option key={c} value={c}>
          {carrierName(lang, c)}
        </option>
      ))}
    </select>
  );
}

export interface ProposalActions {
  onApprove: (id: string, args?: Record<string, unknown>) => Promise<boolean>;
  onReject: (id: string) => Promise<boolean>;
}

/** One agent proposal: the maker approves or rejects it; the buyer sees its state. */
export function ProposalCard({ p, view, lang, actions }: { p: Proposal; view: DealView; lang: Lang; actions: ProposalActions }) {
  const maker = view.role === 'maker';
  const open = p.status === 'pending' || p.status === 'failed';
  const [carrier, setCarrier] = useState(typeof p.args.carrier === 'string' ? p.args.carrier : '');
  const [number, setNumber] = useState(typeof p.args.trackingNumber === 'string' ? p.args.trackingNumber : '');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setCarrier(typeof p.args.carrier === 'string' ? p.args.carrier : '');
    setNumber(typeof p.args.trackingNumber === 'string' ? p.args.trackingNumber : '');
  }, [p.args.carrier, p.args.trackingNumber]);

  const reason = p.reason ? tMaybe(lang, `proposal.reason.${p.reason.code}`, p.reason.params) : '';
  const r = p.result ?? {};
  const editable = maker && open && p.tool === 'add_tracking';

  let args = '';
  if (p.tool === 'create_invoice') args = t(lang, 'proposal.args.create_invoice', { total: usd(p.args.totalCents), deposit: usd(p.args.depositCents) });
  else if (p.tool === 'add_tracking') args = t(lang, 'proposal.args.add_tracking', { carrier: carrierName(lang, p.args.carrier) || t(lang, 'proposal.noCarrier'), number: String(p.args.trackingNumber ?? '') });
  else args = t(lang, 'proposal.args.send_reminder', { due: usd(p.args.dueCents) });

  const act = async (fn: () => Promise<boolean>) => {
    setBusy(true);
    await fn();
    setBusy(false);
  };

  return (
    <div data-testid="proposal" data-tool={p.tool} data-status={p.status} className={`rounded-lg border p-3 ${open ? 'border-amber-300 bg-amber-50/40' : 'border-stone-200'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="text-sm font-semibold">{t(lang, `proposal.tool.${p.tool}`)}</div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLE[p.status]}`}>{t(lang, `proposal.status.${p.status}`)}</span>
      </div>
      {reason && <p className="mt-0.5 text-xs text-stone-500">{reason}</p>}
      {editable ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <CarrierSelect lang={lang} value={carrier} onChange={setCarrier} testId="proposal-carrier" />
          <input
            data-testid="proposal-number"
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            className="w-36 rounded border border-stone-300 px-2 py-1 text-sm"
            aria-label={t(lang, 'tracking.number')}
          />
        </div>
      ) : (
        <p data-testid="proposal-args" className="mt-1 text-sm text-stone-700">
          {args}
        </p>
      )}
      {p.status === 'failed' && p.error && (
        <p data-testid="proposal-error" data-error={p.error} className="mt-2 rounded bg-red-50 p-2 text-xs text-red-800">
          {tMaybe(lang, `proposal.error.${p.error}`, { name: String(r.name ?? ''), message: String(r.message ?? '') }, tMaybe(lang, `error.${p.error}`, {}, p.error))}
          {typeof r.debugId === 'string' && r.debugId && (
            <span className="ml-1 font-mono text-[10px] text-red-700">
              ({t(lang, 'timeline.debug')} {r.debugId})
            </span>
          )}
        </p>
      )}
      {maker && open && (
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            data-testid="proposal-approve"
            disabled={busy || (editable && !carrier)}
            onClick={() => void act(() => actions.onApprove(p.id, editable ? { carrier, trackingNumber: number } : undefined))}
            className="flex-1 rounded-lg bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
          >
            {t(lang, p.status === 'failed' ? 'proposal.retry' : 'proposal.approve')}
          </button>
          <button
            type="button"
            data-testid="proposal-reject"
            disabled={busy}
            onClick={() => void act(() => actions.onReject(p.id))}
            className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm text-stone-700 hover:bg-stone-50 disabled:opacity-50"
          >
            {t(lang, 'proposal.reject')}
          </button>
        </div>
      )}
      {!maker && p.status === 'pending' && (
        <p data-testid="proposal-waiting" className="mt-2 text-xs text-stone-500">
          {t(lang, 'proposal.waiting', { name: view.parties.maker.name })}
        </p>
      )}
    </div>
  );
}

/** The maker's manual tracking form, offered once a payment is in and nothing has shipped. */
function TrackingForm({ lang, onPropose }: { lang: Lang; onPropose: (carrier: string, number: string) => Promise<boolean> }) {
  const [carrier, setCarrier] = useState('');
  const [number, setNumber] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <form
      data-testid="tracking-form"
      className="mt-3 rounded-lg border border-stone-200 p-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        if (await onPropose(carrier, number)) setNumber('');
        setBusy(false);
      }}
    >
      <div className="text-sm font-semibold text-stone-600">{t(lang, 'tracking.title')}</div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <CarrierSelect lang={lang} value={carrier} onChange={setCarrier} testId="tracking-carrier" />
        <input
          data-testid="tracking-number"
          value={number}
          placeholder={t(lang, 'tracking.number')}
          onChange={(e) => setNumber(e.target.value)}
          className="w-36 rounded border border-stone-300 px-2 py-1 text-sm"
        />
        <button
          type="submit"
          data-testid="tracking-submit"
          disabled={busy || !carrier || number.trim().length < 4}
          className="rounded-lg bg-violet-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-800 disabled:opacity-50"
        >
          {t(lang, 'tracking.submit')}
        </button>
      </div>
    </form>
  );
}

const MAX_SHOWN = 6;

export function ProposalsPanel({
  view,
  lang,
  actions,
  onProposeTracking,
}: {
  view: DealView;
  lang: Lang;
  actions: ProposalActions;
  onProposeTracking: (carrier: string, number: string) => Promise<boolean>;
}) {
  const inv = view.invoice;
  const trackingOpen = view.proposals.some((p) => p.tool === 'add_tracking' && (p.status === 'pending' || p.status === 'running'));
  const showForm = view.role === 'maker' && inv !== null && inv.paidCents > 0 && !view.tracking && !trackingOpen && inv.status !== 'CANCELLED';
  if (view.proposals.length === 0 && !showForm) return null;
  const shown = [...view.proposals].reverse().slice(0, MAX_SHOWN);
  return (
    <section className="rounded-xl border border-stone-200 bg-white p-4" data-testid="proposals">
      <h2 className="text-sm font-semibold text-stone-600">{t(lang, 'proposal.title')}</h2>
      <p className="text-[11px] text-stone-500">{t(lang, 'proposal.motto')}</p>
      <div className="mt-2 space-y-2">
        {shown.map((p) => (
          <ProposalCard key={p.id} p={p} view={view} lang={lang} actions={actions} />
        ))}
      </div>
      {showForm && <TrackingForm lang={lang} onPropose={onProposeTracking} />}
    </section>
  );
}
