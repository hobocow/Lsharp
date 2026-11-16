import "server-only";
import sharp from "sharp";

export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
const MAX_INPUT_SIDE = 2048;
const MAX_PIXELS = 50_000_000; // reject decompression bombs

export class BadImage extends Error {}

/**
 * Decode and re-encode an image. This:
 * - rejects anything that isn't really a JPEG/PNG/WebP/HEIC image,
 * - strips all metadata (EXIF GPS location, camera, software tags),
 * - applies EXIF rotation so phone photos aren't sideways,
 * - caps the size sent to the provider.
 */
export async function sanitizeUpload(input: Buffer): Promise<Buffer> {
  try {
    const img = sharp(input, { limitInputPixels: MAX_PIXELS, failOn: "error" });
    const meta = await img.metadata();
    if (!meta.format || !["jpeg", "png", "webp", "heif"].includes(meta.format)) throw new BadImage("format");
    return await img
      .rotate()
      .resize({ width: MAX_INPUT_SIDE, height: MAX_INPUT_SIDE, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 92, mozjpeg: true })
      .toBuffer();
  } catch (e) {
    if (e instanceof BadImage) throw e;
    throw new BadImage("decode");
  }
}

/**
 * Validate a provider result. The file is stored byte-for-byte as returned, so any
 * AI-provenance data (C2PA content credentials / watermarks) is preserved.
 */
export async function inspectOutput(input: Buffer): Promise<"jpg" | "png" | "webp"> {
  const meta = await sharp(input, { limitInputPixels: MAX_PIXELS }).metadata();
  if (meta.format === "jpeg") return "jpg";
  if (meta.format === "png") return "png";
  if (meta.format === "webp") return "webp";
  throw new BadImage("output_format");
}

/** Small preview for history grids. */
export async function thumbnail(input: Buffer): Promise<Buffer> {
  return sharp(input).resize({ width: 480, height: 480, fit: "inside" }).webp({ quality: 78 }).toBuffer();
}
