import { after } from "next/server";
import { handler, json, requireUser, assertSameOrigin, limit, ApiError } from "@/server/http";
import { createGeneration, runGeneration, listGenerations, sweepStale, toDto, validatePrompt } from "@/server/generations";
import { MAX_UPLOAD_BYTES } from "@/server/images";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const GET = handler(async () => {
  const user = await requireUser();
  await sweepStale(user.id);
  const rows = await listGenerations(user.id);
  return json({ items: rows.map(toDto) });
});

export const POST = handler(async (req: Request) => {
  assertSameOrigin(req);
  const user = await requireUser();
  limit(`gen:${user.id}`, 12, 60_000);

  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_UPLOAD_BYTES + 64 * 1024) throw new ApiError(413, "image_too_large");

  const form = await req.formData().catch(() => null);
  if (!form) throw new ApiError(400, "bad_request");
  const prompt = validatePrompt(form.get("prompt"));
  const file = form.get("image");
  if (!(file instanceof File) || file.size === 0) throw new ApiError(400, "image_required");
  if (file.size > MAX_UPLOAD_BYTES) throw new ApiError(413, "image_too_large");

  const gen = await createGeneration(user.id, Buffer.from(await file.arrayBuffer()), prompt);
  // Respond immediately; the edit runs after the response is sent. The client polls for status.
  after(() => runGeneration(gen));
  return json({ generation: toDto(gen), credits: user.credits - gen.cost }, 202);
});
