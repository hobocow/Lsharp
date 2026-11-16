import "server-only";
import { config } from "../config";
import { BriaProvider } from "./bria";
import { MockProvider } from "./mock";
import type { ImageEditProvider } from "./types";

export * from "./types";

// Add more models/providers here later; callers only see ImageEditProvider.
export function getEditProvider(): ImageEditProvider {
  return config.providerMock ? new MockProvider() : new BriaProvider();
}
