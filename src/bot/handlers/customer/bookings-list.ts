import { prisma } from "@/lib/prisma";
import { sendMessage, makeInlineKeyboard, makeCustomerReplyMenu } from "@/bot/telegram/client";
import { formatJalaliDateTime } from "@/lib/time";
import { BookingStatus } from "@prisma/client";
import type { BotContext } from "@/bot/telegram/client";
import type { Session } from "@/bot/session";
import type { TelegramMessage } from "@/bot/telegram/types";

const STATUS_LABEL: Partial<Record<BookingStatus, string>> = {
  [BookingStatus.PENDING_REVIEW]: "⏳ در انتظار تایید",
  [BookingStatus.APPROVED_AWAITING_DEPOSIT]: "💳 منتظر پرداخت",
  [BookingStatus.PAYMENT_PENDING]: "🔄 پرداخت در جریان",
  [BookingStatus.CONFIRMED]: "✅ تایید شده",
  [BookingStatus.CANCELLATION_REQUESTED]: "⚠️ درخواست لغو",
};

const ACTIVE_STATUSES: BookingStatus[] = [
  BookingStatus.PENDING_REVIEW,
  BookingStatus.APPROVED_AWAITING_DEPOSIT,
  BookingStatus.PAYMENT_PENDING,
  BookingStatus.CONFIRMED,
  BookingStatus.CANCELLATION_REQUESTED,
];

export async function showCustomerBookings(
  ctx: BotContext,
  msg: TelegramMessage,
  session: Session
): Promise<void> {
  const chatId = String(msg.chat.id);

  if (!session.customerId) {
    await sendMessage(ctx, chatId, "برای مشاهده رزروها ابتدا از لینک آرایشگر وارد شو.", {
      reply_markup: makeCustomerReplyMenu(),
    });
    return;
  }

  const bookings = await prisma.booking.findMany({
    where: {
      customerId: session.customerId,
      status: { in: ACTIVE_STATUSES },
    },
    include: { service: true, hairdresser: true },
    orderBy: { requestedStartAt: "asc" },
  });

  if (bookings.length === 0) {
    await sendMessage(ctx, chatId, "رزرو فعالی نداری.", { reply_markup: makeCustomerReplyMenu() });
    return;
  }

  const lines = [`📋 <b>رزروهای فعال (${bookings.length})</b>`, ""];

  const rows: Array<Array<{ text: string; data: string }>> = [];

  for (const b of bookings) {
    const label = STATUS_LABEL[b.status] ?? b.status;
    lines.push(`${label}`);
    lines.push(`✂️ ${b.service.title} — ${b.hairdresser.fullName}`);
    lines.push(`🗓 ${formatJalaliDateTime(b.requestedStartAt)}`);
    lines.push("");

    if (b.status === BookingStatus.APPROVED_AWAITING_DEPOSIT || b.status === BookingStatus.PAYMENT_PENDING) {
      rows.push([{ text: `💳 پرداخت — ${b.service.title}`, data: `cust:payment:pay:${b.id}` }]);
    }
    if (
      b.status === BookingStatus.CONFIRMED ||
      b.status === BookingStatus.APPROVED_AWAITING_DEPOSIT
    ) {
      rows.push([{ text: `❌ لغو — ${b.service.title}`, data: `cust:cancel:request:${b.id}` }]);
    }
  }

  await sendMessage(ctx, chatId, lines.join("\n"), {
    reply_markup: rows.length > 0 ? makeInlineKeyboard(rows) : makeCustomerReplyMenu(),
  });
}
