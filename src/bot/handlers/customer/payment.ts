import { prisma } from "@/lib/prisma";
import { sendMessage } from "@/bot/telegram/client";
import { updateSession } from "@/bot/session";
import { CustomerState } from "@/bot/states";
import { initiatePayment } from "@/domain/payment";
import { processPenaltyCancellation, processNopenaltyCancellation } from "@/domain/wallet";
import { BookingStatus } from "@prisma/client";
import { formatJalaliDateTime } from "@/lib/time";
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

    const feeLines: string[] = [
      `💳 بیعانه: ${result.depositAmountToman.toLocaleString()} تومان`,
    ];
    if (result.gatewayFeeToman > 0) {
      feeLines.push(`🏦 کارمزد درگاه پرداخت: ${result.gatewayFeeToman.toLocaleString()} تومان`);
      feeLines.push(`💰 مبلغ قابل پرداخت: ${result.totalAmountToman.toLocaleString()} تومان`);
    }

    await sendMessage(ctx, chatId, feeLines.join("\n"), {
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
    `می‌خوای رزرو «${booking.service.title}» در ${formatJalaliDateTime(booking.requestedStartAt)} رو لغو کنی؟${penaltyMsg}`,
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

  if (hasPaid && booking.depositAmountToman) {
    const { refundToman, penaltyToman } = await processPenaltyCancellation(
      booking.hairdresserId,
      session.customerId!,
      bookingId,
      booking.depositAmountToman
    ).catch(() => ({ refundToman: Math.floor(booking.depositAmountToman! / 2), penaltyToman: Math.ceil(booking.depositAmountToman! / 2) }));

    await sendMessage(
      ctx,
      chatId,
      `رزروت لغو شد.\n💰 ${refundToman.toLocaleString()} تومان به کیف پولت برگشت.`
    );
  } else if (!hasPaid && booking.depositAmountToman) {
    await processNopenaltyCancellation(
      booking.hairdresserId,
      session.customerId!,
      bookingId,
      booking.depositAmountToman
    ).catch(() => {});
    await sendMessage(ctx, chatId, "رزروت بدون جریمه لغو شد.\n💰 مبلغ بیعانه به کیف پولت برگشت.");
  } else {
    await sendMessage(ctx, chatId, "رزروت بدون جریمه لغو شد.");
  }

  await notifyHairdresserCancellation(ctx, booking);
}

async function notifyHairdresserCancellation(
  ctx: BotContext,
  booking: { hairdresser: { telegramChatId: string | null; baleChatId: string | null; notificationChannel: import("@prisma/client").NotificationChannel }; service: { title: string }; requestedStartAt: Date }
): Promise<void> {
  const { notifyHairdresser } = await import("@/bot/notify");
  await notifyHairdresser(
    booking.hairdresser,
    `❌ مشتری رزرو «${booking.service.title}» در ${formatJalaliDateTime(booking.requestedStartAt)} رو لغو کرد.`
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
