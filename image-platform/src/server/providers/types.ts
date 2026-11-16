export type EditRequest = {
  /** Sanitized JPEG of the user's upload. */
  image: Buffer;
  prompt: string;
  signal?: AbortSignal;
};

export type EditResult = { image: Buffer; ref?: string };

/**
 * Error codes are generic on purpose: they are the only thing that reaches the
 * browser, so they never reveal which provider/model is behind the service.
 */
export type ProviderErrorCode = "rejected" | "unavailable" | "timeout" | "failed";

export class ProviderError extends Error {
  constructor(public code: ProviderErrorCode, detail?: string) {
    super(detail ?? code);
  }
}

export interface ImageEditProvider {
  edit(req: EditRequest): Promise<EditResult>;
}
