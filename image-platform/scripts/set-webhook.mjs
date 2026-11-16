// One-time setup after deploy: registers the webhook, commands and menu button.
// Usage: APP_URL=... TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... npm run bot:set-webhook
const { APP_URL, TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, APP_NAME = "Lumen" } = process.env;
if (!APP_URL || !TELEGRAM_BOT_TOKEN || !TELEGRAM_WEBHOOK_SECRET) {
  console.error("APP_URL, TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET are required");
  process.exit(1);
}
const api = (method, body) =>
  fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => r.json());

const base = APP_URL.replace(/\/+$/, "");
console.log(
  "setWebhook",
  await api("setWebhook", {
    url: `${base}/api/telegram/webhook`,
    secret_token: TELEGRAM_WEBHOOK_SECRET,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: true,
  }),
);
console.log(
  "setMyCommands",
  await api("setMyCommands", {
    commands: [
      { command: "start", description: `Open ${APP_NAME}` },
      { command: "balance", description: "Show credit balance" },
      { command: "logout", description: "Sign out on all devices" },
    ],
  }),
);
console.log(
  "setChatMenuButton",
  await api("setChatMenuButton", { menu_button: { type: "web_app", text: "Open", web_app: { url: base } } }),
);
