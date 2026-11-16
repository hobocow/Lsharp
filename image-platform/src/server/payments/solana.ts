import { randomBytes } from "node:crypto";
import bs58 from "bs58";

export type TokenSymbol = "SOL" | "USDC" | "USDT";

export const TOKENS: Record<TokenSymbol, { decimals: number; mint: string | null }> = {
  SOL: { decimals: 9, mint: null },
  USDC: { decimals: 6, mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" },
  USDT: { decimals: 6, mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB" },
};

export const isTokenSymbol = (s: string): s is TokenSymbol => s in TOKENS;

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export function isValidPublicKey(s: string): boolean {
  if (!BASE58_RE.test(s)) return false;
  try {
    return bs58.decode(s).length === 32;
  } catch {
    return false;
  }
}

/** Solana Pay reference: a random 32-byte public key attached to the transfer so we can find it on-chain. */
export const newReference = () => bs58.encode(randomBytes(32));

/** Base units (bigint) -> decimal string without trailing zeros, e.g. 5000000n,6 -> "5". */
export function formatUnits(base: bigint, decimals: number): string {
  const s = base.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

/** USD cents -> token base units. Stablecoins are 1:1; SOL uses a USD price, rounded UP to 0.00001 SOL. */
export function usdToBaseUnits(usdCents: number, token: TokenSymbol, solUsdPrice?: number): bigint {
  if (token === "USDC" || token === "USDT") return BigInt(usdCents) * 10_000n; // cents * 1e4 = 1e-6 units
  if (!solUsdPrice || !(solUsdPrice > 0)) throw new Error("SOL price unavailable");
  const lamports = Math.ceil(((usdCents / 100) / solUsdPrice) * 1e9);
  const step = 10_000; // 0.00001 SOL
  return BigInt(Math.ceil(lamports / step) * step);
}

/**
 * Tiny unique offset added to each payment's amount, so a transfer that lost its
 * reference (e.g. address + amount copy-pasted into a wallet) can still be matched
 * by its exact amount. Stablecoins: < $0.01. SOL: < 0.001 SOL.
 */
export function amountJitter(token: TokenSymbol, n: number): bigint {
  const k = BigInt(1 + (Math.abs(Math.trunc(n)) % 9999));
  return token === "SOL" ? k * 100n : k;
}

/** Build a Solana Pay transfer-request URL (https://docs.solanapay.com/spec). */
export function transferRequestUrl(p: {
  recipient: string;
  amount: string;
  token: TokenSymbol;
  reference: string;
  label: string;
  message: string;
}): string {
  const q = new URLSearchParams({ amount: p.amount });
  const mint = TOKENS[p.token].mint;
  if (mint) q.set("spl-token", mint);
  q.set("reference", p.reference);
  q.set("label", p.label);
  q.set("message", p.message);
  return `solana:${p.recipient}?${q.toString().replace(/\+/g, "%20")}`;
}

// ---- On-chain verification (pure, unit-tested) ----

type ParsedAccountKey = string | { pubkey: string };
type TokenBalance = { accountIndex: number; mint: string; owner?: string; uiTokenAmount: { amount: string } };

export type ParsedTx = {
  meta: {
    err: unknown;
    preBalances: number[];
    postBalances: number[];
    preTokenBalances?: TokenBalance[] | null;
    postTokenBalances?: TokenBalance[] | null;
    loadedAddresses?: { writable: string[]; readonly: string[] } | null;
  } | null;
  transaction: { message: { accountKeys: ParsedAccountKey[] } };
};

export type Expected = { recipient: string; token: TokenSymbol; amountBase: bigint; reference: string };

function accountKeys(tx: ParsedTx): string[] {
  const keys = tx.transaction.message.accountKeys.map((k) => (typeof k === "string" ? k : k.pubkey));
  const loaded = tx.meta?.loadedAddresses;
  return loaded ? [...keys, ...loaded.writable, ...loaded.readonly] : keys;
}

/** Amount of `token` the recipient gained in this transaction (0 if failed). */
export function receivedAmount(tx: ParsedTx | null, recipient: string, token: TokenSymbol): bigint {
  if (!tx?.meta || tx.meta.err !== null) return 0n;
  const mint = TOKENS[token].mint;
  if (!mint) {
    const i = accountKeys(tx).indexOf(recipient);
    if (i < 0) return 0n;
    return BigInt(tx.meta.postBalances[i] ?? 0) - BigInt(tx.meta.preBalances[i] ?? 0);
  }
  const pre = new Map((tx.meta.preTokenBalances ?? []).map((b) => [b.accountIndex, b]));
  let received = 0n;
  for (const post of tx.meta.postTokenBalances ?? []) {
    if (post.mint !== mint || post.owner !== recipient) continue;
    const before = pre.get(post.accountIndex);
    received += BigInt(post.uiTokenAmount.amount) - BigInt(before?.uiTokenAmount.amount ?? "0");
  }
  return received;
}

/**
 * - mode "reference": tx carries our Solana Pay reference and paid at least the amount.
 * - mode "exact": tx (found by scanning the recipient) paid exactly the unique amount.
 */
export function verifyTransfer(tx: ParsedTx | null, exp: Expected, mode: "reference" | "exact" = "reference"): boolean {
  if (!tx?.meta || tx.meta.err !== null) return false;
  const received = receivedAmount(tx, exp.recipient, exp.token);
  if (mode === "exact") return received === exp.amountBase;
  return accountKeys(tx).includes(exp.reference) && received >= exp.amountBase;
}

// ---- RPC ----

export async function rpc<T>(url: string, method: string, params: unknown[]): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`rpc ${method} http ${res.status}`);
  const data = (await res.json()) as { result?: T; error?: { message: string } };
  if (data.error) throw new Error(`rpc ${method}: ${data.error.message}`);
  return data.result as T;
}

/** Successful signatures touching `address`, optionally only those after `sinceUnix`. */
export async function findSignatures(rpcUrl: string, address: string, limit = 20, sinceUnix = 0): Promise<string[]> {
  const sigs = await rpc<{ signature: string; err: unknown; blockTime: number | null }[]>(
    rpcUrl,
    "getSignaturesForAddress",
    [address, { limit, commitment: "confirmed" }],
  );
  return sigs.filter((s) => s.err === null && (s.blockTime ?? Infinity) >= sinceUnix).map((s) => s.signature);
}

/** The address incoming transfers of `token` land on: the wallet for SOL, its token accounts for SPL. */
const tokenAccountCache = new Map<string, { at: number; value: string[] }>();
export async function incomingAddresses(rpcUrl: string, recipient: string, token: TokenSymbol): Promise<string[]> {
  const mint = TOKENS[token].mint;
  if (!mint) return [recipient];
  const cached = tokenAccountCache.get(mint);
  if (cached && Date.now() - cached.at < 10 * 60_000) return cached.value;
  const res = await rpc<{ value: { pubkey: string }[] }>(rpcUrl, "getTokenAccountsByOwner", [
    recipient,
    { mint },
    { encoding: "jsonParsed", commitment: "confirmed" },
  ]);
  const value = res.value.map((v) => v.pubkey);
  tokenAccountCache.set(mint, { at: Date.now(), value });
  return value;
}

export async function getParsedTx(rpcUrl: string, signature: string): Promise<ParsedTx | null> {
  return rpc<ParsedTx | null>(rpcUrl, "getTransaction", [
    signature,
    { encoding: "jsonParsed", commitment: "confirmed", maxSupportedTransactionVersion: 0 },
  ]);
}

// ---- SOL/USD price (cached 60s) ----

let priceCache: { value: number; at: number } | null = null;
const SOL_MINT = "So11111111111111111111111111111111111111112";

export async function getSolUsdPrice(): Promise<number> {
  if (priceCache && Date.now() - priceCache.at < 60_000) return priceCache.value;
  const sources: (() => Promise<number>)[] = [
    async () => {
      const r = await fetch(`https://lite-api.jup.ag/price/v3?ids=${SOL_MINT}`, { signal: AbortSignal.timeout(5000) });
      const j = (await r.json()) as Record<string, { usdPrice?: number }>;
      return Number(j[SOL_MINT]?.usdPrice);
    },
    async () => {
      const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd", {
        signal: AbortSignal.timeout(5000),
      });
      const j = (await r.json()) as { solana?: { usd?: number } };
      return Number(j.solana?.usd);
    },
  ];
  for (const src of sources) {
    try {
      const v = await src();
      if (v > 1 && v < 100_000) {
        priceCache = { value: v, at: Date.now() };
        return v;
      }
    } catch {
      /* try next source */
    }
  }
  throw new Error("SOL price unavailable");
}
