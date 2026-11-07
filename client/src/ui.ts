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
  /** PayPal pay buttons only. */
  btnPayPal:
    'inline-flex w-full items-center justify-center gap-2 rounded-xl bg-paypal px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-paypal-dark',
  /** Small action inside a chat bubble (play original, listen). */
  btnBubble:
    'inline-flex items-center gap-1 rounded-full bg-white/80 px-2 py-0.5 text-[11px] font-medium text-stone-600 ring-1 ring-stone-200 transition-colors hover:bg-white hover:text-stone-900',
  /** Floating menu panel (details/summary popovers). */
  menu: 'z-30 rounded-2xl bg-white p-1.5 shadow-lg ring-1 ring-stone-200',
  menuItem: 'flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-stone-700 hover:bg-stone-50 disabled:opacity-50',
  /** Hides the default marker of a <summary>. */
  summary: 'cursor-pointer list-none [&::-webkit-details-marker]:hidden',
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
