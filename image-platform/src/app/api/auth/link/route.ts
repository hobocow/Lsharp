import { z } from "zod";
import { handler, json, ApiError, assertSameOrigin, clientIp, limit } from "@/server/http";
import { consumeLoginToken, createSession } from "@/server/auth/sessions";

const Body = z.object({ token: z.string().min(20).max(100) });

// One-time link sign-in (for opening the site in a normal browser).
export const POST = handler(async (req: Request) => {
  assertSameOrigin(req);
  limit(`auth:${clientIp(req)}`, 20, 60_000);
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) throw new ApiError(400, "bad_request");

  const userId = await consumeLoginToken(body.data.token);
  if (!userId) throw new ApiError(401, "link_invalid_or_expired");
  await createSession(userId, req.headers.get("user-agent"));
  return json({ ok: true });
});
