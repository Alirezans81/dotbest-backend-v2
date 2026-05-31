import { prisma } from "@/lib/prisma";
import type { BotPlatform } from "@/bot/telegram/client";

/**
 * When a hairdresser registers or re-enters on a platform, find their existing
 * record by phone and attach the new platform's IDs to the same row.
 * Returns the hairdresser record (merged or newly-created shell).
 */
export async function syncHairdresserPlatform(
  phoneNumber: string,
  platform: BotPlatform,
  userId: string,
  chatId: string
): Promise<{ id: string; isNew: boolean }> {
  const existing = await prisma.hairdresser.findFirst({
    where: { phoneNumber },
  });

  if (!existing) {
    return { id: "", isNew: true };
  }

  const updateData =
    platform === "BALE"
      ? { baleUserId: userId, baleChatId: chatId }
      : { telegramUserId: userId, telegramChatId: chatId };

  await prisma.hairdresser.update({
    where: { id: existing.id },
    data: updateData,
  });

  return { id: existing.id, isNew: false };
}

/**
 * When a customer shares their phone number on one platform, find an existing
 * record by phone and attach the new platform's IDs.
 * Returns the customer id if a match was found, null otherwise.
 */
export async function syncCustomerPlatform(
  phoneNumber: string,
  platform: BotPlatform,
  userId: string,
  chatId: string
): Promise<string | null> {
  const existing = await prisma.customer.findFirst({
    where: { phoneNumber },
  });

  if (!existing) return null;

  const updateData =
    platform === "BALE"
      ? { baleUserId: userId, baleChatId: chatId }
      : { telegramUserId: userId, telegramChatId: chatId };

  await prisma.customer.update({
    where: { id: existing.id },
    data: updateData,
  });

  return existing.id;
}
