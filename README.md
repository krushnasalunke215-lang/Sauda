# Sauda

A live deal room where a Hindi-speaking maker and an English-speaking buyer negotiate a custom order in their own languages, and PayPal Invoicing runs the money.

## What it does

- **Two private links, one room.** The maker and the buyer each open their own link and chat in real time. Every typed or spoken turn (push-to-talk, a WhatsApp voice note or a sample clip) is interpreted by Gemini and shown to the other side in their language, with the original underneath.
- **A bilingual agreement that writes itself.** Item, size, measurements, colour, price, deposit, delivery date and shipping fill in as the parties agree. Each term links to the message it came from, and unclear points become questions for the right person.
- **Both sides confirm the same terms.** A confirmation is tied to a SHA-256 fingerprint of the agreement, so a change after a confirmation asks both sides to confirm again.
- **PayPal Invoicing runs the money.** The agent proposes the invoice, code checks the guards, the maker approves, and Sauda creates and sends a PayPal invoice with the deposit as the minimum payment and the bilingual agreement in the note. Payments are picked up by polling and verified webhooks, the balance unlocks after the buyer approves a progress photo (checked by Gemini vision), and tracking is added to the PayPal payments.
- **A money timeline.** Every PayPal call, payment and webhook for the deal is listed with its PayPal debug ID.

Open `/demo` to see both sides on one screen.

## PayPal sandbox only

Sauda only ever calls `https://api-m.sandbox.paypal.com`; there is no setting for the live API. No real money moves.

## Run locally

You need Node 24.11 or newer, a PayPal sandbox REST app with Invoicing enabled (linked to a US business sandbox account) and a Gemini API key.

```sh
npm ci
cp .env.example .env   # then fill in the values; .env is git-ignored
npm run dev            # server on http://localhost:8787, client on Vite's dev server
```

`npm run build` followed by `npm start` serves the built client from the server on port 8787.

## Tests

```sh
npm run typecheck
npm test          # unit tests (Vitest)
npm run e2e       # end-to-end tests (Playwright); these make real Gemini and PayPal sandbox calls and need .env
```

## License

[MIT](LICENSE)
