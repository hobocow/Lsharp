import { handler, json, assertSameOrigin } from "@/server/http";
import { destroyCurrentSession } from "@/server/auth/sessions";

export const POST = handler(async (req: Request) => {
  assertSameOrigin(req);
  await destroyCurrentSession();
  return json({ ok: true });
});
