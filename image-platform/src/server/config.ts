import "server-only";

// Config is read lazily so `next build` works without secrets present.
function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable ${name}`);
  return v;
}
const optional = (name: string, fallback = "") => process.env[name] || fallback;

export const config = {
  get appUrl() {
    return required("APP_URL").replace(/\/+$/, "");
  },
  get appName() {
    return optional("APP_NAME", "Lumen");
  },
  get databaseUrl() {
    return required("DATABASE_URL");
  },
  get storageDir() {
    return optional("STORAGE_DIR", "./data/images");
  },
  get botToken() {
    return required("TELEGRAM_BOT_TOKEN");
  },
  get botUsername() {
    return optional("TELEGRAM_BOT_USERNAME");
  },
  get webhookSecret() {
    return required("TELEGRAM_WEBHOOK_SECRET");
  },
  get providerMock() {
    return optional("PROVIDER_MOCK") === "1";
  },
  get providerApiKey() {
    return required("PROVIDER_API_KEY");
  },
  get providerBaseUrl() {
    return optional("PROVIDER_BASE_URL", "https://engine.prod.bria-api.com/v2").replace(/\/+$/, "");
  },
  get providerModelVersion() {
    return optional("PROVIDER_MODEL_VERSION");
  },
  get solanaRecipient() {
    return required("SOLANA_RECIPIENT");
  },
  get solanaRpcUrl() {
    return optional("SOLANA_RPC_URL", "https://api.mainnet-beta.solana.com");
  },
  get solanaTokens(): string[] {
    return optional("SOLANA_TOKENS", "SOL,USDC,USDT")
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
  },
  get freeStarterCredits() {
    return Math.max(0, parseInt(optional("FREE_STARTER_CREDITS", "0"), 10) || 0);
  },
  get isProd() {
    return process.env.NODE_ENV === "production";
  },
};
