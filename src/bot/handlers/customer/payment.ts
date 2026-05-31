import { prisma } from "@/lib/prisma";
import { sendMessage } from "@/bot/telegram/client";
import { updateSession } from "@/bot/session";
import { CustomerState } from "@/bot/states";
import { initiatePayment } from "@/domain/payment";
import { BookingStatus } from "@prisma/client";
import { formatTehranDateTime } from "@/lib/time";
import type { BotContext } from "@/bot/telegram/client";
import type { Session } from "@/bot/session";
import type { TelegramCallbackQuery } from "@/bot/telegram/types";

export async function handleCustomerPayCallback(
  ctx: BotContext,
  query: TelegramCallbackQuery,
  session: Session,
  bookingId: string
): Promise<void> {
  const chatId = String(query.message!.chat.id);

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { service: true },
  });

  if (!booking) {
    await sendMessage(ctx, chatId, "رزرو یافت نشد.");
    return;
  }

  if (
    booking.status !== BookingStatus.APPROVED_AWAITING_DEPOSIT &&
    booking.status !== BookingStatus.PAYMENT_PENDING
  ) {
    await sendMessage(ctx, chatId, "وضعیت رزرو برای پرداخت مناسب نیست.");
    return;
  }

  try {
    const result = await initiatePayment(bookingId);
    await updateSession(chatId, CustomerState.WAIT_PAYMENT, { activePaymentIntentId: result.paymentIntentId });
    await sendMessage(ctx, chatId, "برای پرداخت بیعانه روی دکمه زیر بزن:", {
      reply_markup: {
        inline_keyboard: [[{ text: "💳 پرداخت آنلاین", url: result.redirectUrl }]],
      },
    });
  } catch (err) {
    console.error("[Payment] initiate error:", err);
    await sendMessage(ctx, chatId, "مشکلی در ایجاد لینک پرداخت پیش اومد. دوباره امتحان کن.");
  }
}

export async function handleCustomerCancelRequest(
  ctx: BotContext,
  query: TelegramCallbackQuery,
  session: Session,
  bookingId: string
): Promise<void> {
  const chatId = String(query.message!.chat.id);

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { service: true },
  });

  if (!booking) {
    await sendMessage(ctx, chatId, "رزرو یافت نشد.");
    return;
  }

  const cancelable: BookingStatus[] = [
    BookingStatus.APPROVED_AWAITING_DEPOSIT,
    BookingStatus.PAYMENT_PENDING,
    BookingStatus.CONFIRMED,
  ];

  if (!cancelable.includes(booking.status)) {
    await sendMessage(ctx, chatId, "این رزرو قابل لغو نیست.");
    return;
  }

  const isPaid =
    booking.status === BookingStatus.CONFIRMED ||
    booking.status === BookingStatus.PAYMENT_PENDING;

  const penaltyMsg = isPaid
    ? `\n⚠️ چون پرداخت انجام شده، ۵۰٪ بیعانه (${Math.floor(booking.depositAmountToman! / 2).toLocaleString()} تومان) کسر می‌شه.`
    : "";

  await updateSession(chatId, CustomerState.WAIT_CANCELLATION_CONFIRM);
  await sendMessage(
    ctx,
    chatId,
    `می‌خوای رزرو «${booking.service.title}» در ${formatTehranDateTime(booking.requestedStartAt)} رو لغو کنی؟${penaltyMsg}`,
    {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "بله، لغو کن", callback_data: `cust:cancel:confirm:${bookingId}` },
            { text: "نه، برگشت", callback_data: `cust:cancel:abort:${bookingId}` },
          ],
        ],
      },
    }
  );
}

export async function handleCustomerCancelConfirm(
  ctx: BotContext,
  query: TelegramCallbackQuery,
  session: Session,
  bookingId: string
): Promise<void> {
  const chatId = String(query.message!.chat.id);

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { hairdresser: true, service: true },
  });

  if (!booking) {
    await sendMessage(ctx, chatId, "رزرو یافت نشد.");
    return;
  }

  const hasPaid =
    booking.status === BookingStatus.CONFIRMED ||
    booking.status === BookingStatus.PAYMENT_PENDING;

  await prisma.booking.update({
    where: { id: bookingId },
    data: {
      status: hasPaid ? BookingStatus.CANCELLED_WITH_PENALTY : BookingStatus.CANCELLED_WITHOUT_PENALTY,
      cancelledAt: new Date(),
    },
  });

  await updateSession(chatId, CustomerState.IDLE, {});

  if (hasPaid) {
    const refund = Math.floor(booking.depositAmountToman! / 2);
    await sendMessage(ctx, chatId, `رزروت لغو شد.\n${refund.toLocaleString()} تومان قابل برگشته.`);
  } else {
    await sendMessage(ctx, chatId, "رزروت بدون جریمه لغو شد.");
  }

  await sendMessage(
    ctx,
    booking.hairdresser.telegramChatId,
    `❌ مشتری رزرو «${booking.service.title}» در ${formatTehranDateTime(booking.requestedStartAt)} رو لغو کرد.`
  );
}

export async function handleCustomerCancelAbort(
  ctx: BotContext,
  query: TelegramCallbackQuery,
  session: Session
): Promise<void> {
  const chatId = String(query.message!.chat.id);
  await updateSession(chatId, CustomerState.IDLE, {});
  await sendMessage(ctx, chatId, "لغو انجام نشد. رزرو پابرجاست.");
}
