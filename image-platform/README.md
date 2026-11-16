# Image platform (working name: Lumen)

Telegram-first AI photo editing. Users open the bot, tap **Open**, upload a photo,
describe the edit, and get the result. Credits are bought with SOL, USDC or USDT on Solana.

The image model/provider is never named in the UI, network responses or error messages.
It lives server-side in `src/server/providers/`.

## How it works

| Piece | Where | Notes |
| --- | --- | --- |
| Telegram bot | `src/server/bot.ts`, webhook at `/api/telegram/webhook` | `/start`, `/balance`, `/logout`. Webhook verified with a secret header. |
| Sign-in (Mini App) | `/api/auth/telegram` | Telegram signs `initData` with the bot token; we verify the HMAC and open a session. No links involved. |
| Sign-in (browser) | bot button → `/login#t=…` → `/api/auth/link` | Single-use, 5-minute, hashed token in the URL *fragment* (never sent to servers or link previews). Message is forward-protected. |
| Sessions | `src/server/auth/sessions.ts` | Random 256-bit cookie (`HttpOnly`, `Secure`, `SameSite=Lax`), stored hashed, 30 days, revocable with `/logout`. |
| Credits | `src/server/credits.ts`, table `credit_ledger` | Append-only ledger with a UNIQUE `ref` per event; balance can't go negative. Concurrency-tested. |
| Payments | `src/server/payments/` | Solana Pay transfer requests with a unique reference **and** a unique exact amount; verified on-chain server-side; each tx signature can credit only once. |
| Edits | `src/server/generations.ts`, `src/server/providers/bria.ts` | Credit reserved on submit, auto-refunded on any failure (incl. server restarts). Uploads are re-encoded and stripped of EXIF/GPS. |
| Images | `/api/images/:key` | Private: every request checks the session owns the image. Random unguessable keys. |
| UI | `src/components/` | Single screen, mobile-first, light/dark, Telegram theme + haptics + native download in the Mini App. |

Pricing and credit packs: `src/lib/pricing.ts` (1 credit = 1 edit; packs $5/$10/$25/$50).

## Run locally

```bash
cp .env.example .env.local      # fill in values; PROVIDER_MOCK=1 needs no API key
npm install
npm run migrate                 # needs DATABASE_URL
npm run dev
npm test                        # unit tests; add TEST_DATABASE_URL=… for DB tests
```

## Deploy on Railway (recommended)

1. **New Project → Deploy from GitHub repo**, pick this repo (set root directory to this folder if it's not at the repo root).
2. **Add → Database → PostgreSQL.** In the app service, add variable `DATABASE_URL` = `${{Postgres.DATABASE_URL}}`.
3. **Add a Volume** to the app service mounted at `/data`, and set `STORAGE_DIR=/data/images`.
4. **Settings → Networking → Generate Domain.** Put that URL in `APP_URL`.
5. Fill in the rest of the variables from `.env.example`:
   - `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME` (from @BotFather)
   - `TELEGRAM_WEBHOOK_SECRET` (any long random string)
   - `PROVIDER_API_KEY`
   - `SOLANA_RECIPIENT` (your wallet's **public** address) and ideally a paid `SOLANA_RPC_URL` (e.g. Helius)
6. Deploy. Start command is `npm start` (runs migrations, then the server). Health check: `/api/health`.
7. Register the bot once: in Railway's shell (or locally with the same env) run `npm run bot:set-webhook`.
8. In @BotFather: `/setdomain` isn't needed; optionally `/newapp` to give the Mini App a direct link.

## Before going live: checklist

- [ ] **Verify the provider adapter** against the live API with a real key (`src/server/providers/bria.ts`): endpoint, field names, model version, async polling. It was written from the public docs without access to them.
- [ ] Confirm your provider license allows reselling/white-labeling.
- [ ] Receiving wallet: make sure it has USDC and USDT token accounts (receive a tiny amount of each once), or wallets may refuse to send.
- [ ] Use a paid Solana RPC; the public one is rate-limited.
- [ ] Do a real $5 purchase in each token and one real edit.
- [ ] Back up the Postgres database (Railway → Postgres → Backups).

## Scaling notes

Rate limiting is in-memory and image storage is on a volume: right for one instance. To run
several instances, move rate limits to Redis and storage to S3/R2 (only `src/server/storage.ts` changes).
