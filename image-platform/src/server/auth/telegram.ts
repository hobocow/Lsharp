import { hmacSha256, safeEqualHex } from "../crypto";

export type TelegramUser = {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
};

export type InitDataResult = { ok: true; user: TelegramUser; authDate: number } | { ok: false; reason: string };

/**
 * Verifies Telegram Mini App `initData` as documented at
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 * The data is signed by Telegram with a key derived from our bot token, so a
 * valid signature proves which Telegram user opened the Mini App.
 */
export function verifyInitData(
  initData: string,
  botToken: string,
  { maxAgeSeconds = 3600, now = Math.floor(Date.now() / 1000) } = {},
): InitDataResult {
  if (!initData || initData.length > 4096) return { ok: false, reason: "missing" };
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash || !/^[0-9a-f]{64}$/.test(hash)) return { ok: false, reason: "no_hash" };
  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const secret = hmacSha256("WebAppData", botToken);
  const expected = hmacSha256(secret, dataCheckString).toString("hex");
  if (!safeEqualHex(expected, hash)) return { ok: false, reason: "bad_signature" };

  const authDate = Number(params.get("auth_date"));
  if (!Number.isFinite(authDate) || authDate <= 0) return { ok: false, reason: "no_auth_date" };
  if (now - authDate > maxAgeSeconds) return { ok: false, reason: "expired" };
  if (authDate - now > 60) return { ok: false, reason: "future" };

  let user: TelegramUser;
  try {
    user = JSON.parse(params.get("user") ?? "");
  } catch {
    return { ok: false, reason: "bad_user" };
  }
  if (!user || !Number.isSafeInteger(user.id) || user.id <= 0) return { ok: false, reason: "bad_user" };
  return { ok: true, user, authDate };
}
