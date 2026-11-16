import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { verifyInitData } from "../src/server/auth/telegram";

const BOT_TOKEN = "123456:TEST-token";

function sign(fields: Record<string, string>, token = BOT_TOKEN) {
  const dcs = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  const hash = createHmac("sha256", secret).update(dcs).digest("hex");
  return new URLSearchParams({ ...fields, hash }).toString();
}

const now = 1_800_000_000;
const user = JSON.stringify({ id: 42, first_name: "Ana", username: "ana" });

describe("verifyInitData", () => {
  it("accepts correctly signed, fresh data", () => {
    const r = verifyInitData(sign({ auth_date: String(now - 10), query_id: "abc", user }), BOT_TOKEN, { now });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.user.id).toBe(42);
  });

  it("rejects data signed with another bot's token", () => {
    const r = verifyInitData(sign({ auth_date: String(now), user }, "999:other"), BOT_TOKEN, { now });
    expect(r).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects tampered user id", () => {
    const signed = sign({ auth_date: String(now), user });
    const tampered = signed.replace(encodeURIComponent('"id":42'), encodeURIComponent('"id":43'));
    expect(verifyInitData(tampered, BOT_TOKEN, { now }).ok).toBe(false);
  });

  it("rejects stale data", () => {
    const r = verifyInitData(sign({ auth_date: String(now - 7200), user }), BOT_TOKEN, { now });
    expect(r).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects missing hash and garbage", () => {
    expect(verifyInitData("auth_date=1&user=%7B%7D", BOT_TOKEN, { now }).ok).toBe(false);
    expect(verifyInitData("", BOT_TOKEN, { now }).ok).toBe(false);
  });
});
