import { sendMessage } from "@/bot/telegram/client";
import { NotificationChannel } from "@prisma/client";
import type { InlineKeyboardMarkup, ReplyKeyboardMarkup, ReplyKeyboardRemove } from "@/bot/telegram/types";

type ReplyMarkup = InlineKeyboardMarkup | ReplyKeyboardMarkup | ReplyKeyboardRemove;

interface NotifyOptions {
  reply_markup?: ReplyMarkup;
  parse_mode?: "HTML" | "Markdown";
}

interface HairdresserTarget {
  telegramChatId: string | null;
  baleChatId: string | null;
  notificationChannel: NotificationChannel;
}

interface CustomerTarget {
  telegramChatId: string | null;
  baleChatId: string | null;
  notificationChannel: NotificationChannel;
}

async function sendToChannels(
  target: { telegramChatId: string | null; baleChatId: string | null; notificationChannel: NotificationChannel },
  text: string,
  options: NotifyOptions = {}
): Promise<void> {
  const channel = target.notificationChannel;
  const promises: Promise<void>[] = [];

  if (
    (channel === NotificationChannel.TELEGRAM_ONLY || channel === NotificationChannel.BOTH) &&
    target.telegramChatId
  ) {
    promises.push(
      sendMessage({ platform: "TELEGRAM" }, target.telegramChatId, text, options)
    );
  }

  if (
    (channel === NotificationChannel.BALE_ONLY || channel === NotificationChannel.BOTH) &&
    target.baleChatId
  ) {
    promises.push(
      sendMessage({ platform: "BALE" }, target.baleChatId, text, options)
    );
  }

  // Fallback: if preferred platform chatId is missing, try the other
  if (promises.length === 0) {
    if (target.telegramChatId) {
      promises.push(sendMessage({ platform: "TELEGRAM" }, target.telegramChatId, text, options));
    } else if (target.baleChatId) {
      promises.push(sendMessage({ platform: "BALE" }, target.baleChatId, text, options));
    }
  }

  await Promise.allSettled(promises);
}

export async function notifyHairdresser(
  hairdresser: HairdresserTarget,
  text: string,
  options: NotifyOptions = {}
): Promise<void> {
  await sendToChannels(hairdresser, text, options);
}

export async function notifyCustomer(
  customer: CustomerTarget,
  text: string,
  options: NotifyOptions = {}
): Promise<void> {
  await sendToChannels(customer, text, options);
}
