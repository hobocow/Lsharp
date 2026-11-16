import "server-only";
import { randomInt } from "node:crypto";
import QRCode from "qrcode";
import { db } from "../db";
import { config } from "../config";
import { applyCredits } from "../credits";
import { ApiError } from "../http";
import { findPack } from "@/lib/pricing";
import {
  TOKENS,
  isTokenSymbol,
  isValidPublicKey,
  newReference,
  formatUnits,
  usdToBaseUnits,
  amountJitter,
  incomingAddresses,
  transferRequestUrl,
  findSignatures,
  getParsedTx,
  getSolUsdPrice,
  verifyTransfer,
  type TokenSymbol,
} from "./solana";

const QUOTE_MINUTES = 15; // how long the quoted amount is shown as valid
const WATCH_HOURS = 48; // keep detecting late payments this long
const MIN_CHECK_INTERVAL_MS = 3000;

type PaymentRow = {
  id: number;
  user_id: number;
  pack_id: string;
  credits: number;
  usd_cents: number;
  token: TokenSymbol;
  amount: string;
  amount_base: string;
  recipient: string;
  reference: string;
  status: "pending" | "confirmed";
  signature: string | null;
  created_at: Date;
  expires_at: Date;
  confirmed_at: Date | null;
  last_checked_at: Date | null;
};

export type PaymentDto = {
  id: number;
  status: "pending" | "expired" | "confirmed";
  token: TokenSymbol;
  amount: string;
  credits: number;
  usdCents: number;
  recipient: string;
  payUrl: string;
  qr?: string;
  expiresAt: string;
  createdAt: string;
  signature: string | null;
};

async function toDto(p: PaymentRow, withQr = false): Promise<PaymentDto> {
  const amount = formatUnits(BigInt(p.amount_base), TOKENS[p.token].decimals);
  const payUrl = transferRequestUrl({
    recipient: p.recipient,
    amount,
    token: p.token,
    reference: p.reference,
    label: config.appName,
    message: `${p.credits} credits`,
  });
  const status = p.status === "confirmed" ? "confirmed" : p.expires_at < new Date() ? "expired" : "pending";
  return {
    id: p.id,
    status,
    token: p.token,
    amount,
    credits: p.credits,
    usdCents: p.usd_cents,
    recipient: p.recipient,
    payUrl,
    qr: withQr && status === "pending" ? await QRCode.toDataURL(payUrl, { margin: 1, width: 360 }) : undefined,
    expiresAt: p.expires_at.toISOString(),
    createdAt: p.created_at.toISOString(),
    signature: p.signature,
  };
}

export async function createPayment(userId: number, packId: string, token: string): Promise<PaymentDto> {
  const pack = findPack(packId);
  if (!pack) throw new ApiError(400, "unknown_pack");
  if (!isTokenSymbol(token) || !config.solanaTokens.includes(token)) throw new ApiError(400, "unsupported_token");
  const recipient = config.solanaRecipient;
  if (!isValidPublicKey(recipient)) throw new Error("SOLANA_RECIPIENT is not a valid address");

  let listBase: bigint;
  try {
    listBase = usdToBaseUnits(pack.usdCents, token, token === "SOL" ? await getSolUsdPrice() : undefined);
  } catch {
    throw new ApiError(503, "price_unavailable");
  }

  // Pick an exact amount no other open payment uses (enables amount-based matching).
  const sql = db();
  let base = listBase + amountJitter(token, randomInt(1_000_000));
  for (let i = 0; i < 10; i++) {
    const clash = await sql`
      SELECT 1 FROM payments WHERE token = ${token} AND amount_base = ${base.toString()} AND status = 'pending'
        AND created_at > now() - make_interval(hours => ${WATCH_HOURS}) LIMIT 1`;
    if (clash.length === 0) break;
    base = listBase + amountJitter(token, randomInt(1_000_000));
  }

  const [row] = await sql<PaymentRow[]>`
    INSERT INTO payments (user_id, pack_id, credits, usd_cents, token, amount, amount_base, recipient, reference, expires_at)
    VALUES (${userId}, ${pack.id}, ${pack.credits}, ${pack.usdCents}, ${token},
            ${formatUnits(base, TOKENS[token].decimals)}, ${base.toString()}, ${recipient}, ${newReference()},
            now() + make_interval(mins => ${QUOTE_MINUTES}))
    RETURNING *`;
  return toDto(row, true);
}

/**
 * Look for the payment on-chain and credit it. Safe to call any number of times,
 * concurrently: the payment row flips to confirmed at most once, each signature
 * can be used by one payment only (UNIQUE), and the ledger ref is unique.
 */
export async function checkPayment(userId: number, id: number): Promise<PaymentDto> {
  const sql = db();
  const [p] = await sql<PaymentRow[]>`SELECT * FROM payments WHERE id = ${id} AND user_id = ${userId}`;
  if (!p) throw new ApiError(404, "not_found");
  if (p.status === "confirmed") return toDto(p);

  const tooOld = Date.now() - p.created_at.getTime() > WATCH_HOURS * 3600_000;
  const tooSoon = p.last_checked_at && Date.now() - p.last_checked_at.getTime() < MIN_CHECK_INTERVAL_MS;
  if (tooOld || tooSoon) return toDto(p, true);
  await sql`UPDATE payments SET last_checked_at = now() WHERE id = ${p.id}`;

  // 1) Transfers carrying our Solana Pay reference. 2) Fallback: recent incoming
  //    transfers to the recipient with this payment's exact unique amount.
  const rpcUrl = config.solanaRpcUrl;
  const candidates: { sig: string; mode: "reference" | "exact" }[] = [];
  try {
    for (const sig of await findSignatures(rpcUrl, p.reference)) candidates.push({ sig, mode: "reference" });
    const since = Math.floor(p.created_at.getTime() / 1000) - 60;
    for (const addr of await incomingAddresses(rpcUrl, p.recipient, p.token)) {
      for (const sig of await findSignatures(rpcUrl, addr, 50, since)) {
        if (!candidates.some((c) => c.sig === sig)) candidates.push({ sig, mode: "exact" });
      }
    }
  } catch (e) {
    console.error("[payments] rpc error", e);
  }

  // Skip signatures that already credited a payment.
  const used = candidates.length
    ? new Set(
        (await sql<{ signature: string }[]>`
          SELECT signature FROM payments WHERE signature IN ${sql(candidates.map((c) => c.sig))}`).map((r) => r.signature),
      )
    : new Set<string>();

  for (const { sig, mode } of candidates) {
    if (used.has(sig)) continue;
    let ok = false;
    try {
      const expected = { recipient: p.recipient, token: p.token, amountBase: BigInt(p.amount_base), reference: p.reference };
      ok = verifyTransfer(await getParsedTx(rpcUrl, sig), expected, mode);
    } catch (e) {
      console.error("[payments] tx fetch error", e);
    }
    if (!ok) continue;

    try {
      const confirmed = await sql.begin(async (tx) => {
        const [row] = await tx<PaymentRow[]>`
          UPDATE payments SET status = 'confirmed', signature = ${sig}, confirmed_at = now()
          WHERE id = ${p.id} AND status = 'pending' RETURNING *`;
        if (!row) return null;
        await applyCredits(tx, p.user_id, p.credits, "purchase", `payment:${p.id}`, `${p.credits} credits (${p.token})`);
        return row;
      });
      const [fresh] = await sql<PaymentRow[]>`SELECT * FROM payments WHERE id = ${p.id}`;
      return toDto(confirmed ?? fresh);
    } catch (e) {
      // Unique violation: this signature already credited another payment. Ignore it.
      if ((e as { code?: string }).code === "23505") continue;
      throw e;
    }
  }
  return toDto(p, true);
}

export async function listPayments(userId: number): Promise<PaymentDto[]> {
  const rows = await db()<PaymentRow[]>`
    SELECT * FROM payments WHERE user_id = ${userId} ORDER BY id DESC LIMIT 30`;
  return Promise.all(rows.map((r) => toDto(r)));
}
