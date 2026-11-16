import { z } from "zod";
import { handler, json, requireUser, assertSameOrigin, limit, ApiError } from "@/server/http";
import { createPayment, listPayments } from "@/server/payments/service";

export const dynamic = "force-dynamic";

const Body = z.object({ packId: z.string().max(20), token: z.string().max(10) });

export const GET = handler(async () => {
  const user = await requireUser();
  return json({ items: await listPayments(user.id) });
});

export const POST = handler(async (req: Request) => {
  assertSameOrigin(req);
  const user = await requireUser();
  limit(`pay:${user.id}`, 10, 60_000);
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) throw new ApiError(400, "bad_request");
  return json({ payment: await createPayment(user.id, body.data.packId, body.data.token.toUpperCase()) }, 201);
});
