import { useEffect, useState } from 'react';
import { CARRIERS, type DealView, type Lang, type Proposal } from '../../../shared/types.js';
import { t, tMaybe } from '../i18n.js';
import { ui } from '../ui.js';
import { Icon } from './Icon.js';

const usd = (v: unknown) => (typeof v === 'number' ? `$${(v / 100).toFixed(2)}` : '');
const carrierName = (lang: Lang, c: unknown) => (typeof c === 'string' && c ? tMaybe(lang, `carrier.${c}`, {}, c) : '');

const STATUS_STYLE: Record<Proposal['status'], string> = {
  pending: 'bg-amber-50 text-amber-800',
  running: 'bg-sky-50 text-sky-800',
  done: 'text-emerald-700',
  failed: 'bg-red-50 text-red-700',
  rejected: 'text-stone-400',
  stale: 'text-stone-400',
};

/** Open cards need attention; finished ones shrink to a single line. */
const isOpen = (p: Proposal) => p.status === 'pending' || p.status === 'running' || p.status === 'failed';

function CarrierSelect({ lang, value, onChange, testId }: { lang: Lang; value: string; onChange: (v: string) => void; testId: string }) {
  return (
    <select data-testid={testId} value={value} onChange={(e) => onChange(e.target.value)} className={`${ui.input} w-auto flex-1 py-1.5`} aria-label={t(lang, 'tracking.carrier')}>
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

/** A finished proposal (done, rejected or out of date) as one quiet line. */
function ProposalLine({ p, lang }: { p: Proposal; lang: Lang }) {
  return (
    <li data-testid="proposal" data-tool={p.tool} data-status={p.status} className="flex items-center gap-2 py-2 text-sm">
      <Icon name={p.status === 'done' ? 'checkCircle' : 'x'} size={15} className={p.status === 'done' ? 'text-emerald-600' : 'text-stone-300'} />
      <span className={`flex-1 truncate ${p.status === 'done' ? 'text-stone-700' : 'text-stone-400 line-through decoration-stone-300'}`}>{t(lang, `proposal.tool.${p.tool}`)}</span>
      <span className={`text-xs ${STATUS_STYLE[p.status]}`}>{t(lang, `proposal.status.${p.status}`)}</span>
    </li>
  );
}

/** One open agent proposal: the maker approves or rejects it; the buyer sees its state. */
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
    <li data-testid="proposal" data-tool={p.tool} data-status={p.status} className="rounded-xl bg-stone-50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="text-sm font-semibold text-stone-900">{t(lang, `proposal.tool.${p.tool}`)}</div>
        <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLE[p.status]}`}>
          {p.status === 'running' && <Icon name="refresh" size={11} className="animate-spin" />}
          {t(lang, `proposal.status.${p.status}`)}
        </span>
      </div>
      {editable ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <CarrierSelect lang={lang} value={carrier} onChange={setCarrier} testId="proposal-carrier" />
          <input
            data-testid="proposal-number"
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            className={`${ui.input} w-36 py-1.5`}
            aria-label={t(lang, 'tracking.number')}
          />
        </div>
      ) : (
        <p data-testid="proposal-args" className="mt-1.5 text-sm leading-relaxed text-stone-600">
          {args}
        </p>
      )}
      {reason && <p className="mt-1.5 text-xs text-stone-400">{reason}</p>}
      {p.status === 'failed' && p.error && (
        <p data-testid="proposal-error" data-error={p.error} className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-800">
          {tMaybe(lang, `proposal.error.${p.error}`, { name: String(r.name ?? ''), message: String(r.message ?? '') }, tMaybe(lang, `error.${p.error}`, {}, p.error))}
          {typeof r.debugId === 'string' && r.debugId && (
            <span className="ml-1 font-mono text-[10px] text-red-700">
              ({t(lang, 'timeline.debug')} {r.debugId})
            </span>
          )}
        </p>
      )}
      {maker && open && (
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            data-testid="proposal-approve"
            disabled={busy || (editable && !carrier)}
            onClick={() => void act(() => actions.onApprove(p.id, editable ? { carrier, trackingNumber: number } : undefined))}
            className={`${ui.btnPrimary} flex-1 py-2`}
          >
            {t(lang, p.status === 'failed' ? 'proposal.retry' : 'proposal.approve')}
          </button>
          <button type="button" data-testid="proposal-reject" disabled={busy} onClick={() => void act(() => actions.onReject(p.id))} className={`${ui.btnSecondary} py-2`}>
            {t(lang, 'proposal.reject')}
          </button>
        </div>
      )}
      {!maker && p.status === 'pending' && (
        <p data-testid="proposal-waiting" className="mt-3 flex items-center gap-1.5 text-xs text-stone-500">
          <Icon name="clock" size={14} />
          {t(lang, 'proposal.waiting', { name: view.parties.maker.name })}
        </p>
      )}
    </li>
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
      className="mt-3 border-t border-stone-100 pt-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        if (await onPropose(carrier, number)) setNumber('');
        setBusy(false);
      }}
    >
      <div className="flex items-center gap-1.5 text-xs font-medium text-stone-500">
        <Icon name="truck" size={14} />
        {t(lang, 'tracking.title')}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <CarrierSelect lang={lang} value={carrier} onChange={setCarrier} testId="tracking-carrier" />
        <input
          data-testid="tracking-number"
          value={number}
          placeholder={t(lang, 'tracking.number')}
          onChange={(e) => setNumber(e.target.value)}
          className={`${ui.input} w-36 py-1.5`}
        />
        <button type="submit" data-testid="tracking-submit" disabled={busy || !carrier || number.trim().length < 4} className={`${ui.btnSecondary} py-1.5`}>
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
  const openCards = shown.filter(isOpen);
  const finished = shown.filter((p) => !isOpen(p));
  return (
    <section className={`${ui.card} p-5`} data-testid="proposals">
      <h2 className={ui.title}>{t(lang, 'proposal.title')}</h2>
      {openCards.length > 0 && <p className={`${ui.meta} mt-0.5`}>{t(lang, 'proposal.motto')}</p>}
      {openCards.length > 0 && (
        <ul className="mt-3 space-y-2">
          {openCards.map((p) => (
            <ProposalCard key={p.id} p={p} view={view} lang={lang} actions={actions} />
          ))}
        </ul>
      )}
      {finished.length > 0 && (
        <ul className={`divide-y divide-stone-100 ${openCards.length > 0 ? 'mt-2' : 'mt-1'}`}>
          {finished.map((p) => (
            <ProposalLine key={p.id} p={p} lang={lang} />
          ))}
        </ul>
      )}
      {showForm && <TrackingForm lang={lang} onPropose={onProposeTracking} />}
    </section>
  );
}
