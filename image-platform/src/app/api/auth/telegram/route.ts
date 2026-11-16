import { z } from "zod";
import { handler, json, ApiError, assertSameOrigin, clientIp, limit } from "@/server/http";
import { verifyInitData } from "@/server/auth/telegram";
import { upsertTelegramUser, createSession } from "@/server/auth/sessions";
import { config } from "@/server/config";

const Body = z.object({ initData: z.string().min(1).max(4096) });

// Mini App sign-in: Telegram signs initData with our bot token; we verify and open a session.
export const POST = handler(async (req: Request) => {
  assertSameOrigin(req);
  limit(`auth:${clientIp(req)}`, 20, 60_000);
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) throw new ApiError(400, "bad_request");

  const result = verifyInitData(body.data.initData, config.botToken);
  if (!result.ok) throw new ApiError(401, "invalid_telegram_auth");

  const user = await upsertTelegramUser(result.user);
  if (user.is_banned) throw new ApiError(403, "banned");
  await createSession(user.id, req.headers.get("user-agent"));
  return json({ ok: true });
});
