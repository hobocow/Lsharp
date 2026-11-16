import { handler, json, requireUser, limit, ApiError } from "@/server/http";
import { checkPayment } from "@/server/payments/service";

export const dynamic = "force-dynamic";

// Polled by the top-up sheet; also checks the chain for the transfer.
export const GET = handler(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  limit(`paycheck:${user.id}`, 60, 60_000);
  const { id } = await ctx.params;
  const n = Number(id);
  if (!Number.isSafeInteger(n) || n <= 0) throw new ApiError(404, "not_found");
  const payment = await checkPayment(user.id, n);
  const fresh = await requireUser();
  return json({ payment, credits: fresh.credits });
});
