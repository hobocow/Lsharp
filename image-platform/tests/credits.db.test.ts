import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { execFileSync } from "node:child_process";
import { applyCredits, InsufficientCredits } from "../src/server/credits";

// Runs only when TEST_DATABASE_URL points at a disposable database.
const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d("credit ledger (Postgres)", () => {
  const sql = postgres(url ?? "postgres://invalid", { max: 20, onnotice: () => {} });
  let userId = 0;

  beforeAll(async () => {
    await sql.unsafe("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    execFileSync("node", ["scripts/migrate.mjs"], { env: { ...process.env, DATABASE_URL: url } });
    [{ id: userId }] = await sql`INSERT INTO users (telegram_id) VALUES (777) RETURNING id`;
  });
  afterAll(() => sql.end());

  it("applies a purchase once even if processed concurrently", async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () => sql.begin((tx) => applyCredits(tx, userId, 5, "purchase", "payment:1"))),
    );
    expect(results.filter((r) => r !== null)).toHaveLength(1);
    const [u] = await sql`SELECT credits FROM users WHERE id = ${userId}`;
    expect(u.credits).toBe(5);
  });

  it("never lets concurrent spends go below zero", async () => {
    const attempts = await Promise.allSettled(
      Array.from({ length: 12 }, (_, i) => sql.begin((tx) => applyCredits(tx, userId, -1, "spend", `gen:${i}`))),
    );
    const ok = attempts.filter((a) => a.status === "fulfilled").length;
    const insufficient = attempts.filter((a) => a.status === "rejected" && a.reason instanceof InsufficientCredits).length;
    expect(ok).toBe(5);
    expect(insufficient).toBe(7);
    const [u] = await sql`SELECT credits FROM users WHERE id = ${userId}`;
    expect(u.credits).toBe(0);
    // Failed spends roll back their ledger rows too.
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM credit_ledger WHERE kind = 'spend'`;
    expect(n).toBe(5);
  });

  it("ledger balances add up", async () => {
    const [{ sum }] = await sql`SELECT coalesce(sum(delta),0)::int AS sum FROM credit_ledger WHERE user_id = ${userId}`;
    const [u] = await sql`SELECT credits FROM users WHERE id = ${userId}`;
    expect(sum).toBe(u.credits);
  });
});
