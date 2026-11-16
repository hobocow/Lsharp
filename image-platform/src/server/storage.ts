import "server-only";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { config } from "./config";
import { randomToken } from "./crypto";

/**
 * Private image storage on local disk (mount a persistent volume at STORAGE_DIR).
 * Files are never served directly: /api/images/:key checks ownership first.
 * Keys are random, so they can't be guessed or enumerated.
 */
const KEY_RE = /^(in|out|th)_[A-Za-z0-9-]{22,64}\.(jpg|png|webp)$/;

export const isValidKey = (key: string) => KEY_RE.test(key);

const root = () => path.resolve(config.storageDir);
const filePath = (key: string) => {
  if (!isValidKey(key)) throw new Error("invalid storage key");
  // Two-level fan-out keeps directories small.
  const id = key.split("_")[1];
  return path.join(root(), id.slice(0, 2), key);
};

export function newKey(kind: "in" | "out", ext: "jpg" | "png" | "webp") {
  // No underscores in the id so `kind_id.ext` splits unambiguously.
  return `${kind}_${randomToken(24).replace(/_/g, "-")}.${ext}`;
}

/** Thumbnail key derived from an image key. */
export const thumbKey = (key: string) => `th_${key.split("_")[1].replace(/\.\w+$/, "")}.webp`;

export async function putObject(key: string, data: Buffer) {
  const p = filePath(key);
  await mkdir(path.dirname(p), { recursive: true });
  const tmp = `${p}.${randomToken(6)}.tmp`;
  await writeFile(tmp, data, { mode: 0o600 });
  await rename(tmp, p);
}

export async function getObject(key: string): Promise<Buffer> {
  return readFile(filePath(key));
}

export const contentTypeFor = (key: string) =>
  key.endsWith(".png") ? "image/png" : key.endsWith(".webp") ? "image/webp" : "image/jpeg";
