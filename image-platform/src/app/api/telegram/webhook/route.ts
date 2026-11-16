import { webhookCallback } from "grammy";
import { getBot } from "@/server/bot";
import { config } from "@/server/config";
import { safeEqualHex, sha256 } from "@/server/crypto";

export const dynamic = "force-dynamic";

let cb: ((req: Request) => Promise<Response>) | null = null;

export async function POST(req: Request) {
  // Telegram echoes the secret we registered with setWebhook; reject anything else.
  const got = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!safeEqualHex(sha256(got), sha256(config.webhookSecret))) {
    return new Response("forbidden", { status: 403 });
  }
  cb ??= webhookCallback(getBot(), "std/http");
  return cb(req);
}
