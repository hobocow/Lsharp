import "server-only";
import type { Tx } from "./db";

export class InsufficientCredits extends Error {}

/**
 * Apply a credit change inside an existing transaction.
 * - The balance can never go negative (conditional UPDATE + CHECK constraint).
 * - `ref` is UNIQUE in the ledger, so the same event (payment, refund...) can
 *   only ever be applied once, even under concurrent requests.
 * Returns the new balance, or null if this `ref` was already applied.
 */
export async function applyCredits(
  tx: Tx,
  userId: number,
  delta: number,
  kind: "purchase" | "spend" | "refund" | "grant" | "adjust",
  ref: string,
  note?: string,
): Promise<number | null> {
  // Claim the ref first; if it already exists, this event was processed before.
  const claimed = await tx`
    INSERT INTO credit_ledger (user_id, delta, balance_after, kind, ref, note)
    VALUES (${userId}, ${delta}, 0, ${kind}, ${ref}, ${note ?? null})
    ON CONFLICT (ref) DO NOTHING
    RETURNING id`;
  if (claimed.length === 0) return null;

  const [row] = await tx<{ credits: number }[]>`
    UPDATE users SET credits = credits + ${delta}, updated_at = now()
    WHERE id = ${userId} AND credits + ${delta} >= 0
    RETURNING credits`;
  if (!row) throw new InsufficientCredits();

  await tx`UPDATE credit_ledger SET balance_after = ${row.credits} WHERE id = ${claimed[0].id}`;
  return row.credits;
}
