// Shared between server and client. Prices are in US cents.
// Provider cost is ~$0.032 per edit; list price is ~$0.31 per edit.
export const CREDITS_PER_EDIT = 1;

export type Pack = { id: string; credits: number; usdCents: number; label: string; badge?: string };

export const PACKS: Pack[] = [
  { id: "p5", credits: 16, usdCents: 500, label: "Starter" },
  { id: "p10", credits: 34, usdCents: 1000, label: "Standard" },
  { id: "p25", credits: 90, usdCents: 2500, label: "Plus", badge: "Popular" },
  { id: "p50", credits: 190, usdCents: 5000, label: "Pro", badge: "Best value" },
];

export const findPack = (id: string) => PACKS.find((p) => p.id === id);

export const formatUsd = (cents: number) => `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
export const perImage = (p: Pack) => `$${(p.usdCents / 100 / p.credits).toFixed(2)}`;
