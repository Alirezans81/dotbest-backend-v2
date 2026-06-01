import type { InlineKeyboardMarkup, ReplyKeyboardMarkup, ReplyKeyboardRemove } from "./types";

export type BotPlatform = "TELEGRAM" | "BALE";

export interface BotContext {
  platform: BotPlatform;
}

type ReplyMarkup = InlineKeyboardMarkup | ReplyKeyboardMarkup | ReplyKeyboardRemove;

interface SendMessageOptions {
  reply_markup?: ReplyMarkup;
  parse_mode?: "HTML" | "Markdown" | "MarkdownV2";
  disable_web_page_preview?: boolean;
}

function getPlatformConfig(platform: BotPlatform): { baseUrl: string; token: string } {
  if (platform === "BALE") {
    return {
      baseUrl: "https://tapi.bale.ai",
      token: process.env.BALE_BOT_TOKEN!,
    };
  }
  return {
    baseUrl: "https://api.telegram.org",
    token: process.env.TELEGRAM_BOT_TOKEN!,
  };
}

async function callBotApi(
  platform: BotPlatform,
  method: string,
  body: Record<string, unknown>
): Promise<unknown> {
  const { baseUrl, token } = getPlatformConfig(platform);
  const url = `${baseUrl}/bot${token}/${method}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json() as { ok: boolean; result?: unknown; description?: string };
  if (!data.ok) {
    console.error(`[${platform}] ${method} failed:`, data.description);
  }
  return data.result;
}

export async function sendMessage(
  ctx: BotContext,
  chatId: string,
  text: string,
  options: SendMessageOptions = {}
): Promise<void> {
  await callBotApi(ctx.platform, "sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: options.parse_mode ?? "HTML",
    disable_web_page_preview: options.disable_web_page_preview ?? true,
    ...(options.reply_markup ? { reply_markup: options.reply_markup } : {}),
  });
}

interface SendMediaOptions {
  caption?: string;
}

export async function sendPhoto(
  ctx: BotContext,
  chatId: string,
  photoFileId: string,
  options: SendMediaOptions = {}
): Promise<void> {
  await callBotApi(ctx.platform, "sendPhoto", {
    chat_id: chatId,
    photo: photoFileId,
    ...(options.caption ? { caption: options.caption } : {}),
  });
}

export async function sendVideo(
  ctx: BotContext,
  chatId: string,
  videoFileId: string,
  options: SendMediaOptions = {}
): Promise<void> {
  await callBotApi(ctx.platform, "sendVideo", {
    chat_id: chatId,
    video: videoFileId,
    ...(options.caption ? { caption: options.caption } : {}),
  });
}

export async function answerCallbackQuery(
  ctx: BotContext,
  callbackQueryId: string,
  text?: string
): Promise<void> {
  await callBotApi(ctx.platform, "answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text,
  });
}

export async function editMessageText(
  ctx: BotContext,
  chatId: string,
  messageId: number,
  text: string,
  options: SendMessageOptions = {}
): Promise<void> {
  await callBotApi(ctx.platform, "editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: options.parse_mode ?? "HTML",
    ...(options.reply_markup ? { reply_markup: options.reply_markup } : {}),
  });
}

export function makeInlineKeyboard(
  rows: Array<Array<{ text: string; data: string }>>
): InlineKeyboardMarkup {
  return {
    inline_keyboard: rows.map((row) =>
      row.map(({ text, data }) => ({ text, callback_data: data }))
    ),
  };
}

export function makeContactKeyboard(): ReplyKeyboardMarkup {
  return {
    keyboard: [[{ text: "📱 ارسال شماره تماس", request_contact: true }]],
    resize_keyboard: true,
    one_time_keyboard: true,
  };
}

export function makeHairdresserReplyMenu(): ReplyKeyboardMarkup {
  return {
    keyboard: [
      [{ text: "📅 نوبت‌های امروز" }, { text: "📆 نوبت‌های آینده" }],
      [{ text: "👥 مشتریان" }, { text: "➕ سرویس جدید" }],
      [{ text: "⚙️ تنظیمات" }, { text: "💰 کیف پول" }],
    ],
    resize_keyboard: true,
    is_persistent: true,
  };
}

export function makeCustomerReplyMenu(): ReplyKeyboardMarkup {
  return {
    keyboard: [
      [{ text: "📋 رزروهای من" }, { text: "💰 کیف پول" }],
    ],
    resize_keyboard: true,
    is_persistent: true,
  };
}

export function makeCancelRow(): Array<{ text: string; callback_data: string }> {
  return [{ text: "❌ لغو", callback_data: "hd:cancel" }];
}

export function removeKeyboard(): ReplyKeyboardRemove {
  return { remove_keyboard: true };
}
