import "server-only";
import { Bot, InlineKeyboard } from "grammy";
import { config } from "./config";
import { upsertTelegramUser, createLoginLink, revokeAllForTelegramId } from "./auth/sessions";
import { rateLimit } from "./rateLimit";

let bot: Bot | null = null;

export function getBot(): Bot {
  if (bot) return bot;
  const b = new Bot(config.botToken);
  const name = config.appName;

  const appKeyboard = () =>
    new InlineKeyboard().webApp(`Open ${name}`, config.appUrl).row().text("Open in browser instead", "browser_link");

  // Everything is private-chat only: login links must never land in a group.
  b.use(async (ctx, next) => {
    if (ctx.chat && ctx.chat.type !== "private") return;
    await next();
  });

  b.command("start", async (ctx) => {
    if (!ctx.from || ctx.from.is_bot) return;
    const user = await upsertTelegramUser(ctx.from);
    if (user.is_banned) return ctx.reply("This account is not available.");
    await ctx.reply(
      `Welcome to ${name}.\n\nUpload a photo, describe the change, and get a high-quality edit in seconds.\n\nBalance: ${user.credits} credits.`,
      { reply_markup: appKeyboard() },
    );
  });

  b.command("app", (ctx) => ctx.reply(`Tap to open ${name}.`, { reply_markup: appKeyboard() }));

  b.command("balance", async (ctx) => {
    if (!ctx.from) return;
    const user = await upsertTelegramUser(ctx.from);
    await ctx.reply(`Balance: ${user.credits} credits.`, { reply_markup: appKeyboard() });
  });

  b.command("logout", async (ctx) => {
    if (!ctx.from) return;
    await revokeAllForTelegramId(ctx.from.id);
    await ctx.reply("Signed out everywhere. All open sessions and unused links were revoked.");
  });

  b.callbackQuery("browser_link", async (ctx) => {
    if (!rateLimit(`link:${ctx.from.id}`, 5, 10 * 60_000)) {
      return ctx.answerCallbackQuery({ text: "Too many links requested. Try again in a few minutes.", show_alert: true });
    }
    const user = await upsertTelegramUser(ctx.from);
    if (user.is_banned) return ctx.answerCallbackQuery();
    const link = await createLoginLink(user.id);
    await ctx.answerCallbackQuery();
    await ctx.reply(
      "Your private sign-in link. It works once and expires in 5 minutes.\nDo not forward it: anyone who opens it first gets into your account.",
      {
        reply_markup: new InlineKeyboard().url("Sign in", link),
        link_preview_options: { is_disabled: true },
        protect_content: true,
      },
    );
  });

  b.catch((err) => console.error("[bot] error", err.error));
  bot = b;
  return b;
}
