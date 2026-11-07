# Sauda design rules

Sauda's UI is clean and minimal: each screen shows only what the viewer needs for their next step, and the text is organized in a clear order. Every screen and component follows these rules, including later ones (the judge-mode `/demo` page, the mobile buyer layout and the production board).

The code side of the rules is in `client/src/ui.ts` (class tokens), `client/src/components/Icon.tsx` (icons) and `client/src/styles.css` (theme). Reuse them. Do not write ad-hoc button or card classes.

## Principles

1. **One next step per card.** A card has at most one primary (filled) button. Everything else is a secondary, ghost or icon button.
2. **Show the current state; fold the rest.** Finished things shrink: a locked agreement folds into a one-line card, done proposals become single lines, and answered questions fold into a "Closed questions (n)" toggle. Empty panels render nothing (no "No open questions" boxes).
3. **Viewer's language first.** Each bubble shows the viewer's language in the main text. The other language sits underneath in smaller grey text with a small label. All visible text goes through `t()` with keys in en, hi and es. Never hard-code English in a component.
4. **Technical labels only in judge mode.** The normal maker and buyer views hide model badges, message numbers, citation numbers, hashes and IDs. Judge mode shows them in small `text-stone-400` or mono text (see "Technical details and judge mode" below). Keep every existing `data-testid`.
5. **Colour carries meaning.** Colour marks state only (done, waiting, needs attention, error), not decoration.

## Layout

- Page background `bg-stone-50` (set on `<body>`). Content sits in white cards: `ui.card` (`rounded-2xl bg-white ring-1 ring-stone-200/80`) with `p-5`. No borders inside cards except `divide-stone-100` or `border-stone-100` separators.
- Room: a 56 px sticky header (`h-14`) with the app name, the viewer's name and role, "with {other}" (plus " · SAUDA-id" in judge mode), the phase badge, the sound icon button and (maker only) the invite-link popover. Below it, from `lg` up, a two-column grid fills the viewport (`minmax(0,1fr) 400px`). The chat card is on the left. The side panel scrolls on its own on the right.
- Side panel order: Deal / Money timeline tabs, then Payment (once the invoice exists), Agent proposals (when there are any), then Agreement. The questions and the confirm footer live inside the Agreement card.
- Home (`/`): a centred `max-w-xl` column with the title, a one-line tagline and one form card. The result links appear in a second card.
- Spacing: `gap-4` between cards, `mt-3` or `mt-4` between blocks inside a card, `space-y-4` between chat messages. Max content width `max-w-7xl`.
- Below `lg`, everything stacks in one column. The FEAT-004 mobile buyer layout (tabs under 768 px, sticky composer) keeps these cards and tokens.

## Type

- Font: Noto Sans plus Noto Sans Devanagari (loaded in `client/index.html`). Never make Devanagari smaller than 13 px.
- Page title `text-4xl font-bold tracking-tight` (home only). Card title `ui.title` (`text-sm font-semibold text-stone-900`). Meta text `ui.meta` (`text-xs text-stone-500`). Form label `ui.label`.
- Chat main text `text-[15px] leading-relaxed text-stone-900`. Chat secondary text `text-[13px] text-stone-500`, with an `text-[11px] text-stone-400` label above it.
- Money: `text-xl font-semibold tracking-tight tabular-nums`. Use the `$x.xx` format the panels already use.
- Use sentence case. Do not use all-caps labels.

## Colour

| Meaning | Classes |
|---|---|
| Text | `stone-900` main, `stone-600`/`stone-500` secondary, `stone-400` quiet |
| Primary action, done, money received | `emerald-700` buttons, `emerald-600` dots and bars, `emerald-50` soft background |
| Waiting for you, warning | `amber-50` background with `amber-800`/`amber-900` text |
| Error | `red-50` background with `red-700`/`red-800` text |
| PayPal pay buttons only | `bg-paypal` / `hover:bg-paypal-dark` (`#0070ba` / `#005ea6`, defined in `styles.css`) |
| Running on PayPal | `sky-50` / `sky-800` |
| Shipping, webhooks (timeline dots only) | `violet-400` / `violet-600` |

Do not introduce new hues. Bubbles: your own messages are `bg-emerald-50` (right-aligned, `rounded-br-md`); the other side's are `bg-stone-100` (left-aligned, `rounded-bl-md`).

## Components and tokens (`client/src/ui.ts`)

- Buttons: `ui.btnPrimary` (one per card), `ui.btnSecondary`, `ui.btnGhost` (quiet text actions such as "check now" or "remind"), `ui.btnIcon` (36 px round, needs `aria-label` and `title`), `ui.btnTool` (composer pills), `ui.btnPayPal` (pay links only), `ui.btnBubble` (small actions inside a bubble).
- Inputs: `ui.input` for inputs and selects; `ui.label` above them.
- Popovers: a `<details>` with `ui.summary` on the `<summary>` and `ui.menu` on the panel. Call `useCloseOnOutside(ref)` so a click outside or Escape closes it.
- Status: a small dot (`h-1.5 w-1.5 rounded-full`) or a check circle with a short text, not a coloured pill per field. Status pills (`rounded-full px-2 py-0.5 text-[11px]`) are only for proposal states.
- The phase badge in the header shows five segments (confirm, invoice, deposit, balance, ship) plus the phase name. A new page that shows a deal reuses `PhaseBadge` from `pages/Room.tsx` instead of inventing another one.
- System events in the chat are centred `text-xs` lines. Milestones (confirmed, invoice created, deposit, balance, paid in full, shipped, photo approved) get `bg-emerald-50` and a check icon. Alerts get `bg-amber-50`.

## Technical details and judge mode

The user's rule: hide technical labels from the normal maker and buyer views, keep the data, and show the labels again in judge mode.

- **The flag.** Judge mode is on when the room URL has `judge=1` (`/r/:id?t=TOKEN&judge=1`). `App.tsx` reads it and `Room` puts it in the `JudgeMode` React context (`client/src/judge.ts`). Components read it with `useJudge()`. The room root has `data-judge="on|off"`. The DealView data does not change, only what is drawn.
- **Hidden in the normal view, shown in judge mode:** the model and latency on chat bubbles (`model-badge`, for example "Flash 4.8 s"), message numbers (`#3`) on bubbles, citation numbers on agreement rows and questions, the hash in system events ("…agreement (a87671f50eef…)") and in proposal reasons, the agreement fingerprint line in the confirm footer (`confirm-hash`), the `SAUDA-<id>` deal id in the room header, and PayPal debug IDs on failed proposal cards.
- **Text that contains a hash or a message number** gets a `.plain` twin key in en, hi and es (for example `event.agreement_confirmed.plain`). `tView(lang, key, params, judge)` and `renderEvent(…, judge)` choose the twin outside judge mode. A new string with a hash, id or `#seq` needs a `.plain` twin too.
- **The source link stays.** Outside judge mode, `CiteChip` is a small message icon (`Icon name="message"`, `stone-300`, amber on hover) with the title "Show the message this came from". A click still scrolls to the source message and flashes it. In judge mode it shows `#seq`. Keep the `citation` test id and `data-seq` in both modes.
- **Still shown in the normal view** because they are business information, not technical labels: the PayPal invoice number, amounts, tracking carrier and number, and the "sample clip" tag. The Money timeline tab is the opt-in technical log, so it keeps its methods, paths, HTTP statuses and debug IDs in both modes.
- **FEAT-004 `/demo`** loads both iframes with `&judge=1`. A "Technical details" switch in the `/demo` header (a `ui.btnSecondary` with `aria-pressed`) may reload the iframes with or without `judge=1`. The normal maker and buyer links never set it.
- E2E specs that assert technical labels open the rooms with `openRoles(browser, deal, {}, { judge: true })` (`e2e/helpers.ts`), as `room.spec.ts` does.

## Icons

Use `<Icon name=… />` from `components/Icon.tsx` (24 px line icons, 1.75 stroke, `currentColor`, size 14-18). Do not use emoji as icons in the UI. If an icon is missing, add a path to `Icon.tsx` in the same style. Icon-only buttons need `aria-label` and `title` in the viewer's language.

## Motion

Only the existing small transitions: `transition-colors` on buttons, the progress-bar width, `animate-pulse` for "interpreting…" text and the recording dot, `animate-spin` on the refresh icon while checking, and the amber `cite-flash` when a citation is clicked. No other animation.

## Checklist for new UI (FEAT-004 judge mode and mobile, FEAT-005 production board)

- Built from `ui.*` tokens, `Icon` and the colours above; no new hues, no emoji icons.
- One primary button per card; finished or empty states fold away or render nothing.
- Every string in en, hi and es; check Hindi at 390 px width for wrapping.
- Technical labels (model, latency, `#seq`, hashes, ids, debug IDs) render only when `useJudge()` is true; text containing them has a `.plain` twin.
- `/demo`: two room iframes in judge mode (`&judge=1`) on `bg-stone-50`, each in a `rounded-2xl ring-1 ring-stone-200` frame with a small `ui.meta` caption (Maker · हिंदी, Buyer · English) above it, and "Start over" as a `ui.btnSecondary` in a slim header. They stack below `lg`.
- Production board: a white `ui.card`. Row states use the same language as the payment milestones: done = emerald check circle, ready = hollow emerald ring, locked = `Icon name="lock"` in `stone-400` with the row text in `stone-400`. Bars are `bg-emerald-600` (done) or `bg-emerald-200` (ready) or `bg-stone-200` (locked). Gates are diamonds in the same colours. The deadline is a thin `red-500` line. The order row reads "<item> · <buyer name>"; `SAUDA-<id>` appears only in judge mode. Keep the `board-row-<key>` test ids and `data-state`.
- Before asking the user to look, take a screenshot and check it against this file.
