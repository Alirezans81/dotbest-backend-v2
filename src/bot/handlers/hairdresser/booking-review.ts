import { prisma } from "@/lib/prisma";
import { sendMessage } from "@/bot/telegram/client";
import { notifyCustomer } from "@/bot/notify";
import { updateSession, mergeSessionPayload } from "@/bot/session";
import { HairdresserState } from "@/bot/states";
import { BookingStatus } from "@prisma/client";
import { formatTehranDateTime } from "@/lib/time";
import type { BotContext } from "@/bot/telegram/client";
import type { Session } from "@/bot/session";
import type { TelegramCallbackQuery, TelegramMessage } from "@/bot/telegram/types";

export async function handleBookingApproveCallback(
  ctx: BotContext,
  query: TelegramCallbackQuery,
  session: Session,
  bookingId: string
): Promise<void> {
  const chatId = String(query.message!.chat.id);

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { service: true, customer: true },
  });

  if (!booking || booking.status !== BookingStatus.PENDING_REVIEW) {
    await sendMessage(ctx, chatId, "این رزرو دیگه در وضعیت بررسی نیست.");
    return;
  }

  await mergeSessionPayload(chatId, { targetBookingId: bookingId });
  await updateSession(chatId, HairdresserState.WAIT_APPROVAL_QUOTE_MIN);
  await sendMessage(ctx, chatId, `تایید رزرو «${booking.service.title}» برای ${booking.customer.fullName}\n\nحداقل قیمت نهایی (تومان) رو بنویس:`);
}

export async function handleApprovalQuoteMin(
  ctx: BotContext,
  msg: TelegramMessage,
  session: Session
): Promise<void> {
  const chatId = String(msg.chat.id);
  const price = parseInt(msg.text?.trim().replace(/,/g, "") ?? "", 10);

  if (isNaN(price) || price < 0) {
    await sendMessage(ctx, chatId, "قیمت باید عدد مثبت باشه:");
    return;
  }

  await mergeSessionPayload(chatId, { draftQuoteMinToman: price });
  await updateSession(chatId, HairdresserState.WAIT_APPROVAL_QUOTE_MAX);
  await sendMessage(ctx, chatId, "حداکثر قیمت نهایی (تومان):");
}

export async function handleApprovalQuoteMax(
  ctx: BotContext,
  msg: TelegramMessage,
  session: Session
): Promise<void> {
  const chatId = String(msg.chat.id);
  const payload = session.payload as { draftQuoteMinToman?: number };
  const priceMax = parseInt(msg.text?.trim().replace(/,/g, "") ?? "", 10);

  if (isNaN(priceMax) || priceMax < 0) {
    await sendMessage(ctx, chatId, "قیمت باید عدد مثبت باشه:");
    return;
  }

  const priceMin = payload.draftQuoteMinToman ?? 0;
  if (priceMax < priceMin) {
    await sendMessage(ctx, chatId, `حداکثر نمی‌تونه کمتر از حداقل (${priceMin.toLocaleString()}) باشه:`);
    return;
  }

  await mergeSessionPayload(chatId, { draftQuoteMaxToman: priceMax });
  await updateSession(chatId, HairdresserState.WAIT_APPROVAL_DEPOSIT);
  await sendMessage(ctx, chatId, "مبلغ بیعانه (تومان) چقدره؟");
}

export async function handleApprovalDeposit(
  ctx: BotContext,
  msg: TelegramMessage,
  session: Session
): Promise<void> {
  const chatId = String(msg.chat.id);
  const payload = session.payload as {
    targetBookingId?: string;
    draftQuoteMinToman?: number;
    draftQuoteMaxToman?: number;
  };
  const deposit = parseInt(msg.text?.trim().replace(/,/g, "") ?? "", 10);

  if (isNaN(deposit) || deposit <= 0) {
    await sendMessage(ctx, chatId, "بیعانه باید عدد مثبت باشه:");
    return;
  }

  const quoteMax = payload.draftQuoteMaxToman ?? 0;
  if (deposit > quoteMax) {
    await sendMessage(ctx, chatId, `بیعانه نمی‌تونه بیشتر از حداکثر قیمت (${quoteMax.toLocaleString()}) باشه:`);
    return;
  }

  if (!payload.targetBookingId || !payload.draftQuoteMinToman || !payload.draftQuoteMaxToman) {
    await sendMessage(ctx, chatId, "مشکلی پیش اومد. دوباره امتحان کن.");
    await updateSession(chatId, HairdresserState.IDLE, {});
    return;
  }

  await prisma.booking.update({
    where: { id: payload.targetBookingId },
    data: {
      status: BookingStatus.APPROVED_AWAITING_DEPOSIT,
      quotedMinPriceToman: payload.draftQuoteMinToman,
      quotedMaxPriceToman: payload.draftQuoteMaxToman,
      depositAmountToman: deposit,
      approvedAt: new Date(),
    },
  });

  await updateSession(chatId, HairdresserState.IDLE, {});
  await sendMessage(ctx, chatId, "✅ رزرو تایید شد! مشتری لینک پرداخت رو دریافت می‌کنه.");

  await notifyCustomerApproved(ctx, payload.targetBookingId);
}

export async function handleBookingRejectCallback(
  ctx: BotContext,
  query: TelegramCallbackQuery,
  session: Session,
  bookingId: string
): Promise<void> {
  const chatId = String(query.message!.chat.id);

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { customer: true, service: true },
  });

  if (!booking || booking.status !== BookingStatus.PENDING_REVIEW) {
    await sendMessage(ctx, chatId, "این رزرو دیگه در وضعیت بررسی نیست.");
    return;
  }

  await mergeSessionPayload(chatId, { targetBookingId: bookingId });
  await updateSession(chatId, HairdresserState.WAIT_REJECTION_REASON);
  await sendMessage(ctx, chatId, `رد رزرو «${booking.service.title}» برای ${booking.customer.fullName}\n\nدلیل رد (اختیاری) رو بنویس یا "رد" بزن:`);
}

export async function handleRejectionReason(
  ctx: BotContext,
  msg: TelegramMessage,
  session: Session
): Promise<void> {
  const chatId = String(msg.chat.id);
  const payload = session.payload as { targetBookingId?: string };

  if (!payload.targetBookingId) {
    await sendMessage(ctx, chatId, "مشکلی پیش اومد. دوباره امتحان کن.");
    await updateSession(chatId, HairdresserState.IDLE, {});
    return;
  }

  const reason = msg.text?.trim();
  const effectiveReason = (reason && reason !== "رد") ? reason : null;

  await prisma.booking.update({
    where: { id: payload.targetBookingId },
    data: { status: BookingStatus.REJECTED, rejectionReason: effectiveReason },
  });

  await updateSession(chatId, HairdresserState.IDLE, {});
  await sendMessage(ctx, chatId, "رزرو رد شد. مشتری اطلاع‌رسانی می‌شه.");
  await notifyCustomerRejected(ctx, payload.targetBookingId);
}

async function notifyCustomerApproved(_ctx: BotContext, bookingId: string): Promise<void> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { customer: true, service: true },
  });
  if (!booking) return;

  await notifyCustomer(
    booking.customer,
    [
      "✅ <b>رزروت تایید شد!</b>",
      "",
      `✂️ سرویس: ${booking.service.title}`,
      `🕐 زمان: ${formatTehranDateTime(booking.requestedStartAt)}`,
      `💰 قیمت: ${booking.quotedMinPriceToman!.toLocaleString()} - ${booking.quotedMaxPriceToman!.toLocaleString()} تومان`,
      `💳 بیعانه: ${booking.depositAmountToman!.toLocaleString()} تومان`,
      "",
      "برای نهایی کردن رزرو، بیعانه رو پرداخت کن:",
    ].join("\n"),
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: "💳 پرداخت بیعانه", callback_data: `cust:payment:pay:${bookingId}` }],
        ],
      },
    }
  );
}

async function notifyCustomerRejected(_ctx: BotContext, bookingId: string): Promise<void> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { customer: true },
  });
  if (!booking) return;

  await notifyCustomer(
    booking.customer,
    "❌ درخواست رزرو در این زمان تایید نشد.\n\nلطفاً زمان دیگه‌ای رو انتخاب کن."
  );
}
