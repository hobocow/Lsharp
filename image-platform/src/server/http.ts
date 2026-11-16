import "server-only";
import { NextResponse } from "next/server";
import { getCurrentUser } from "./auth/sessions";
import { rateLimit } from "./rateLimit";
import { config } from "./config";
import type { UserRow } from "./db";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
  }
}

export const json = (data: unknown, status = 200) =>
  NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd?.split(",")[0] ?? req.headers.get("x-real-ip") ?? "unknown").trim();
}

/** Block cross-site state-changing requests (defence in depth on top of SameSite cookies). */
export function assertSameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin) return; // same-origin fetches from older browsers may omit it; SameSite=Lax still applies
  let expected: string;
  try {
    expected = new URL(config.appUrl).origin;
  } catch {
    return;
  }
  if (origin !== expected && origin !== new URL(req.url).origin) throw new ApiError(403, "bad_origin");
}

export async function requireUser(): Promise<UserRow> {
  const user = await getCurrentUser();
  if (!user) throw new ApiError(401, "unauthorized");
  return user;
}

export function limit(key: string, max: number, windowMs: number) {
  if (!rateLimit(key, max, windowMs)) throw new ApiError(429, "rate_limited");
}

/** Wraps a route handler: converts ApiError into JSON, hides internal errors. */
export function handler<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err instanceof ApiError) return json({ error: err.code }, err.status);
      console.error("[api] unhandled error", err);
      return json({ error: "server_error" }, 500);
    }
  };
}
