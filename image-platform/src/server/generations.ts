import "server-only";
import { db } from "./db";
import { applyCredits, InsufficientCredits } from "./credits";
import { ApiError } from "./http";
import { sanitizeUpload, inspectOutput, thumbnail, BadImage } from "./images";
import { newKey, putObject, getObject, thumbKey } from "./storage";
import { getEditProvider, ProviderError } from "./providers";
import { randomToken } from "./crypto";
import { CREDITS_PER_EDIT } from "@/lib/pricing";

const MAX_CONCURRENT_PER_USER = 2;
const STALE_MINUTES = 10;

type GenRow = {
  id: number;
  public_id: string;
  user_id: number;
  prompt: string;
  input_key: string;
  output_key: string | null;
  status: "processing" | "succeeded" | "failed";
  error_code: string | null;
  cost: number;
  created_at: Date;
};

export type GenerationDto = {
  id: string;
  status: GenRow["status"];
  prompt: string;
  createdAt: string;
  inputUrl: string;
  imageUrl: string | null;
  thumbUrl: string | null;
  error: string | null;
};

export const toDto = (g: GenRow): GenerationDto => ({
  id: g.public_id,
  status: g.status,
  prompt: g.prompt,
  createdAt: g.created_at.toISOString(),
  inputUrl: `/api/images/${g.input_key}`,
  imageUrl: g.output_key ? `/api/images/${g.output_key}` : null,
  thumbUrl: g.output_key ? `/api/images/${thumbKey(g.output_key)}` : null,
  error: g.error_code,
});

export function validatePrompt(raw: unknown): string {
  const prompt = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  if (prompt.length < 2) throw new ApiError(400, "prompt_required");
  if (prompt.length > 1000) throw new ApiError(400, "prompt_too_long");
  return prompt;
}

/** Validates input, charges credits atomically and records the job. The edit itself runs in `runGeneration`. */
export async function createGeneration(userId: number, upload: Buffer, prompt: string): Promise<GenRow> {
  const sql = db();
  const [{ count }] = await sql<{ count: number }[]>`
    SELECT count(*)::int AS count FROM generations WHERE user_id = ${userId} AND status = 'processing'`;
  if (count >= MAX_CONCURRENT_PER_USER) throw new ApiError(429, "too_many_in_progress");

  let clean: Buffer;
  try {
    clean = await sanitizeUpload(upload);
  } catch (e) {
    if (e instanceof BadImage) throw new ApiError(400, "invalid_image");
    throw e;
  }
  const inputKey = newKey("in", "jpg");
  await putObject(inputKey, clean);

  try {
    return await sql.begin(async (tx) => {
      const [gen] = await tx<GenRow[]>`
        INSERT INTO generations (public_id, user_id, prompt, input_key, cost)
        VALUES (${randomToken(12)}, ${userId}, ${prompt}, ${inputKey}, ${CREDITS_PER_EDIT})
        RETURNING *`;
      await applyCredits(tx, userId, -CREDITS_PER_EDIT, "spend", `gen:${gen.id}`, "Image edit");
      return gen;
    });
  } catch (e) {
    if (e instanceof InsufficientCredits) throw new ApiError(402, "insufficient_credits");
    throw e;
  }
}

async function failAndRefund(gen: Pick<GenRow, "id" | "user_id" | "cost">, code: string) {
  await db().begin(async (tx) => {
    const updated = await tx`
      UPDATE generations SET status = 'failed', error_code = ${code}, finished_at = now()
      WHERE id = ${gen.id} AND status = 'processing' RETURNING id`;
    if (updated.length) await applyCredits(tx, gen.user_id, gen.cost, "refund", `refund:gen:${gen.id}`, "Refund: edit failed");
  });
}

/** Runs the provider call. Any failure marks the job failed and refunds the credit exactly once. */
export async function runGeneration(gen: GenRow) {
  try {
    const input = await getObject(gen.input_key);
    const result = await getEditProvider().edit({ image: input, prompt: gen.prompt });
    const ext = await inspectOutput(result.image);
    const outKey = newKey("out", ext);
    await putObject(outKey, result.image);
    await putObject(thumbKey(outKey), await thumbnail(result.image));
    await db()`
      UPDATE generations SET status = 'succeeded', output_key = ${outKey}, provider_ref = ${result.ref ?? null}, finished_at = now()
      WHERE id = ${gen.id} AND status = 'processing'`;
  } catch (e) {
    const code = e instanceof ProviderError ? e.code : "failed";
    console.error(`[generation ${gen.id}] ${code}:`, e instanceof Error ? e.message : e);
    await failAndRefund(gen, code).catch((err) => console.error("[generation] refund failed", err));
  }
}

/** Jobs interrupted by a restart never finish; refund them after a grace period. */
export async function sweepStale(userId: number) {
  const stale = await db()<GenRow[]>`
    SELECT id, user_id, cost FROM generations
    WHERE user_id = ${userId} AND status = 'processing' AND created_at < now() - make_interval(mins => ${STALE_MINUTES})`;
  for (const g of stale) await failAndRefund(g, "timeout");
}

export async function getGeneration(userId: number, publicId: string): Promise<GenRow | null> {
  const [g] = await db()<GenRow[]>`SELECT * FROM generations WHERE public_id = ${publicId} AND user_id = ${userId}`;
  return g ?? null;
}

export async function listGenerations(userId: number, limit = 60): Promise<GenRow[]> {
  return db()<GenRow[]>`SELECT * FROM generations WHERE user_id = ${userId} ORDER BY id DESC LIMIT ${limit}`;
}

/** Ownership check for image downloads. */
export async function userOwnsImage(userId: number, key: string): Promise<boolean> {
  const sql = db();
  if (key.startsWith("th_")) {
    const id = key.slice(3).replace(/\.webp$/, "");
    const r = await sql`SELECT 1 FROM generations WHERE user_id = ${userId} AND output_key LIKE ${`out_${id}.%`} LIMIT 1`;
    return r.length > 0;
  }
  const r = await sql`SELECT 1 FROM generations WHERE user_id = ${userId} AND (input_key = ${key} OR output_key = ${key}) LIMIT 1`;
  return r.length > 0;
}
