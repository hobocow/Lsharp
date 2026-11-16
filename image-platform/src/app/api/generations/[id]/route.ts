import { handler, json, requireUser, ApiError } from "@/server/http";
import { getGeneration, sweepStale, toDto } from "@/server/generations";

export const dynamic = "force-dynamic";

export const GET = handler(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  if (!/^[A-Za-z0-9_-]{8,40}$/.test(id)) throw new ApiError(404, "not_found");
  await sweepStale(user.id);
  const gen = await getGeneration(user.id, id);
  if (!gen) throw new ApiError(404, "not_found");
  // Re-read the balance: a failed job may have just been refunded.
  const fresh = await requireUser();
  return json({ generation: toDto(gen), credits: fresh.credits });
});
