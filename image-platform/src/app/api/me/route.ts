import { handler, json, requireUser } from "@/server/http";
import { config } from "@/server/config";
import { CREDITS_PER_EDIT } from "@/lib/pricing";

export const dynamic = "force-dynamic";

export const GET = handler(async () => {
  const user = await requireUser();
  return json({
    user: { name: user.first_name ?? user.username ?? "there", credits: user.credits },
    costPerEdit: CREDITS_PER_EDIT,
    tokens: config.solanaTokens,
  });
});
