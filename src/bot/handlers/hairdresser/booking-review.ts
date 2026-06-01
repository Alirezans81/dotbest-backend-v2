import { prisma } from "@/lib/prisma";
import { sendMessage, sendPhoto, sendVideo, makeInlineKeyboard, makeHairdresserReplyMenu } from "@/bot/telegram/client";
import { notifyCustomer } from "@/bot/notify";
import { updateSession, mergeSessionPayload } from "@/bot/session";
import { HairdresserState } from "@/bot/states";
import { BookingStatus, BookingAttachmentType } from "@prisma/client";
import { formatJalaliDateTime } from "@/lib/time";
import { rejectConflictingBookings } from "@/bot/handlers/customer/booking";
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
    include: { service: true, customer: true, attachments: true },
  });

  if (!booking || booking.status !== BookingStatus.PENDING_REVIEW) {
    await sendMessage(ctx, chatId, "این رزرو دیگه در وضعیت بررسی نیست.");
    return;
  }

  const lines = [
    `✅ تایید رزرو`,
    "",
    `👤 مشتری: ${booking.customer.fullName}`,
    booking.customer.phoneNumber ? `📞 ${booking.customer.phoneNumber}` : "",
    `✂️ سرویس: ${booking.service.title} (${booking.service.durationMinutes} دقیقه)`,
    `🗓 زمان: ${formatJalaliDateTime(booking.requestedStartAt)}`,
    `💰 بازه قیمت سرویس: ${booking.service.priceMinToman.toLocaleString()} - ${booking.service.priceMaxToman.toLocaleString()} تومان`,
    booking.customerDescription ? `📝 توضیحات: ${booking.customerDescription}` : "",
    booking.attachments.length > 0 ? `📎 فایل‌های پیوست: ${booking.attachments.length}` : "",
    "",
    "حداقل قیمت نهایی (تومان) رو بنویس:",
  ].filter(Boolean);

  await mergeSessionPayload(chatId, { targetBookingId: bookingId });
  await updateSession(chatId, HairdresserState.WAIT_APPROVAL_QUOTE_MIN);

  const buttons: Array<Array<{ text: string; data: string }>> = [];
  if (booking.attachments.length > 0 || booking.customerDescription) {
    buttons.push([{ text: "📎 مشاهده توضیحات و فایل‌ها", data: `hd:booking:attachments:${bookingId}` }]);
  }
  buttons.push([{ text: "❌ لغو", data: "hd:cancel" }]);

  await sendMessage(ctx, chatId, lines.join("\n"), {
    reply_markup: makeInlineKeyboard(buttons),
  });
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
  await sendMessage(ctx, chatId, "حداکثر قیمت نهایی (تومان):", {
    reply_markup: makeInlineKeyboard([[{ text: "❌ لغو", data: "hd:cancel" }]]),
  });
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
  await sendMessage(ctx, chatId, "مبلغ بیعانه (تومان) چقدره؟", {
    reply_markup: makeInlineKeyboard([[{ text: "❌ لغو", data: "hd:cancel" }]]),
  });
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

  if (isNaN(deposit) || deposit < 0) {
    await sendMessage(ctx, chatId, "بیعانه باید صفر یا عدد مثبت باشه: (0 یعنی بدون بیعانه)");
    return;
  }

  const quoteMax = payload.draftQuoteMaxToman ?? 0;
  if (deposit > quoteMax) {
    await sendMessage(ctx, chatId, `بیعانه نمی‌تونه بیشتر از حداکثر قیمت (${quoteMax.toLocaleString()}) باشه:`);
    return;
  }

  if (!payload.targetBookingId || payload.draftQuoteMinToman == null || payload.draftQuoteMaxToman == null) {
    await sendMessage(ctx, chatId, "مشکلی پیش اومد. دوباره امتحان کن.");
    await updateSession(chatId, HairdresserState.IDLE, {});
    return;
  }

  if (deposit === 0) {
    const booking = await prisma.booking.update({
      where: { id: payload.targetBookingId },
      data: {
        status: BookingStatus.CONFIRMED,
        quotedMinPriceToman: payload.draftQuoteMinToman,
        quotedMaxPriceToman: payload.draftQuoteMaxToman,
        depositAmountToman: null,
        approvedAt: new Date(),
        confirmedAt: new Date(),
      },
    });

    await rejectConflictingBookings(
      booking.hairdresserId,
      booking.requestedStartAt,
      booking.requestedEndAt,
      booking.id
    );

    await updateSession(chatId, HairdresserState.IDLE, {});
    await sendMessage(ctx, chatId, "✅ رزرو تایید و نهایی شد! مشتری بدون نیاز به پرداخت اطلاع‌رسانی می‌شه.", {
      reply_markup: makeHairdresserReplyMenu(),
    });
    await notifyCustomerConfirmedNoPay(ctx, payload.targetBookingId);
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
  await sendMessage(ctx, chatId, "✅ رزرو تایید شد! مشتری لینک پرداخت رو دریافت می‌کنه.", {
    reply_markup: makeHairdresserReplyMenu(),
  });

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
  await sendMessage(
    ctx,
    chatId,
    `❌ رد رزرو\n\n👤 ${booking.customer.fullName} — ${booking.service.title}\n🗓 ${formatJalaliDateTime(booking.requestedStartAt)}\n\nدلیل رد رو بنویس (اختیاری):`,
    {
      reply_markup: makeInlineKeyboard([
        [{ text: "بدون دلیل", data: `hd:booking:rejectnoreason:${bookingId}` }],
        [{ text: "❌ لغو", data: "hd:cancel" }],
      ]),
    }
  );
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
  await sendMessage(ctx, chatId, "رزرو رد شد. مشتری اطلاع‌رسانی می‌شه.", {
    reply_markup: makeHairdresserReplyMenu(),
  });
  await notifyCustomerRejected(ctx, payload.targetBookingId);
}

export async function handleRejectNoReasonCallback(
  ctx: BotContext,
  query: TelegramCallbackQuery,
  session: Session,
  bookingId: string
): Promise<void> {
  const chatId = String(query.message!.chat.id);
  await prisma.booking.update({
    where: { id: bookingId },
    data: { status: BookingStatus.REJECTED, rejectionReason: null },
  });
  await updateSession(chatId, HairdresserState.IDLE, {});
  await sendMessage(ctx, chatId, "رزرو رد شد. مشتری اطلاع‌رسانی می‌شه.", {
    reply_markup: makeHairdresserReplyMenu(),
  });
  await notifyCustomerRejected(ctx, bookingId);
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
      `🕐 زمان: ${formatJalaliDateTime(booking.requestedStartAt)}`,
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

async function notifyCustomerConfirmedNoPay(_ctx: BotContext, bookingId: string): Promise<void> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { customer: true, service: true },
  });
  if (!booking) return;

  await notifyCustomer(
    booking.customer,
    [
      "✅ <b>رزروت تایید و نهایی شد!</b>",
      "",
      `✂️ سرویس: ${booking.service.title}`,
      `🕐 زمان: ${formatJalaliDateTime(booking.requestedStartAt)}`,
      `💰 قیمت: ${booking.quotedMinPriceToman!.toLocaleString()} - ${booking.quotedMaxPriceToman!.toLocaleString()} تومان`,
      "",
      "نیازی به پرداخت بیعانه نیست. نوبتت ثبت شده!",
    ].join("\n")
  );
}

export async function handleBookingAttachmentsCallback(
  ctx: BotContext,
  query: TelegramCallbackQuery,
  session: Session,
  bookingId: string
): Promise<void> {
  const chatId = String(query.message!.chat.id);

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { customer: true, attachments: { orderBy: { sortOrder: "asc" } } },
  });

  if (!booking) {
    await sendMessage(ctx, chatId, "رزرو یافت نشد.");
    return;
  }

  if (!booking.customerDescription && booking.attachments.length === 0) {
    await sendMessage(ctx, chatId, "این رزرو توضیح یا فایل پیوستی ندارد.");
    return;
  }

  if (booking.customerDescription) {
    await sendMessage(ctx, chatId, `📝 <b>توضیحات مشتری (${booking.customer.fullName}):</b>\n${booking.customerDescription}`);
  }

  for (const att of booking.attachments) {
    if (att.type === BookingAttachmentType.IMAGE) {
      await sendPhoto(ctx, chatId, att.telegramFileId, att.caption ? { caption: att.caption } : {});
    } else if (att.type === BookingAttachmentType.VIDEO) {
      await sendVideo(ctx, chatId, att.telegramFileId, att.caption ? { caption: att.caption } : {});
    }
  }
}
