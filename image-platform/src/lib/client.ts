"use client";

export class HttpError extends Error {
  constructor(public status: number, public code: string) {
    super(code);
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { credentials: "same-origin", ...init });
  } catch {
    throw new HttpError(0, "network");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(res.status, (data as { error?: string }).error ?? "server_error");
  return data as T;
}

export const postJson = <T,>(path: string, body: unknown) =>
  api<T>(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

// ---- Telegram Mini App bridge (no-ops in a normal browser) ----
type TgWebApp = {
  initData: string;
  colorScheme?: "light" | "dark";
  ready(): void;
  expand(): void;
  setHeaderColor?(c: string): void;
  setBackgroundColor?(c: string): void;
  openLink?(url: string): void;
  downloadFile?(p: { url: string; file_name: string }, cb?: (ok: boolean) => void): void;
  HapticFeedback?: { impactOccurred(s: "light" | "medium"): void; notificationOccurred(s: "success" | "error"): void };
  isVersionAtLeast?(v: string): boolean;
};
export const tg = (): TgWebApp | null =>
  typeof window !== "undefined" ? ((window as unknown as { Telegram?: { WebApp?: TgWebApp } }).Telegram?.WebApp ?? null) : null;
export const inTelegram = () => Boolean(tg()?.initData);

export function haptic(kind: "light" | "success" | "error") {
  const h = tg()?.HapticFeedback;
  if (!h) return;
  if (kind === "light") h.impactOccurred("light");
  else h.notificationOccurred(kind);
}

/** Download a same-origin image, using Telegram's native download inside the Mini App. */
export function downloadImage(url: string, filename: string) {
  const t = tg();
  const abs = new URL(`${url}?download=1`, window.location.href).toString();
  if (t?.initData && t.downloadFile && t.isVersionAtLeast?.("8.0")) {
    t.downloadFile({ url: abs, file_name: filename });
    return;
  }
  const a = document.createElement("a");
  a.href = abs;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Shrink big photos on the device before upload: faster on mobile data. Falls back to the original file. */
export async function prepareUpload(file: File): Promise<Blob> {
  try {
    if (file.size < 1.5 * 1024 * 1024) return file;
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const max = 2048;
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.92));
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}

export const ERRORS: Record<string, string> = {
  insufficient_credits: "You're out of credits. Top up to keep editing.",
  invalid_image: "That file doesn't look like a photo. Try a JPG, PNG or HEIC.",
  image_too_large: "That photo is too large. The limit is 12 MB.",
  image_required: "Add a photo first.",
  prompt_required: "Describe the edit you want.",
  prompt_too_long: "That description is a bit long. Keep it under 1000 characters.",
  too_many_in_progress: "You already have edits running. Give them a moment.",
  rate_limited: "You're going a little fast. Try again in a minute.",
  rejected: "This request couldn't be processed. Try a different photo or description. Your credit was refunded.",
  failed: "The edit didn't go through. Your credit was refunded.",
  unavailable: "The service is busy right now. Your credit was refunded. Please try again shortly.",
  timeout: "That took too long. Your credit was refunded. Please try again.",
  price_unavailable: "Couldn't get a SOL price right now. Try USDC, or try again shortly.",
  network: "You seem to be offline. Check your connection.",
  unauthorized: "Your session ended. Reopen the app from Telegram.",
  server_error: "Something went wrong. Please try again.",
};
export const errorText = (code: string) => ERRORS[code] ?? ERRORS.server_error;
