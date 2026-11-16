import { handler, requireUser, ApiError } from "@/server/http";
import { isValidKey, getObject, contentTypeFor } from "@/server/storage";
import { userOwnsImage } from "@/server/generations";
import { config } from "@/server/config";

export const dynamic = "force-dynamic";

// Every image request is authenticated and ownership-checked; there are no public URLs.
export const GET = handler(async (req: Request, ctx: { params: Promise<{ key: string }> }) => {
  const user = await requireUser();
  const { key } = await ctx.params;
  if (!isValidKey(key) || !(await userOwnsImage(user.id, key))) throw new ApiError(404, "not_found");

  let data: Buffer;
  try {
    data = await getObject(key);
  } catch {
    throw new ApiError(404, "not_found");
  }
  const headers: Record<string, string> = {
    "Content-Type": contentTypeFor(key),
    "Content-Length": String(data.length),
    "Cache-Control": "private, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
  };
  if (new URL(req.url).searchParams.get("download") === "1") {
    const ext = key.split(".").pop();
    const slug = config.appName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    headers["Content-Disposition"] = `attachment; filename="${slug}-${Date.now()}.${ext}"`;
  }
  return new Response(new Uint8Array(data), { headers });
});
