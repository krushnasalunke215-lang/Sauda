# Sauda design rules

Sauda's UI is clean and minimal: each screen shows only what the viewer needs for their next step, and the text is organized in a clear order. Every screen and component follows these rules, including later ones (the judge-mode `/demo` page, the mobile buyer layout and the production board).

The code side of the rules is in `client/src/ui.ts` (class tokens), `client/src/components/Icon.tsx` (icons) and `client/src/styles.css` (theme). Reuse them. Do not write ad-hoc button or card classes.

## Principles

1. **One next step per card.** A card has at most one primary (filled) button. Everything else is a secondary, ghost or icon button.
2. **Show the current state; fold the rest.** Finished things shrink: the agreement is three compact lines with the full list behind "Show all details", a locked agreement also folds its questions and confirm footer behind that toggle, done proposals become single lines, and answered questions fold into a "Closed questions (n)" toggle. Empty panels render nothing (no "No open questions" boxes), except the places listed under "Loading and empty states", which get one friendly line.
3. **Viewer's language first.** Each bubble shows the viewer's language in the main text. The other language sits underneath in smaller grey text with a small label. All visible text goes through `t()` with keys in en, hi and es. Never hard-code English in a component.
4. **Technical labels only in judge mode.** The normal maker and buyer views hide model badges, message numbers, citation numbers, hashes and IDs. Judge mode shows them in small `text-stone-400` or mono text (see "Technical details and judge mode" below). Keep every existing `data-testid`.
5. **Colour carries meaning.** Colour marks state only (done, waiting, needs attention, error), not decoration.

## Layout

- Page background `bg-stone-50` (set on `<body>`). Content sits in white cards: `ui.card` (`rounded-2xl bg-white ring-1 ring-stone-200/80`) with `p-5`. No borders inside cards except `divide-stone-100` or `border-stone-100` separators.
- Room: a sticky header with the app name, the viewer's name and role, "with {other}" (plus " · SAUDA-id" in judge mode), the deal progress bar (`DealProgress`), the sound icon button and (maker only) the "Invite buyer" popover. From `lg` up it is one 56 px row (`h-14`) with the progress bar between the names and the buttons; below `lg` the progress bar is a second 40 px row under the names. The buyer's phone tabs sit in the same sticky block, under the header. Below it, from `lg` up, a two-column grid fills the viewport (`minmax(0,1fr) 400px`). The chat card is on the left. The side panel scrolls on its own on the right.
- Side panel order: Deal / Money timeline (/ Production for the maker) tabs, then Payment (once the invoice exists), Agent proposals (when there are any), then Agreement. The questions and the confirm footer live inside the Agreement card.
- Home (`/`): a centred `max-w-4xl` page. The hero (`max-w-2xl`): the title, a one-line pitch (`home-pitch`, `text-lg`/`sm:text-xl` `stone-800`), the problem line under it in `text-sm stone-500`, the one primary button "Try the 2-minute demo" (opens `/demo`, `px-6 py-3 text-base`, play icon) and a `ui.meta` note. Then three illustrated step cards in a `sm:grid-cols-3` grid (Talk in your language, Agree together, Get paid with PayPal): each a `ui.card p-5` with a picture from `components/Illustrations.tsx` on a `bg-stone-50` tile, a small emerald step number, a `ui.title` and a `text-sm stone-600` line. Below, in a `max-w-xl` column: the "Try it in 2 minutes" list, the "Start a real deal" form card, the result links card and the footer.
- Spacing: `gap-4` between cards, `mt-3` or `mt-4` between blocks inside a card, `space-y-4` between chat messages. Max content width `max-w-7xl`.
- Below `lg`, everything stacks in one column. The FEAT-004 mobile buyer layout (tabs under 768 px, sticky composer) keeps these cards and tokens.

## Type

- Font: Noto Sans plus Noto Sans Devanagari (loaded in `client/index.html`). Never make Devanagari smaller than 13 px.
- **Hindi readability.** Devanagari gets one size step and more line height than Latin text at the same class. `styles.css` does it centrally, so components keep the normal classes: on a Hindi page (`<html lang="hi">`, set by the room) `text-[11px]` becomes 13 px, `text-xs` 13 px, `text-[13px]` 14 px and `text-sm` 15 px, with line heights of 1.5 to 1.7 unless a `leading-*` class is set. Chat text carries its own `lang` (from the message's original or translation language) and the `msg-main` / `msg-sub` classes, so Hindi in an English view also grows (main 16 px / 1.8, secondary 14 px / 1.75). Any new element that shows a message's text sets `lang` the same way.
- Page title `text-4xl font-bold tracking-tight` (home only). Card title `ui.title` (`text-sm font-semibold text-stone-900`). Meta text `ui.meta` (`text-xs text-stone-500`). Form label `ui.label`.
- Chat main text `text-[15px] leading-relaxed text-stone-900`. Chat secondary text (the translation or the original under it) `text-[13px] text-stone-600`, with an `text-[11px] text-stone-500` label above it. Do not make translation text lighter than `stone-600`.
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

- Buttons: `ui.btnPrimary` (one per card), `ui.btnSecondary`, `ui.btnGhost` (quiet text actions such as "check now" or "remind"), `ui.btnIcon` (36 px round, needs `aria-label` and `title`), `ui.btnTool` (composer pills), `ui.btnMic` with `ui.micIdle` / `ui.micRecording` (the composer's 56 px microphone, the only one), `ui.btnSend` (the composer's 36 px send button), `ui.btnPayPal` (pay links only), `ui.btnBubble` (small actions inside a bubble). `CopyButton` copies a link (small secondary by default, `primary` when it is the card's main action).
- Inputs: `ui.input` for inputs and selects; `ui.label` above them.
- Popovers: a `<details>` with `ui.summary` on the `<summary>` and `ui.menu` on the panel. Call `useCloseOnOutside(ref)` so a click outside or Escape closes it.
- Status: a small dot (`h-1.5 w-1.5 rounded-full`) or a check circle with a short text, not a coloured pill per field. Status pills (`rounded-full px-2 py-0.5 text-[11px]`) are only for proposal states.
- QR codes: `QrImage` (drawn in the browser with `qrcode`, `rounded-lg ring-1 ring-stone-200`, a `ui.skeleton` square until ready). Used for the buyer's pay link (64 px) and the buyer invite (168 px).
- System events in the chat are centred `text-xs` lines. Milestones (confirmed, invoice created, deposit, balance, paid in full, shipped, photo approved) get `bg-emerald-50` and a check icon. Alerts get `bg-amber-50`.

### Deal progress (`components/DealProgress.tsx`)

- Six named steps in this order: Negotiate, Confirm, Deposit, Making, Balance, Shipped. Each is a `h-1.5 rounded-full` segment with its name under it in `text-xs`: done `bg-emerald-600` / `text-emerald-800`, the current step (the first one not done) `bg-emerald-200` / `font-semibold text-stone-900`, later steps `bg-stone-200` / `text-stone-400`. No icons in the bar.
- A step is done from facts only: Negotiate when every required term is agreed with no errors (or both confirmed), Confirm when both confirmed the current terms (or an invoice exists), Deposit and Balance from the invoice (`depositPaid`, `fullyPaid`), Making when the buyer approved the progress photo (or tracking exists), Shipped when tracking exists. The bar keeps `data-testid="phase"` and `data-phase`; each step has `step-<name>` and `data-state` done|current|todo. Its screen-reader label says "step n of 6"; the phase name is its `title`.
- A new page that shows a deal reuses `DealProgress`; do not add another progress indicator.

### Voice composer (`Composer.tsx`, `PushToTalk.tsx`, `SoundWave.tsx`)

- Voice comes first: the 56 px emerald microphone (`ui.btnMic`) sits left of the input box, for both roles. Hold to talk, or tap once to start and again to stop. While recording it turns red with a stop square, and the textarea is replaced by "Listening…", an `m:ss / 0:30` timer and the live `SoundWave` (40 emerald 3 px bars of the microphone level, newest on the right). The tool row then shows only the stop hint.
- After a voice message is sent, a step line (`voice-stage`) sits at the top of the input box. The steps match what the app really does, so do not add steps the server does not have: Listened (mic recordings only), Sending (upload and the server's `pending`), "Understanding your Hindi, translating to English" with a seconds counter (the server's `interpreting`: one AI call does both, so it is one step), and "Agreement updated (n)" or "No new terms" when the message is `done` (n = agreement rows whose source is this message). A failed clip shows the error in red. Step marks: done = emerald check circle, active = pulsing emerald dot, to do = hollow `stone-300` ring. The line clears 4 s after done.

### Agreement card (`AgreementPanel.tsx`)

- Three grouped lines, in this order: What (item, quantity above 1, size, colour, measurements), Price and deposit (total price in bold, then deposit with its percent and the balance), Delivery ("By <date>", then shipping). Each line: a 32 px `rounded-lg` icon tile (`tag`, `wallet`, `truck`; `bg-emerald-50 text-emerald-700` when filled, `bg-stone-50 text-stone-300` when empty), the group name in `ui.meta`, and the values in `text-sm` (the lead value `font-semibold stone-900`, the rest `stone-700`, joined with " · "). An empty group says "Not agreed yet" in `stone-400`. Test ids: `agreement-line` with `data-group` and `data-filled`.
- The lines changed by the latest message that set a term show a quiet link under them, "from Ravi's message" (or "from your message"), with the message icon; a click scrolls to that message and flashes it like a citation. Judge mode adds `#seq` after it. When a snapshot changes a line, that line plays `term-flash` once.
- "Show all details" (a small ghost button with a chevron in the card's title row, `agreement-expand`) swaps the lines for the full labelled list (`agreement-row`, `agreement-value`, `CiteChip` per term). Both stay in the DOM; the hidden one has `hidden`.

### Payment moment (`PaymentMoment.tsx`)

- When a new `deposit_received`, `balance_received` or `paid_in_full` event arrives, both screens show a centred white card for 5.5 s: a 64 px emerald check circle that draws itself, the title in the viewer's words and language ("Deposit received" for the maker, "Deposit paid" for the buyer), the amount in `text-3xl font-semibold tabular-nums`, and "PayPal confirmed the payment." plus what happens next. It is `pointer-events-none` (nothing under it is blocked) and `role="status"`. Events that were already there when the page opened do not show.

### Invite (`InviteMenu` in `pages/Room.tsx`)

- The maker's "Invite buyer" header button (`userPlus` icon) opens a popover: "Invite {buyer}", one `ui.meta` sentence, a 168 px QR code of the buyer link (`invite-qr`), the link in a `code` box (`invite-url`) and "Copy link" as the popover's one primary button (`invite-copy`).

### Loading and empty states

- Nothing loads into a blank area. While data loads, show `ui.skeleton` blocks in the shape of what comes: the room (`room-loading`: header, two bubbles, the mic and input, the side cards), the production board chunk (`board-loading`: rows of name and bar), QR codes, a message that is being interpreted (a pulsing status line over two skeleton lines) and the `/demo` frames before the deal exists (`demo-loading`).
- Empty states get one friendly line and a next step, not a bare "nothing here": the empty chat shows a message icon in an emerald circle, "Say hello to start the deal", and "Every message is translated into {language} for {name}. Press the mic and speak, or type below." (`chat-empty`). The empty agreement shows its three "Not agreed yet" lines under a one-line hint. The timeline and the phone Pay tab keep their one-line hints.

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

- Sizes: 16 px (the default) next to `text-sm` (buttons, ghost buttons, tool pills, `text-sm` status lines); 14 px next to `text-xs` lines (status lines, source links, legends, chevrons on text toggles, which turn 180° when open); 12 px inside bubble buttons, pills and menu play marks; 18 px only for the round icon buttons (sound, send); 26 px for the microphone. Checks inside a filled state circle (payment milestones, board marks) are sized to the circle.
- The same meaning always uses the same icon: `checkCircle` done or received, `clock` waiting, `lock` locked until a payment, `alert` error or warning, `message` the message a term came from, `truck` delivery and shipping, `userPlus` inviting the buyer, `mic` / `stop` recording.
- Illustrations (home only) live in `components/Illustrations.tsx`: 120 × 80 SVGs in the same stroke style, `stone-300` outlines on `stone-100`/white fills with `emerald-600` for done and money. No words inside them (letters such as अ and A are fine).

## Motion

Small, purposeful motion only:

- `transition-colors` on buttons and on the progress-bar segments, and the payment progress-bar width.
- `animate-pulse` for "interpreting…" text, skeleton blocks, the recording dot and the active voice step.
- `animate-spin` on the refresh icon while checking.
- The amber `cite-flash` when a citation or a "from Ravi's message" link is clicked.
- The live `SoundWave` bars while recording.
- `term-flash` (2.4 s emerald glow, once) on an agreement line that a message just changed.
- `pay-moment` (rise in, hold, fade out over 5.5 s) and `pay-moment-check` (the check draws itself in 0.5 s) for the payment moment.

All keyframes live in `styles.css` and switch off under `prefers-reduced-motion`. No other animation.

## Checklist for new UI (FEAT-004 judge mode and mobile, FEAT-005 production board, the UI polish)

- Built from `ui.*` tokens, `Icon` and the colours above; no new hues, no emoji icons.
- One primary button per card; finished or empty states fold away or render nothing.
- Every string in en, hi and es; check Hindi at 390 px width for wrapping.
- Technical labels (model, latency, `#seq`, hashes, ids, debug IDs) render only when `useJudge()` is true; text containing them has a `.plain` twin.
- `/demo`: two room iframes in judge mode (`&judge=1`) on `bg-stone-50`, each in a `rounded-2xl ring-1 ring-stone-200` frame with a small `ui.meta` caption (Maker · हिंदी, Buyer · English) above it, and "Start over" as a `ui.btnSecondary` in a slim header. They stack below `lg`.
- Production board: a white `ui.card`. Row states use the same language as the payment milestones: done = emerald check circle, ready = hollow emerald ring, locked = `Icon name="lock"` in `stone-400` with the row text in `stone-400`. Bars are `bg-emerald-600` (done) or `bg-emerald-200` (ready) or `bg-stone-200` (locked). Gates are diamonds in the same colours. The deadline is a thin `red-500` line. The order row reads "<item> · <buyer name>"; `SAUDA-<id>` appears only in judge mode. Keep the `board-row-<key>` test ids and `data-state`.
- Production board card: the title and the one-line subtitle on the left, the state legend (done, ready, locked, drawn with the same marks) on the right; a `board-loading` skeleton while the board chunk loads.
- Voice, agreement, payment and progress UI follow the sections above; a new screen that shows a deal reuses `DealProgress`, `PaymentMoment` and `QrImage` rather than drawing its own.
- Check every screen on a laptop (1440 × 900) and a phone (390 × 844) for both roles, and in Hindi as well as English.
- Before asking the user to look, take a screenshot and check it against this file.
