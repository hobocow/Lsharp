import "server-only";
import sharp from "sharp";
import type { EditRequest, EditResult, ImageEditProvider } from "./types";
import { ProviderError } from "./types";

/** Local stand-in for development and demos: makes a visible edit after a short delay. */
export class MockProvider implements ImageEditProvider {
  async edit(req: EditRequest): Promise<EditResult> {
    await new Promise((r) => setTimeout(r, 2500));
    if (/\bfail\b/i.test(req.prompt)) throw new ProviderError("failed", "mock failure");
    if (/\breject\b/i.test(req.prompt)) throw new ProviderError("rejected", "mock rejection");
    const image = await sharp(req.image).modulate({ saturation: 1.35, brightness: 1.05 }).tint({ r: 255, g: 236, b: 214 }).jpeg({ quality: 90 }).toBuffer();
    return { image, ref: "mock" };
  }
}
