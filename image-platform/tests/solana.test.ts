import { describe, it, expect } from "vitest";
import {
  formatUnits,
  usdToBaseUnits,
  amountJitter,
  transferRequestUrl,
  verifyTransfer,
  isValidPublicKey,
  newReference,
  TOKENS,
  type ParsedTx,
} from "../src/server/payments/solana";

const RECIPIENT = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const REF = newReference();
const OTHER = "11111111111111111111111111111111";

function solTx(received: number, keys = [OTHER, RECIPIENT, REF], err: unknown = null): ParsedTx {
  return {
    meta: { err, preBalances: [1e9, 5e8, 0], postBalances: [1e9 - received - 5000, 5e8 + received, 0] },
    transaction: { message: { accountKeys: keys.map((pubkey) => ({ pubkey })) } },
  };
}

function usdcTx(received: string, owner = RECIPIENT, mint = TOKENS.USDC.mint!): ParsedTx {
  return {
    meta: {
      err: null,
      preBalances: [0, 0, 0, 0],
      postBalances: [0, 0, 0, 0],
      preTokenBalances: [{ accountIndex: 2, mint, owner, uiTokenAmount: { amount: "1000000" } }],
      postTokenBalances: [{ accountIndex: 2, mint, owner, uiTokenAmount: { amount: String(1_000_000 + Number(received)) } }],
    },
    transaction: { message: { accountKeys: [OTHER, OTHER, OTHER, REF] } },
  };
}

describe("amounts", () => {
  it("formats base units", () => {
    expect(formatUnits(5_000_000n, 6)).toBe("5");
    expect(formatUnits(5_000_317n, 6)).toBe("5.000317");
    expect(formatUnits(34_120_000n, 9)).toBe("0.03412");
    expect(formatUnits(7n, 6)).toBe("0.000007");
  });

  it("prices stablecoins 1:1 and SOL from price, rounded up", () => {
    expect(usdToBaseUnits(500, "USDC")).toBe(5_000_000n);
    expect(usdToBaseUnits(1000, "USDT")).toBe(10_000_000n);
    const lamports = usdToBaseUnits(500, "SOL", 150);
    expect(lamports).toBeGreaterThanOrEqual(33_333_334n);
    expect(lamports % 10_000n).toBe(0n);
    expect(() => usdToBaseUnits(500, "SOL")).toThrow();
  });

  it("keeps jitter tiny", () => {
    for (const n of [0, 1, 9998, 123456789]) {
      expect(amountJitter("USDC", n)).toBeGreaterThan(0n);
      expect(amountJitter("USDC", n)).toBeLessThan(10_000n); // < $0.01
      expect(amountJitter("SOL", n)).toBeLessThan(1_000_000n); // < 0.001 SOL
    }
  });
});

describe("addresses and URLs", () => {
  it("validates public keys", () => {
    expect(isValidPublicKey(RECIPIENT)).toBe(true);
    expect(isValidPublicKey(REF)).toBe(true);
    expect(isValidPublicKey("not-a-key")).toBe(false);
    expect(isValidPublicKey("0OIl" + RECIPIENT.slice(4))).toBe(false);
  });

  it("builds a Solana Pay URL", () => {
    const url = transferRequestUrl({ recipient: RECIPIENT, amount: "5.000317", token: "USDC", reference: REF, label: "Lumen", message: "16 credits" });
    expect(url.startsWith(`solana:${RECIPIENT}?amount=5.000317&spl-token=${TOKENS.USDC.mint}&reference=${REF}`)).toBe(true);
    expect(url).toContain("message=16%20credits");
  });
});

describe("verifyTransfer", () => {
  const exp = { recipient: RECIPIENT, token: "SOL" as const, amountBase: 1_000_000n, reference: REF };

  it("accepts SOL transfer with reference and enough lamports", () => {
    expect(verifyTransfer(solTx(1_000_000), exp)).toBe(true);
    expect(verifyTransfer(solTx(2_000_000), exp)).toBe(true);
  });
  it("rejects underpayment, failed tx, missing reference", () => {
    expect(verifyTransfer(solTx(999_999), exp)).toBe(false);
    expect(verifyTransfer(solTx(1_000_000, undefined, { InstructionError: [0, "x"] }), exp)).toBe(false);
    expect(verifyTransfer(solTx(1_000_000, [OTHER, RECIPIENT]), exp)).toBe(false);
    expect(verifyTransfer(null, exp)).toBe(false);
  });
  it("exact mode needs the exact amount, no reference", () => {
    expect(verifyTransfer(solTx(1_000_000, [OTHER, RECIPIENT]), exp, "exact")).toBe(true);
    expect(verifyTransfer(solTx(1_000_001, [OTHER, RECIPIENT]), exp, "exact")).toBe(false);
  });

  const uexp = { recipient: RECIPIENT, token: "USDC" as const, amountBase: 5_000_317n, reference: REF };
  it("accepts USDC to recipient's token account", () => {
    expect(verifyTransfer(usdcTx("5000317"), uexp)).toBe(true);
  });
  it("rejects USDC to someone else, wrong mint, or short", () => {
    expect(verifyTransfer(usdcTx("5000317", OTHER), uexp)).toBe(false);
    expect(verifyTransfer(usdcTx("5000317", RECIPIENT, TOKENS.USDT.mint!), uexp)).toBe(false);
    expect(verifyTransfer(usdcTx("5000316"), uexp)).toBe(false);
  });
});
