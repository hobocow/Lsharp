import "server-only";
import { config } from "../config";
import { ProviderError, type EditRequest, type EditResult, type ImageEditProvider } from "./types";

/**
 * FIBO image-edit adapter.
 *
 * VERIFY AGAINST THE LIVE API: written from the public v2 docs without network
 * access to them. The request/response shapes are isolated in `buildBody` and
 * `extractResult` so they're quick to adjust.
 *  - POST {base}/image/edit, header `api_token`
 *  - async by default: returns { request_id, status_url }, then poll status_url
 *  - status: IN_PROGRESS -> COMPLETED (result.image_url) | ERROR
 */
const POLL_INTERVAL_MS = 1500;
const TIMEOUT_MS = 150_000;
const MAX_RESULT_BYTES = 30 * 1024 * 1024;

type Json = Record<string, unknown>;

function buildBody(req: EditRequest): Json {
  const body: Json = {
    images: [req.image.toString("base64")],
    instruction: req.prompt,
    sync: false,
    // Use the provider's built-in content moderation on input and output.
    prompt_content_moderation: true,
    visual_input_content_moderation: true,
    visual_output_content_moderation: true,
  };
  if (config.providerModelVersion) body.model_version = config.providerModelVersion;
  return body;
}

function extractResult(data: Json): { imageUrl?: string; status?: string; statusUrl?: string; requestId?: string } {
  const result = (data.result ?? {}) as Json;
  const imageUrl =
    (result.image_url as string) ??
    (Array.isArray(result.urls) ? (result.urls[0] as string) : undefined) ??
    (data.image_url as string);
  return {
    imageUrl: typeof imageUrl === "string" ? imageUrl : undefined,
    status: typeof data.status === "string" ? data.status.toUpperCase() : undefined,
    statusUrl: typeof data.status_url === "string" ? data.status_url : undefined,
    requestId: typeof data.request_id === "string" ? data.request_id : undefined,
  };
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(t), reject(new ProviderError("timeout"))), { once: true });
  });

function classify(status: number, body: string): ProviderError {
  if (status === 400 || status === 422) return new ProviderError("rejected", `${status} ${body.slice(0, 300)}`);
  if (status === 408 || status === 504) return new ProviderError("timeout", `${status}`);
  if (status === 401 || status === 403) {
    console.error("[provider] auth failed: check PROVIDER_API_KEY");
    return new ProviderError("unavailable", `${status}`);
  }
  return new ProviderError("unavailable", `${status} ${body.slice(0, 300)}`);
}

export class BriaProvider implements ImageEditProvider {
  async edit(req: EditRequest): Promise<EditResult> {
    const base = config.providerBaseUrl;
    const baseHost = new URL(base).host;
    const headers = { api_token: config.providerApiKey, "Content-Type": "application/json", Accept: "application/json" };
    const deadline = AbortSignal.any([AbortSignal.timeout(TIMEOUT_MS), ...(req.signal ? [req.signal] : [])]);

    let res: Response;
    try {
      res = await fetch(`${base}/image/edit`, { method: "POST", headers, body: JSON.stringify(buildBody(req)), signal: deadline });
    } catch {
      throw new ProviderError(deadline.aborted ? "timeout" : "unavailable");
    }
    const text = await res.text();
    if (!res.ok && res.status !== 202) throw classify(res.status, text);

    let data: Json;
    try {
      data = JSON.parse(text);
    } catch {
      throw new ProviderError("failed", "non-json response");
    }
    let r = extractResult(data);
    const ref = r.requestId;

    // Async: poll the status URL (only ever on the provider's own host).
    while (!r.imageUrl) {
      if (r.status === "ERROR" || r.status === "FAILED") throw new ProviderError("failed", JSON.stringify(data).slice(0, 300));
      if (!r.statusUrl) throw new ProviderError("failed", "no result and no status_url");
      if (new URL(r.statusUrl).host !== baseHost) throw new ProviderError("failed", "unexpected status host");
      await sleep(POLL_INTERVAL_MS, deadline);
      const statusUrl = r.statusUrl;
      let s: Response;
      try {
        s = await fetch(statusUrl, { headers, signal: deadline });
      } catch {
        throw new ProviderError(deadline.aborted ? "timeout" : "unavailable");
      }
      const st = await s.text();
      if (!s.ok && s.status !== 202) throw classify(s.status, st);
      try {
        data = JSON.parse(st);
      } catch {
        throw new ProviderError("failed", "non-json status");
      }
      r = { ...extractResult(data), statusUrl: extractResult(data).statusUrl ?? statusUrl };
    }

    const imageUrl = new URL(r.imageUrl);
    if (imageUrl.protocol !== "https:") throw new ProviderError("failed", "insecure result url");
    let img: Response;
    try {
      img = await fetch(imageUrl, { signal: deadline });
    } catch {
      throw new ProviderError(deadline.aborted ? "timeout" : "unavailable");
    }
    if (!img.ok) throw new ProviderError("failed", `result download ${img.status}`);
    const buf = Buffer.from(await img.arrayBuffer());
    if (buf.length === 0 || buf.length > MAX_RESULT_BYTES) throw new ProviderError("failed", "bad result size");
    return { image: buf, ref };
  }
}
