# Sauda design rules

Sauda's UI is clean and minimal: each screen shows only what the viewer needs for their next step, and the text is organized in a clear order. Every screen and component follows these rules, including later ones (the judge-mode `/demo` page, the mobile buyer layout and the production board).

The code side of the rules is in `client/src/ui.ts` (class tokens), `client/src/components/Icon.tsx` (icons) and `client/src/styles.css` (theme). Reuse them. Do not write ad-hoc button or card classes.

## Principles

1. **One next step per card.** A card has at most one primary (filled) button. Everything else is a secondary, ghost or icon button.
2. **Show the current state; fold the rest.** Finished things shrink: the agreement is three compact lines with the full list behind "Show all details", a locked agreement also folds its questions and confirm footer behind that toggle, done proposals become single lines, and answered questions fold into a "Closed questions (n)" toggle. Empty panels render nothing (no "No open questions" boxes), except the places listed under "Loading and empty states", which get one friendly line.
3. **Viewer's language first.** Each bubble shows the viewer's own language on top as the main text, darker and heavier than the rest. The other language sits underneath in smaller, lighter text with its language tag. All visible text goes through `t()` with keys in every language on the final list (see "Languages"). Never hard-code English in a component.
4. **Technical labels only in judge mode.** The normal maker and buyer views hide model badges, message numbers, citation numbers, hashes and IDs. Judge mode shows them in small `text-stone-400` or mono text (see "Technical details and judge mode" below). Keep every existing `data-testid`.
5. **Colour says who and what state.** The palette is PayPal's (see "Colour"): PayPal blue marks the main actions (primary buttons, the mic, send). Two role colours tell the sides apart: the maker is PayPal blue, the buyer PayPal lilac (bubbles, name chips, the "with {name}" link, the `/demo` captions). State colours mark what needs doing: amber = your action, emerald = done or money in, PayPal Left Blue = pay, sky = ready, red = error or deadline. No other use of colour.
6. **Highlight the next step, cut the rest.** The "Your turn" line names the one next action; chips and tiles replace sentences where a word or an amount says it.

## Layout

- Page background `bg-stone-50` (set on `<body>`). Content sits in white cards: `ui.card` (`rounded-2xl bg-white ring-1 ring-stone-200/80`) with `p-5`. No borders inside cards except `divide-stone-100` or `border-stone-100` separators.
- Room: a sticky header with the app name, the viewer's name and role, "with {other}" (plus " · SAUDA-id" in judge mode), the deal progress bar (`DealProgress`), the sound icon button and (maker only) the "Invite buyer" popover. From `lg` up it is one 56 px row (`h-14`) with the progress bar between the names and the buttons; below `lg` the progress bar is a second 40 px row under the names. The buyer's phone tabs sit in the same sticky block, under the header. Below it, from `lg` up, a two-column grid fills the viewport (`minmax(0,1fr) 400px`). The chat card is on the left. The side panel scrolls on its own on the right.
- Side panel order: Deal / Money timeline (/ Production for the maker) tabs, then Payment (once the invoice exists), Agent proposals (when there are any), then Agreement. The questions and the confirm footer live inside the Agreement card.
- Side panel top: the "Your turn" line (`YourTurn`) sits above the tab list. On the buyer's phone it sits at the top of the main area instead, and is hidden while the pay bar shows.
- Home (`/`): a centred `max-w-4xl` page. The hero band (`rounded-3xl bg-gradient-to-br from-brand/10 via-white to-lilac/20 ring-1 ring-brand/15`, the two role colours): the title, a one-line pitch (`home-pitch`, `text-lg`/`sm:text-xl` `stone-800`), the one primary button "Try the 2-minute demo" (opens `/demo`, `px-6 py-3 text-base`, play icon) and a row of language chips (`home-langs`, one `home-lang` per `LANGS` entry, each in its own script from `LANG_ENDONYMS`, with `lang` set). No problem paragraph and no note under the button. Then three illustrated step cards in a `sm:grid-cols-3` grid (Talk in your language, Agree together, Get paid with PayPal): each a `ui.card p-5` with a picture from `components/Illustrations.tsx` on a `bg-stone-50` tile, a small blue step number (`bg-brand/10 text-brand-dark`), a `ui.title` and one short `text-sm stone-600` line. Below, in a `max-w-xl` column: the 3-step "Try it in 2 minutes" list, the "Start a real deal" form card, the result links card and the footer.
- `/demo` (`pages/Demo.tsx`): a slim header with the app name, a "Judge mode" pill (`demo-judge`, `ui.pill ui.tone.quiet`, its title is the longer description) and "Start over" (`ui.btnSecondary`). Below, from `lg` up, the maker and buyer rooms side by side, each under a caption pill in its role colour (`demo-caption-maker` "Maker · हिंदी", `demo-caption-buyer` "Buyer · English", `ui.pill ui.role[role].chip`) and in a `rounded-2xl ring-1 ring-stone-200` frame. The header is 48 px (`h-12`) and the halves sit in `p-3 gap-3`, so the rooms get as much of the screen as possible.
- **Rooms in the split screen (the `split` layout).** `main.tsx` sets `data-frame="split"` on `<html>` when a page runs inside an iframe, and the `split:` variant (`styles.css`) applies from 640 to 1023 px in that case. With it the room keeps its two columns at half-screen widths: the chat beside a 340 px side panel (`split:grid-cols-[minmax(0,1fr)_340px]`, `p-3 gap-3`), the header in its two-row form (names, then the progress bar), the grid filling the rest of the height (`100dvh - 6rem`), the agreement's Delivery tile on its own row under Price and Deposit, the payment tile amounts at `text-lg`, and no buyer phone tabs above 640 px. From 1024 px the normal desktop layout applies. `ScaledFrame` renders each iframe at least 740 px wide (`ROOM_WIDTH`) and scales it down only when the half is narrower, never below 0.85 (`MIN_SCALE`). On the 1366 × 768 recording screen (full screen, 100% zoom) each half is 665 px, so the room is at 0.9 scale: chat text about 13.5 px, the agreement, the "Your turn" line, the payment card and the mic in view. From 1536 px wide the rooms are unscaled. Below `lg` the halves stack, unscaled.
- Spacing: `gap-4` between cards, `mt-3` or `mt-4` between blocks inside a card, `space-y-4` between chat messages. Max content width `max-w-7xl`.
- Below `lg`, everything stacks in one column. The FEAT-004 mobile buyer layout (tabs under 768 px, sticky composer) keeps these cards and tokens.

## Type

- Font: Noto Sans plus Noto Sans Devanagari and Noto Sans JP (`wght@400..700`, loaded in `client/index.html`). Latin text (en, es, fr, pt, de) uses Noto Sans. Never make Devanagari or Japanese smaller than 13 px.
- **Japanese.** `styles.css` puts Noto Sans JP in the font stack by `:lang(ja)` (in `@layer base`), so any element with `lang="ja"` (a chat text, a home chip) gets Japanese glyph forms, also inside an English page. Kanji share code points with Chinese (Han unification), so the `lang` attribute is what picks the Japanese forms; set it on every element that shows a message's text. On a Japanese page (`<html lang="ja">`) the `--font-sans` token itself changes, so the Bryntum board follows, and `text-[11px]` and `text-xs` grow to 13 px, as do the board's `.sauda-state` and `.sauda-waiting` chips. Chinese and Korean are not on the list, so there are no SC/KR fonts and no Korean `keep-all` rule; adding them means a Noto Sans SC/KR link, a `:lang()` stack and the same 13 px rule.
- **Hindi readability.** Devanagari gets one size step and more line height than Latin text at the same class. `styles.css` does it centrally, so components keep the normal classes: on a Hindi page (`<html lang="hi">`, set by the room) `text-[11px]` becomes 13 px, `text-xs` 13 px, `text-[13px]` 14 px and `text-sm` 15 px, with line heights of 1.5 to 1.7 unless a `leading-*` class is set. Chat text carries its own `lang` (from the message's original or translation language) and the `msg-main` / `msg-sub` classes, so Hindi in an English view also grows (main 16 px / 1.8, secondary 14 px / 1.75). Any new element that shows a message's text sets `lang` the same way.
- Page title `text-4xl font-bold tracking-tight` (home only). Card title `ui.title` (`text-sm font-semibold text-stone-900`). Meta text `ui.meta` (`text-xs text-stone-500`). Form label `ui.label`.
- Chat main text (the viewer's own language, on top on both sides) `text-[15px] font-medium leading-relaxed text-stone-950`. Chat secondary text (the other language under it, after a `border-black/5` rule) `text-[13px] text-stone-500`, led on the same line by its language tag: the uppercase code from `langCode()` (HI, EN, JA, FR …) in `text-[11px] font-semibold text-stone-400` (`message-sub-lang`), whose `title` says "Translated for {name}" or "Original". Both languages stay visible.
- Money: `text-xl font-semibold tracking-tight tabular-nums` (the payment tiles: `text-xl`, `sm:text-2xl`). Use the `$x.xx` format the panels already use; prices stay USD in every language.
- Use sentence case. The bubble language tags are the only all-caps text.

## Colour

Sauda uses PayPal's colour palette, taken from PayPal's own [Brand Identity Quick Guide (2022)](https://filecache.mediaroom.com/mr5mr_paypal/184713/download/PP_Brand%20Guidelines_Newsroom_2022.pdf), which PayPal publishes on its newsroom's [Media Resources](https://newsroom.paypal-corp.com/media-resources) page. The values are the guide's HEX codes; they live in `styles.css` (`@theme`):

| Token | PayPal name | HEX | Used for |
|---|---|---|---|
| `brand` | Right Blue | `#0070E0` | primary buttons, the mic, send, focus rings, the maker |
| `brand-dark` | Left Blue | `#003087` | button hover, the maker's chip text, home chips |
| `paypal` | Left Blue | `#003087` | pay buttons (`ui.btnPayPal`), the pay chip tint |
| `paypal-dark` | Middle Blue | `#001C64` | pay button hover, the pay chip text |
| `lilac` | Lilac 50 | `#A18EF0` | the buyer's tints (bubble, chip, home gradient) |

Tints are these values at an opacity (`bg-brand/8`, `bg-lilac/14`), not new hex values. PayPal's palette has no green, amber or red, so the state colours (done and money in, your action, error) stay Tailwind's emerald, amber and red: they must stay distinct from the blues. Lilac 50 is too light for text (about 2.6:1 on white), so the buyer's text stays `indigo-700`/`indigo-800`. Contrast: white on `brand` is 4.8:1 and on `paypal` 11.8:1; `brand-dark` on `bg-brand/12` about 9.6:1. PayPal Gold (`#FFD140`) is not used, so no Sauda button looks like a PayPal checkout button.

**Not PayPal branding.** Sauda only borrows the colours. It never shows the PayPal logo, monogram or wordmark, and nothing says or suggests that Sauda is a PayPal product: PayPal is named only as the payment provider (the pay links, the invoice, "PayPal confirmed the payment"). The hackathon rules forbid third-party trademarks in the video.

| Meaning | Classes |
|---|---|
| Text | `stone-950`/`stone-900` main, `stone-600`/`stone-500` secondary, `stone-400` quiet |
| Primary actions | `bg-brand` / `hover:bg-brand-dark` (`ui.btnPrimary`, `ui.micIdle`, `ui.btnSend`), `ring-brand` focus, `bg-brand` sound-wave bars and active voice step |
| Maker (role) | `ui.role.maker`: bubble `bg-brand/8`, chip `bg-brand/12 text-brand-dark`, text `text-brand` |
| Buyer (role) | `ui.role.buyer`: bubble `bg-lilac/14`, chip `bg-lilac/25 text-indigo-800`, text `text-indigo-700` |
| Your action | `ui.tone.action` (`bg-amber-100 text-amber-900`); callouts `amber-50`/`amber-100` with an amber ring; dots `amber-500` |
| Done, money in | `ui.tone.done` (`bg-emerald-100 text-emerald-800`); `emerald-600` dots and bars, `emerald-50` tiles |
| Pay | `ui.tone.pay` (`bg-paypal/10 text-paypal-dark`); pay buttons `ui.btnPayPal` (`bg-paypal` / `hover:bg-paypal-dark`) |
| Ready (board) | `ui.tone.ready` (`bg-sky-100 text-sky-800`); bars `sky-200`, ring `sky-600` |
| Error or deadline | `ui.tone.error` (`bg-red-100 text-red-800`); `red-50` boxes with `red-700`/`red-800` text; the board deadline `red-500` |
| Quiet, waiting for the other side, locked | `ui.tone.quiet` (`bg-stone-100 text-stone-600`) |
| Shipping, webhooks (timeline dots only) | `violet-400` / `violet-600` |

These are all the hues. A new one needs a meaning in this table first. Bubbles take the speaker's role colour (`ui.role[from].bubble`); alignment says whose they are: your own on the right (`rounded-br-md`), the other side's on the left (`rounded-bl-md`).

## Components and tokens (`client/src/ui.ts`)

- Buttons: `ui.btnPrimary` (one per card), `ui.btnSecondary`, `ui.btnGhost` (quiet text actions such as "check now" or "remind"), `ui.btnIcon` (36 px round, needs `aria-label` and `title`), `ui.btnTool` (composer pills), `ui.btnMic` with `ui.micIdle` / `ui.micRecording` (the composer's 56 px microphone, the only one), `ui.btnSend` (the composer's 36 px send button), `ui.btnPayPal` (pay links only), `ui.btnBubble` (small actions inside a bubble). `CopyButton` copies a link (small secondary by default, `primary` when it is the card's main action).
- Inputs: `ui.input` for inputs and selects; `ui.label` above them.
- Popovers: a `<details>` with `ui.summary` on the `<summary>` and `ui.menu` on the panel. Call `useCloseOnOutside(ref)` so a click outside or Escape closes it.
- Status: `ui.pill` plus one `ui.tone.*` (or a `ui.role[role].chip`) is the one chip style. Use it for proposal states, chat events, the confirm status, the payment badge, the "Still needed" fields, the board row states and the role chip in the room header. Elsewhere a small dot or a check circle with a short text is enough.
- QR codes: `QrImage` (drawn in the browser with `qrcode`, `rounded-lg ring-1 ring-stone-200`, a `ui.skeleton` square until ready). Used for the buyer's pay link (64 px) and the buyer invite (168 px).
- System events in the chat are centred `rounded-full` chips (`text-xs font-medium`, a 14 px icon, the short `event.*` text such as "Emily Carter confirmed" or "Deposit received $36.00"). The tone comes from `EVENT_CHIP` in `ChatPanel.tsx`: done for confirmations, payments received, photo approved and shipped; pay for the invoice and reminders; action for changed terms and requested photo changes; error for a cancelled invoice or changed invoice text; quiet for the deal opening.

### Your turn (`components/YourTurn.tsx`, `client/src/nextAction.ts`)

- `nextAction(view)` derives the one next step from the deal view only; it never changes PayPal or money state. `YourTurn` draws it as a line, never a button, so no card gets a second filled button: my action = amber (`ui.tone.action`, `ring-amber-200`, an `amber-500` dot, "Your turn · {action}"); the other side's move = quiet `bg-stone-100` with a clock icon, "Waiting for {name}"; nothing = no line. Test id `your-turn` with `data-action`.

| State | Maker | Buyer |
|---|---|---|
| Cancelled, terms missing or with errors, locked, paid in full | nothing | nothing |
| No invoice, I have not confirmed | `confirm` | `confirm` |
| No invoice, the other side has not confirmed | `waiting` | `waiting` |
| Both confirmed, the invoice proposal is pending or failed | `approveInvoice` | `waiting` (maker) |
| Invoice, deposit not paid | `waiting` | `payDeposit` (amount) |
| Deposit paid, no progress photo waiting | `sendPhoto` | `waiting` |
| A progress photo waits for a decision | `waiting` | `reviewPhoto` (once interpreted) |
| Photo approved, balance due | `waiting` | `payBalance` (amount) |

- Phone tabs (buyer under 768 px) carry an amber dot (`data-attention="true"`) where an action waits: Agreement for `confirm` or an open question to me, Pay for `payDeposit`/`payBalance`, Chat for `reviewPhoto`.

### Payment card (`PaymentPanel.tsx`) and the phone pay bar

- Title row: "Payment" and the status badge (`pay-badge`, `data-state` invoiced | deposit_paid | balance_due | paid; tones pay, done, action, done; none when cancelled).
- Three tiles (`invoice-paid` emerald, `invoice-due` amber while something is due, `invoice-total` stone), each a short label and the amount alone.
- The pay link (`ui.btnPayPal`) names the amount: "Pay $36.00 deposit", "Pay $84.00 balance". The private-window tip sits behind an info icon button (`pay-tip`, a `<details>` popover with `useCloseOnOutside`).
- On the buyer's phone, while the next action is `payDeposit` or `payBalance` and the Pay tab is not open, `PayBar` (`pay-bar`, the same `ui.btnPayPal` link with the amount, `target="_blank" rel="noopener noreferrer"`) sticks above the composer. The link must pass `isSandboxLink`.

### Deal progress (`components/DealProgress.tsx`)

- Six named steps in this order: Negotiate, Confirm, Deposit, Making, Balance, Shipped. Each is a `h-1.5 rounded-full` segment with its name under it in `text-xs`: done `bg-emerald-600` / `text-emerald-800`, the current step (the first one not done) `bg-emerald-200` / `font-semibold text-stone-900`, later steps `bg-stone-200` / `text-stone-400`. No icons in the bar.
- A step is done from facts only: Negotiate when every required term is agreed with no errors (or both confirmed), Confirm when both confirmed the current terms (or an invoice exists), Deposit and Balance from the invoice (`depositPaid`, `fullyPaid`), Making when the buyer approved the progress photo (or tracking exists), Shipped when tracking exists. The bar keeps `data-testid="phase"` and `data-phase`; each step has `step-<name>` and `data-state` done|current|todo. Its screen-reader label says "step n of 6"; the phase name is its `title`.
- A new page that shows a deal reuses `DealProgress`; do not add another progress indicator.

### Voice composer (`Composer.tsx`, `PushToTalk.tsx`, `SoundWave.tsx`)

- Voice comes first: the 56 px PayPal-blue microphone (`ui.btnMic`) sits left of the input box, for both roles. Hold to talk, or tap once to start and again to stop. While recording it turns red with a stop square, and the textarea is replaced by "Listening…", an `m:ss / 0:30` timer and the live `SoundWave` (40 blue 3 px bars of the microphone level, newest on the right). The tool row then shows only the stop hint.
- After a voice message is sent, a step line (`voice-stage`) sits at the top of the input box. The steps match what the app really does, so do not add steps the server does not have: Listened (mic recordings only), Sending (upload and the server's `pending`), "Understanding your Hindi, translating to English" with a seconds counter (the server's `interpreting`: one AI call does both, so it is one step), and "Agreement updated (n)" or "No new terms" when the message is `done` (n = agreement rows whose source is this message). A failed clip shows the error in red. Step marks: done = emerald check circle, active = pulsing blue (`brand`) dot, to do = hollow `stone-300` ring. The line clears 4 s after done.

### Agreement card (`AgreementPanel.tsx`)

- The What line first (item, quantity above 1, size, colour, measurements): a 32 px `rounded-lg` `tag` icon tile (`bg-emerald-50 text-emerald-700` when filled, `bg-stone-50 text-stone-300` when empty), the group name in `ui.meta`, the values in `text-sm` (the lead value `font-semibold stone-900`, the rest `stone-700`, joined with " · "). Under it a `grid-cols-3` row of tiles: the money group (`col-span-2`) holds the Price and Deposit tiles (deposit with its percent and the balance as a note), the delivery group holds the Delivery tile (the date, then shipping). A filled tile is `bg-emerald-50 ring-1 ring-emerald-100` with the value in `text-lg font-semibold text-emerald-900`; an empty one is `bg-stone-50` with "Not agreed yet" in `stone-400`. Test ids: `agreement-line` with `data-group` and `data-filled` on the What line and on the two groups.
- Missing terms: "Still needed" followed by one amber chip per field (`agreement-missing`, `agreement-missing-field` with `data-field`).
- Open questions (`QuestionsPanel.tsx`) are amber callouts with a `help` icon: `bg-amber-100 ring-amber-300` and a bold "For you to answer" when the answer is mine, `bg-amber-50 ring-amber-100` when it is the other side's.
- Confirm status (`ConfirmCard.tsx`): chips, not sentences. `confirm-mine` = a done chip with a check and "You"; `confirm-other` = the other party's full name, a done chip with a check once they confirmed, else a quiet "{name} · waiting" chip (`data-state` confirmed | waiting).
- The lines changed by the latest message that set a term show a quiet link under them, "from Ravi's message" (or "from your message"), with the message icon; a click scrolls to that message and flashes it like a citation. Judge mode adds `#seq` after it. When a snapshot changes a line, that line plays `term-flash` once.
- "Show all details" (a small ghost button with a chevron in the card's title row, `agreement-expand`) swaps the lines for the full labelled list (`agreement-row`, `agreement-value`, `CiteChip` per term). Both stay in the DOM; the hidden one has `hidden`.

### Payment moment (`PaymentMoment.tsx`)

- When a new `deposit_received`, `balance_received` or `paid_in_full` event arrives, both screens show a centred white card for 5.5 s: a 64 px emerald check circle that draws itself, the title in the viewer's words and language ("Deposit received" for the maker, "Deposit paid" for the buyer), the amount in `text-3xl font-semibold tabular-nums`, and "PayPal confirmed the payment." plus what happens next. It is `pointer-events-none` (nothing under it is blocked) and `role="status"`. Events that were already there when the page opened do not show.

### Invite (`InviteMenu` in `pages/Room.tsx`)

- The maker's "Invite buyer" header button (`userPlus` icon) opens a popover: "Invite {buyer}", one `ui.meta` sentence, a 168 px QR code of the buyer link (`invite-qr`), the link in a `code` box (`invite-url`) and "Copy link" as the popover's one primary button (`invite-copy`).

### Loading and empty states

- Nothing loads into a blank area. While data loads, show `ui.skeleton` blocks in the shape of what comes: the room (`room-loading`: header, two bubbles, the mic and input, the side cards), the production board chunk (`board-loading`: rows of name and bar), QR codes, a message that is being interpreted (a pulsing status line over two skeleton lines) and the `/demo` frames before the deal exists (`demo-loading`).
- Empty states get one friendly line and a next step, not a bare "nothing here": the empty chat shows a message icon in a light blue (`bg-brand/10`) circle, "Say hello to start the deal", and "Every message is translated into {language} for {name}. Press the mic and speak, or type below." (`chat-empty`). The empty agreement shows its three "Not agreed yet" lines under a one-line hint. The timeline and the phone Pay tab keep their one-line hints.

## Technical details and judge mode

The user's rule: hide technical labels from the normal maker and buyer views, keep the data, and show the labels again in judge mode.

- **The flag.** Judge mode is on when the room URL has `judge=1` (`/r/:id?t=TOKEN&judge=1`). `App.tsx` reads it and `Room` puts it in the `JudgeMode` React context (`client/src/judge.ts`). Components read it with `useJudge()`. The room root has `data-judge="on|off"`. The DealView data does not change, only what is drawn.
- **Hidden in the normal view, shown in judge mode:** the model and latency on chat bubbles (`model-badge`, for example "Flash 4.8 s"), message numbers (`#3`) on bubbles, citation numbers on agreement rows and questions, the hash in system events ("…agreement (a87671f50eef…)") and in proposal reasons, the agreement fingerprint line in the confirm footer (`confirm-hash`), the `SAUDA-<id>` deal id in the room header, and PayPal debug IDs on failed proposal cards.
- **Text that contains a hash or a message number** gets a `.plain` twin key in every language (for example `event.agreement_confirmed.plain`). `tView(lang, key, params, judge)` and `renderEvent(…, judge)` choose the twin outside judge mode. A new string with a hash, id or `#seq` needs a `.plain` twin too.
- **The source link stays.** Outside judge mode, `CiteChip` is a small message icon (`Icon name="message"`, `stone-300`, amber on hover) with the title "Show the message this came from". A click still scrolls to the source message and flashes it. In judge mode it shows `#seq`. Keep the `citation` test id and `data-seq` in both modes.
- **Still shown in the normal view** because they are business information, not technical labels: the PayPal invoice number, amounts, tracking carrier and number, and the "sample clip" tag. The Money timeline tab is the opt-in technical log, so it keeps its methods, paths, HTTP statuses and debug IDs in both modes.
- **FEAT-004 `/demo`** loads both iframes with `&judge=1`. A "Technical details" switch in the `/demo` header (a `ui.btnSecondary` with `aria-pressed`) may reload the iframes with or without `judge=1`. The normal maker and buyer links never set it.
- E2E specs that assert technical labels open the rooms with `openRoles(browser, deal, {}, { judge: true })` (`e2e/helpers.ts`), as `room.spec.ts` does.

## Icons

Use `<Icon name=… />` from `components/Icon.tsx` (24 px line icons, 1.75 stroke, `currentColor`, size 14-18). Do not use emoji as icons in the UI. If an icon is missing, add a path to `Icon.tsx` in the same style. Icon-only buttons need `aria-label` and `title` in the viewer's language.

- Sizes: 16 px (the default) next to `text-sm` (buttons, ghost buttons, tool pills, `text-sm` status lines); 14 px next to `text-xs` lines (status lines, source links, legends, chevrons on text toggles, which turn 180° when open); 12 px inside bubble buttons, pills and menu play marks; 18 px only for the round icon buttons (sound, send); 26 px for the microphone. Checks inside a filled state circle (payment milestones, board marks) are sized to the circle.
- The same meaning always uses the same icon: `checkCircle` done or received, `clock` waiting, `lock` locked until a payment, `alert` error or warning, `message` the message a term came from, `truck` delivery and shipping, `userPlus` inviting the buyer, `mic` / `stop` recording.
- Illustrations (home only) live in `components/Illustrations.tsx`: 120 × 80 SVGs in the same stroke style, `stone-300` outlines on `stone-100`/white fills with `emerald-600` for done and money; the talk bubble is `brand`. No words inside them (letters such as अ and A are fine).

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
- Every string in every language on the final list (hi, en, es, fr, pt, de, ja). Write en, hi and es by hand; draft new or changed keys for the others with `scripts/translate-strings.ts --langs=fr,pt,de,ja --keys=<keys> --write` (Gemini draft, back-translation and a judge call), then read the result. `client/src/i18n.test.ts` fails on a missing key or a changed placeholder. Check Hindi, German (long words) and Japanese at 390 px width for wrapping.
- Technical labels (model, latency, `#seq`, hashes, ids, debug IDs) render only when `useJudge()` is true; text containing them has a `.plain` twin.
- `/demo`: as described under Layout (Judge mode pill, role-coloured captions, scaled iframes in judge mode). Check it at 1366 × 768, full screen at 100% zoom (the video setup, the user's screen), and at 1600 px: both rooms, their agreements, "Your turn" lines and microphones visible at once, with chat text at least 13 px on screen.
- Production board: a white `ui.card`. Each row starts with a state chip (`board/StateChip.tsx` on the fallback board, the `.sauda-state` span in `styles.css` on Bryntum): done = `ui.tone.done` with a check, ready = `ui.tone.ready` (sky) with a hollow ring, locked = `ui.tone.quiet` with a lock, and the locked row text in `stone-400`. Bars are `bg-emerald-600` (done), `bg-sky-200` (ready) or `bg-stone-200` (locked). Gates are diamonds in the same colours. The amber "Waiting for the PayPal payment" chip (`.sauda-waiting`) stays on a gated row. The deadline is a thin `red-500` line. The order row reads "<item> · <buyer name>"; `SAUDA-<id>` appears only in judge mode. Keep the `board-row-<key>` test ids and `data-state`.
- Production board card: the title on the left (no subtitle), the state legend drawn with the same chips on the right; a `board-loading` skeleton while the board chunk loads.
- Voice, agreement, payment and progress UI follow the sections above; a new screen that shows a deal reuses `DealProgress`, `PaymentMoment` and `QrImage` rather than drawing its own.
- Check every screen on a laptop (1440 × 900) and a phone (390 × 844) for both roles, in Hindi and English, and in Japanese and one long-word language (German) for wrapping.
- Before asking the user to look, take a screenshot and check it against this file.
