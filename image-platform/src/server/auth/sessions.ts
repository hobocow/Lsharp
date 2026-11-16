import "server-only";
import { cookies } from "next/headers";
import { db, type UserRow } from "../db";
import { randomToken, sha256 } from "../crypto";
import { config } from "../config";
import type { TelegramUser } from "./telegram";

export const SESSION_COOKIE = "sid";
const SESSION_DAYS = 30;
const LOGIN_LINK_MINUTES = 5;

/** Find or create the account for a Telegram user, refreshing their display name. */
export async function upsertTelegramUser(tg: TelegramUser): Promise<UserRow> {
  const sql = db();
  return sql.begin(async (tx) => {
    const [user] = await tx<UserRow[]>`
      INSERT INTO users (telegram_id, username, first_name)
      VALUES (${tg.id}, ${tg.username ?? null}, ${tg.first_name ?? null})
      ON CONFLICT (telegram_id) DO UPDATE
        SET username = EXCLUDED.username, first_name = EXCLUDED.first_name, updated_at = now()
      RETURNING id, telegram_id, username, first_name, credits, is_banned, (xmax = 0) AS inserted`;
    const inserted = (user as unknown as { inserted: boolean }).inserted;
    const free = config.freeStarterCredits;
    if (inserted && free > 0) {
      const [u] = await tx<{ credits: number }[]>`
        UPDATE users SET credits = credits + ${free} WHERE id = ${user.id} RETURNING credits`;
      await tx`INSERT INTO credit_ledger (user_id, delta, balance_after, kind, ref, note)
               VALUES (${user.id}, ${free}, ${u.credits}, 'grant', ${`welcome:${user.id}`}, 'Welcome credits')`;
      user.credits = u.credits;
    }
    return user;
  });
}

export async function createSession(userId: number, userAgent: string | null) {
  const token = randomToken(32);
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await db()`INSERT INTO sessions (user_id, token_hash, expires_at, user_agent)
             VALUES (${userId}, ${sha256(token)}, ${expires}, ${userAgent?.slice(0, 300) ?? null})`;
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: config.isProd,
    sameSite: "lax",
    path: "/",
    expires,
  });
}

/** Returns the logged-in user, or null. Banned users and revoked/expired sessions get null. */
export async function getCurrentUser(): Promise<UserRow | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token || token.length > 200) return null;
  const [user] = await db()<UserRow[]>`
    SELECT u.id, u.telegram_id, u.username, u.first_name, u.credits, u.is_banned
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ${sha256(token)} AND s.revoked_at IS NULL AND s.expires_at > now()`;
  if (!user || user.is_banned) return null;
  return user;
}

export async function destroyCurrentSession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db()`UPDATE sessions SET revoked_at = now() WHERE token_hash = ${sha256(token)}`;
  jar.delete(SESSION_COOKIE);
}

/** Revoke every session and unused login link for a Telegram user (bot /logout). */
export async function revokeAllForTelegramId(telegramId: number) {
  const sql = db();
  await sql`UPDATE sessions SET revoked_at = now()
            WHERE revoked_at IS NULL AND user_id = (SELECT id FROM users WHERE telegram_id = ${telegramId})`;
  await sql`UPDATE login_tokens SET used_at = now()
            WHERE used_at IS NULL AND user_id = (SELECT id FROM users WHERE telegram_id = ${telegramId})`;
}

/** Create a single-use login link. Only the hash is stored. */
export async function createLoginLink(userId: number): Promise<string> {
  const token = randomToken(32);
  const expires = new Date(Date.now() + LOGIN_LINK_MINUTES * 60_000);
  await db()`INSERT INTO login_tokens (user_id, token_hash, expires_at)
             VALUES (${userId}, ${sha256(token)}, ${expires})`;
  return `${config.appUrl}/login#t=${token}`;
}

/** Atomically consume a login token. Returns the user id, or null if invalid/used/expired. */
export async function consumeLoginToken(token: string): Promise<number | null> {
  if (!token || token.length > 100) return null;
  const [row] = await db()<{ user_id: number }[]>`
    UPDATE login_tokens SET used_at = now()
    WHERE token_hash = ${sha256(token)} AND used_at IS NULL AND expires_at > now()
    RETURNING user_id`;
  return row?.user_id ?? null;
}
