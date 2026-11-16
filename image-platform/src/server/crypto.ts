import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** URL-safe random token with `bytes` bytes of entropy. */
export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");

/** We only ever store hashes of secrets (session cookies, login links). */
export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

export const hmacSha256 = (key: string | Buffer, data: string) => createHmac("sha256", key).update(data).digest();

export function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ab.length === bb.length && ab.length > 0 && timingSafeEqual(ab, bb);
}
