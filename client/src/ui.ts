import { useEffect, type RefObject } from 'react';

/**
 * Sauda's design tokens as Tailwind class strings (rules in docs/design.md). New UI uses these
 * instead of ad-hoc button and card classes, so every screen looks the same.
 */
export const ui = {
  /** A white surface on the stone-50 page. Pair with p-5. */
  card: 'rounded-2xl bg-white ring-1 ring-stone-200/80',
  /** Section title inside a card. */
  title: 'text-sm font-semibold text-stone-900',
  /** Secondary line under a title, and other quiet text. */
  meta: 'text-xs text-stone-500',
  /** Form field label. */
  label: 'block text-xs font-medium text-stone-500',
  input:
    'block w-full rounded-xl border-0 bg-white px-3 py-2 text-sm text-stone-900 ring-1 ring-stone-200 placeholder:text-stone-400 focus:ring-2 focus:ring-emerald-600 focus:outline-none',
  /** The one main action of a card. */
  btnPrimary:
    'inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:cursor-not-allowed disabled:bg-stone-200 disabled:text-stone-500',
  btnSecondary:
    'inline-flex items-center justify-center gap-2 rounded-xl bg-white px-3.5 py-2 text-sm font-medium text-stone-700 ring-1 ring-stone-200 transition-colors hover:bg-stone-50 hover:text-stone-900 disabled:cursor-not-allowed disabled:opacity-50',
  /** Quiet text action (check now, remind, dismiss). */
  btnGhost:
    'inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-medium text-stone-600 transition-colors hover:bg-stone-100 hover:text-stone-900 disabled:cursor-not-allowed disabled:opacity-50',
  /** Round icon-only button (36 px). Always give it aria-label and title. */
  btnIcon:
    'inline-flex h-9 w-9 items-center justify-center rounded-full text-stone-600 transition-colors hover:bg-stone-100 hover:text-stone-900 disabled:cursor-not-allowed disabled:opacity-40',
  /** Composer tool pill (36 px high). */
  btnTool:
    'inline-flex h-9 cursor-pointer select-none items-center gap-1.5 rounded-full px-3 text-sm font-medium text-stone-600 transition-colors hover:bg-stone-100 hover:text-stone-900 disabled:cursor-not-allowed disabled:opacity-50',
  /** The big round microphone button of the composer (56 px). Add micIdle or micRecording for the colour. */
  btnMic:
    'inline-flex h-14 w-14 shrink-0 select-none items-center justify-center rounded-full text-white shadow-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:cursor-not-allowed disabled:bg-stone-200 disabled:text-stone-400 disabled:shadow-none',
  micIdle: 'bg-emerald-700 hover:bg-emerald-800',
  micRecording: 'bg-red-600 ring-4 ring-red-100 hover:bg-red-700',
  /** The round send button inside the composer (36 px). */
  btnSend:
    'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-700 text-white transition-colors hover:bg-emerald-800 disabled:bg-stone-200 disabled:text-stone-400',
  /** PayPal pay buttons only. */
  btnPayPal:
    'inline-flex w-full items-center justify-center gap-2 rounded-xl bg-paypal px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-paypal-dark',
  /** Small action inside a chat bubble (play original, listen). */
  btnBubble:
    'inline-flex items-center gap-1 rounded-full bg-white/80 px-2 py-0.5 text-[11px] font-medium text-stone-600 ring-1 ring-stone-200 transition-colors hover:bg-white hover:text-stone-900',
  /** Floating menu panel (details/summary popovers). */
  menu: 'z-30 rounded-2xl bg-white p-1.5 shadow-lg ring-1 ring-stone-200',
  menuItem: 'flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-stone-700 hover:bg-stone-50 disabled:opacity-50',
  /** Small tappable chip (sample messages above the composer). */
  chip:
    'inline-flex shrink-0 items-center rounded-full bg-white px-3 py-1 text-xs text-stone-600 ring-1 ring-stone-200 transition-colors hover:bg-stone-50 hover:text-stone-900 disabled:cursor-not-allowed disabled:opacity-50',
  /** Hides the default marker of a <summary>. */
  summary: 'cursor-pointer list-none [&::-webkit-details-marker]:hidden',
  /** A grey placeholder block while something loads. Give it a size (h-*, w-*) and a rounding (rounded-lg, rounded-full, …). */
  skeleton: 'animate-pulse bg-stone-200',
  /** A small status chip or badge. Add one `tone` (or a `role` chip) for its colour. */
  pill: 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
  /** State colours: amber = your action, emerald = done or money in, PayPal blue = pay, sky = ready, red = error or deadline. */
  tone: {
    action: 'bg-amber-100 text-amber-900',
    done: 'bg-emerald-100 text-emerald-800',
    pay: 'bg-paypal/10 text-paypal-dark',
    ready: 'bg-sky-100 text-sky-800',
    error: 'bg-red-100 text-red-800',
    quiet: 'bg-stone-100 text-stone-600',
  },
  /** Role colours, so each side is recognisable at a glance: the maker is green, the buyer indigo. */
  role: {
    maker: { bubble: 'bg-emerald-50', chip: 'bg-emerald-100 text-emerald-800', text: 'text-emerald-700' },
    buyer: { bubble: 'bg-indigo-50', chip: 'bg-indigo-100 text-indigo-800', text: 'text-indigo-700' },
  },
} as const;

/** Closes a <details> popover on a click outside it or on Escape. */
export function useCloseOnOutside(ref: RefObject<HTMLDetailsElement | null>) {
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const el = ref.current;
      if (el?.open && e.target instanceof Node && !el.contains(e.target)) el.open = false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && ref.current?.open) ref.current.open = false;
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [ref]);
}
