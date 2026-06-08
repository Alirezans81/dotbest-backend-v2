import { prisma } from "@/lib/prisma";
import { sendMessage, makeInlineKeyboard, makeCustomerReplyMenu } from "@/bot/telegram/client";
import { notifyHairdresser, notifyCustomer } from "@/bot/notify";
import { updateSession, mergeSessionPayload, linkCustomerToSession } from "@/bot/session";
import { CustomerState } from "@/bot/states";
import { getAvailableDates, getAvailableSlots, isSlotAvailable, getConflictingPendingBookings } from "@/domain/availability";
import { addMinutes, formatJalaliDateTime, gregorianToJalaliFull, gregorianToJalali, gregorianToJalaliWithDayName } from "@/lib/time";
import { BookingStatus, BookingAttachmentType, NotificationChannel } from "@prisma/client";
import type { BotContext } from "@/bot/telegram/client";
import type { Session } from "@/bot/session";
import type { TelegramMessage, TelegramCallbackQuery } from "@/bot/telegram/types";

const MAX_ATTACHMENTS = 5;

export async function handleCustomerDeepLink(
  ctx: BotContext,
  msg: TelegramMessage,
  session: Session,
  slug: string
): Promise<void> {
  const chatId = String(msg.chat.id);
  const from = msg.from!;

  const hairdresser = await prisma.hairdresser.findFirst({
    where: { bookingSlug: slug, isOnboardingCompleted: true },
  });

  if (!hairdresser) {
    await sendMessage(ctx, chatId, "لینک رزرو معتبر نیست. از آرایشگر لینک درست رو بگیر.");
    return;
  }

  const userId = String(from.id);
  const userIdField = ctx.platform === "BALE" ? "baleUserId" : "telegramUserId";
  const chatIdField = ctx.platform === "BALE" ? "baleChatId" : "telegramChatId";

  let customer = await prisma.customer.findFirst({ where: { [userIdField]: userId } });
  if (!customer) {
    customer = await prisma.customer.create({
      data: {
        [userIdField]: userId,
        [chatIdField]: chatId,
        fullName: [from.first_name, from.last_name].filter(Boolean).join(" "),
        username: from.username ?? null,
        notificationChannel: ctx.platform === "BALE" ? NotificationChannel.BALE_ONLY : NotificationChannel.TELEGRAM_ONLY,
      },
    });
  } else if (!customer[chatIdField as keyof typeof customer]) {
    customer = await prisma.customer.update({
      where: { id: customer.id },
      data: { [chatIdField]: chatId },
    });
  }

  await linkCustomerToSession(chatId, customer.id);
  await updateSession(chatId, CustomerState.SELECT_CATEGORY, {
    targetHairdresserId: hairdresser.id,
    targetHairdresserSlug: slug,
  });

  const categories = await prisma.serviceCategory.findMany({
    where: { hairdresserId: hairdresser.id, isActive: true },
    orderBy: { sortOrder: "asc" },
  });

  if (categories.length === 0) {
    await sendMessage(ctx, chatId, "آرایشگر هنوز سرویسی تعریف نکرده. بعداً دوباره امتحان کن.");
    await updateSession(chatId, CustomerState.IDLE, {});
    return;
  }

  const rows = categories.map((c) => [{ text: c.title, data: `cust:category:${c.id}` }]);
  await sendMessage(
    ctx,
    chatId,
    `سلام! 👋\nبرای رزرو نوبت از <b>${hairdresser.fullName}</b>\nاول یه دسته‌بندی انتخاب کن:`,
    { reply_markup: makeInlineKeyboard(rows) }
  );
}

export async function handleCustomerCategoryCallback(
  ctx: BotContext,
  query: TelegramCallbackQuery,
  session: Session,
  categoryId: string
): Promise<void> {
  const chatId = String(query.message!.chat.id);
  const payload = session.payload as { targetHairdresserId?: string };

  const category = await prisma.serviceCategory.findFirst({
    where: { id: categoryId, hairdresserId: payload.targetHairdresserId, isActive: true },
  });

  if (!category) {
    await sendMessage(ctx, chatId, "این دسته‌بندی دیگه موجود نیست.");
    return;
  }

  const services = await prisma.service.findMany({
    where: { categoryId, hairdresserId: payload.targetHairdresserId, isActive: true },
  });

  if (services.length === 0) {
    await sendMessage(ctx, chatId, "این دسته‌بندی سرویسی نداره.");
    return;
  }

  await mergeSessionPayload(chatId, { selectedCategoryId: categoryId });
  await updateSession(chatId, CustomerState.SELECT_SERVICE);

  const rows = services.map((s) => [
    {
      text: `${s.title} (${s.durationMinutes} دقیقه | ${s.priceMinToman.toLocaleString()}-${s.priceMaxToman.toLocaleString()} تومان)`,
      data: `cust:service:${s.id}`,
    },
  ]);

  await sendMessage(ctx, chatId, "سرویس موردنظرت رو انتخاب کن:", {
    reply_markup: makeInlineKeyboard(rows),
  });
}

export async function handleCustomerServiceCallback(
  ctx: BotContext,
  query: TelegramCallbackQuery,
  session: Session,
  serviceId: string
): Promise<void> {
  const chatId = String(query.message!.chat.id);
  const payload = session.payload as { targetHairdresserId?: string };

  const service = await prisma.service.findFirst({
    where: { id: serviceId, hairdresserId: payload.targetHairdresserId, isActive: true },
  });

  if (!service) {
    await sendMessage(ctx, chatId, "این سرویس دیگه موجود نیست.");
    return;
  }

  await mergeSessionPayload(chatId, { selectedServiceId: serviceId });
  await updateSession(chatId, CustomerState.SELECT_DATE);

  const dates = await getAvailableDates(payload.targetHairdresserId!, service.durationMinutes);

  if (dates.length === 0) {
    await sendMessage(ctx, chatId, "متأسفانه در ۱۴ روز آینده تاریخ خالی موجود نیست. بعداً دوباره امتحان کن.");
    return;
  }

  const rows = dates.slice(0, 14).map((d) => [{ text: gregorianToJalaliWithDayName(d), data: `cust:date:${d}` }]);
  await sendMessage(ctx, chatId, `سرویس «${service.title}» انتخاب شد.\nتاریخ مورد نظرت رو انتخاب کن:`, {
    reply_markup: makeInlineKeyboard(rows),
  });
}

export async function handleCustomerDateCallback(
  ctx: BotContext,
  query: TelegramCallbackQuery,
  session: Session,
  date: string
): Promise<void> {
  const chatId = String(query.message!.chat.id);
  const payload = session.payload as { targetHairdresserId?: string; selectedServiceId?: string };

  const service = await prisma.service.findUnique({ where: { id: payload.selectedServiceId! } });
  if (!service) {
    await sendMessage(ctx, chatId, "مشکلی پیش اومد. دوباره امتحان کن.");
    return;
  }

  const slotsByDate = await getAvailableSlots(payload.targetHairdresserId!, service.durationMinutes, date);
  const slots = slotsByDate.get(date) ?? [];

  if (slots.length === 0) {
    await sendMessage(ctx, chatId, "در این تاریخ ساعت خالی نیست. تاریخ دیگه‌ای انتخاب کن.");
    return;
  }

  await mergeSessionPayload(chatId, { selectedDate: date });
  await updateSession(chatId, CustomerState.SELECT_TIME);

  const rows = [];
  for (let i = 0; i < slots.length; i += 3) {
    rows.push(
      slots.slice(i, i + 3).map((s) => ({ text: s.label, data: `cust:slot:${s.isoStartAt}` }))
    );
  }

  await sendMessage(ctx, chatId, `تاریخ ${gregorianToJalali(date)} انتخاب شد.\nساعت مورد نظرت رو انتخاب کن:`, {
    reply_markup: makeInlineKeyboard(rows),
  });
}

export async function handleCustomerSlotCallback(
  ctx: BotContext,
  query: TelegramCallbackQuery,
  session: Session,
  isoStartAt: string
): Promise<void> {
  const chatId = String(query.message!.chat.id);
  const payload = session.payload as { targetHairdresserId?: string; selectedServiceId?: string };

  const service = await prisma.service.findUnique({ where: { id: payload.selectedServiceId! } });
  if (!service) {
    await sendMessage(ctx, chatId, "مشکلی پیش اومد. دوباره امتحان کن.");
    return;
  }

  const startAt = new Date(isoStartAt);
  const available = await isSlotAvailable(payload.targetHairdresserId!, startAt, service.durationMinutes);

  if (!available) {
    await sendMessage(ctx, chatId, "متأسفانه این ساعت دیگه خالی نیست. لطفاً ساعت دیگه‌ای انتخاب کن.");
    return;
  }

  await mergeSessionPayload(chatId, { selectedStartAt: isoStartAt });
  await updateSession(chatId, CustomerState.WAIT_DESCRIPTION);

  await sendMessage(
    ctx,
    chatId,
    `ساعت ${formatJalaliDateTime(startAt)} انتخاب شد.\n\nاگه توضیح، عکس یا ویدیو داری بفرست.\n\n(اختیاریه)`,
    {
      reply_markup: makeInlineKeyboard([
        [{ text: "رد شدن از این قسمت", data: "cust:description:skip" }],
      ]),
    }
  );
}

export async function handleCustomerDescriptionSkip(
  ctx: BotContext,
  query: TelegramCallbackQuery,
  session: Session
): Promise<void> {
  const chatId = String(query.message!.chat.id);
  await updateSession(chatId, CustomerState.REVIEW_REQUEST);
  await showBookingReview(ctx, chatId, session);
}

export async function handleCustomerDescription(
  ctx: BotContext,
  msg: TelegramMessage,
  session: Session
): Promise<void> {
  const chatId = String(msg.chat.id);
  const payload = session.payload as { attachmentIds?: string[] };
  const attachmentIds = payload.attachmentIds ?? [];

  if (msg.photo && msg.photo.length > 0) {
    if (attachmentIds.length >= MAX_ATTACHMENTS) {
      await sendMessage(ctx, chatId, `حداکثر ${MAX_ATTACHMENTS} فایل قابل ارسال است.`);
      return;
    }
    const largest = msg.photo[msg.photo.length - 1];
    attachmentIds.push(JSON.stringify({ type: "IMAGE", fileId: largest.file_id, fileUniqueId: largest.file_unique_id, caption: msg.caption }));
    await mergeSessionPayload(chatId, { attachmentIds });
    await sendMessage(ctx, chatId, "عکس دریافت شد. عکس/ویدیو دیگه‌ای هم می‌تونی بفرستی یا ادامه بده:", {
      reply_markup: makeInlineKeyboard([[{ text: "ادامه", data: "cust:attachment:skip" }]]),
    });
    return;
  }

  if (msg.video) {
    if (attachmentIds.length >= MAX_ATTACHMENTS) {
      await sendMessage(ctx, chatId, `حداکثر ${MAX_ATTACHMENTS} فایل قابل ارسال است.`);
      return;
    }
    attachmentIds.push(JSON.stringify({ type: "VIDEO", fileId: msg.video.file_id, fileUniqueId: msg.video.file_unique_id, caption: msg.caption }));
    await mergeSessionPayload(chatId, { attachmentIds });
    await sendMessage(ctx, chatId, "ویدیو دریافت شد. فایل دیگه‌ای هم می‌تونی بفرستی یا ادامه بده:", {
      reply_markup: makeInlineKeyboard([[{ text: "ادامه", data: "cust:attachment:skip" }]]),
    });
    return;
  }

  if (msg.text) {
    await mergeSessionPayload(chatId, { descriptionText: msg.text.trim(), attachmentIds });
    await updateSession(chatId, CustomerState.WAIT_ATTACHMENT);
    await sendMessage(ctx, chatId, "توضیحات ثبت شد. عکس یا ویدیو هم داری؟", {
      reply_markup: makeInlineKeyboard([
        [{ text: "نه، ادامه بده", data: "cust:attachment:skip" }],
      ]),
    });
    return;
  }

  await sendMessage(ctx, chatId, "متن، عکس یا ویدیو بفرست یا از این قسمت رد شو:");
}

export async function handleCustomerAttachmentSkip(
  ctx: BotContext,
  query: TelegramCallbackQuery,
  session: Session
): Promise<void> {
  const chatId = String(query.message!.chat.id);
  await updateSession(chatId, CustomerState.REVIEW_REQUEST);
  await showBookingReview(ctx, chatId, session);
}

async function showBookingReview(ctx: BotContext, chatId: string, session: Session): Promise<void> {
  const payload = session.payload as {
    targetHairdresserId?: string;
    selectedServiceId?: string;
    selectedStartAt?: string;
    descriptionText?: string;
    attachmentIds?: string[];
  };

  const [hairdresser, service] = await Promise.all([
    prisma.hairdresser.findUnique({ where: { id: payload.targetHairdresserId! } }),
    prisma.service.findUnique({ where: { id: payload.selectedServiceId! } }),
  ]);

  if (!hairdresser || !service) {
    await sendMessage(ctx, chatId, "مشکلی پیش اومد. دوباره از لینک رزرو بیا.");
    return;
  }

  const startAt = new Date(payload.selectedStartAt!);
  const endAt = addMinutes(startAt, service.durationMinutes);

  const lines = [
    "📋 <b>خلاصه رزرو:</b>",
    "",
    `👤 آرایشگر: ${hairdresser.fullName}`,
    `✂️ سرویس: ${service.title}`,
    `🕐 زمان: ${formatJalaliDateTime(startAt)} تا ${formatJalaliDateTime(endAt)}`,
    `💰 بازه قیمت: ${service.priceMinToman.toLocaleString()} - ${service.priceMaxToman.toLocaleString()} تومان`,
  ];

  if (payload.descriptionText) lines.push(`📝 توضیحات: ${payload.descriptionText}`);
  if (payload.attachmentIds?.length) lines.push(`📎 فایل‌های پیوست: ${payload.attachmentIds.length} فایل`);
  lines.push("", "آماده‌ای ثبت بشه؟");

  await sendMessage(ctx, chatId, lines.join("\n"), {
    reply_markup: makeInlineKeyboard([
      [{ text: "✅ ثبت درخواست", data: "cust:booking:submit" }],
      [{ text: "❌ انصراف", data: "cust:cancel:abort:0" }],
    ]),
  });
}

export async function handleCustomerBookingSubmit(
  ctx: BotContext,
  query: TelegramCallbackQuery,
  session: Session
): Promise<void> {
  const chatId = String(query.message!.chat.id);
  const payload = session.payload as {
    targetHairdresserId?: string;
    selectedServiceId?: string;
    selectedStartAt?: string;
    descriptionText?: string;
    attachmentIds?: string[];
  };

  const service = await prisma.service.findUnique({ where: { id: payload.selectedServiceId! } });
  if (!service) {
    await sendMessage(ctx, chatId, "مشکلی پیش اومد. دوباره امتحان کن.");
    return;
  }

  const startAt = new Date(payload.selectedStartAt!);
  const endAt = addMinutes(startAt, service.durationMinutes);

  const available = await isSlotAvailable(payload.targetHairdresserId!, startAt, service.durationMinutes);
  if (!available) {
    await sendMessage(ctx, chatId, "متأسفانه این ساعت دیگه خالی نیست. لطفاً دوباره از اول رزرو کن.");
    await updateSession(chatId, CustomerState.IDLE, {});
    return;
  }

  const hairdresser = await prisma.hairdresser.findUnique({
    where: { id: payload.targetHairdresserId! },
  });
  if (!hairdresser) {
    await sendMessage(ctx, chatId, "مشکلی پیش اومد. دوباره امتحان کن.");
    return;
  }

  const isAutoApproved = hairdresser.autoApproveBookings;
  const autoDeposit = hairdresser.autoApproveDeposit ?? 0;
  const needsDeposit = isAutoApproved && autoDeposit > 0;

  const bookingStatus = isAutoApproved && !needsDeposit
    ? BookingStatus.CONFIRMED
    : isAutoApproved && needsDeposit
      ? BookingStatus.APPROVED_AWAITING_DEPOSIT
      : BookingStatus.PENDING_REVIEW;

  const booking = await prisma.booking.create({
    data: {
      hairdresserId: payload.targetHairdresserId!,
      customerId: session.customerId!,
      serviceId: service.id,
      status: bookingStatus,
      requestedStartAt: startAt,
      requestedEndAt: endAt,
      customerDescription: payload.descriptionText ?? null,
      isAutoApproved,
      quotedMinPriceToman: isAutoApproved ? service.priceMinToman : null,
      quotedMaxPriceToman: isAutoApproved ? service.priceMaxToman : null,
      depositAmountToman: needsDeposit ? autoDeposit : null,
      approvedAt: isAutoApproved ? new Date() : null,
      confirmedAt: bookingStatus === BookingStatus.CONFIRMED ? new Date() : null,
    },
  });

  if (payload.attachmentIds?.length) {
    const attachments = payload.attachmentIds.map((raw, i) => {
      const a = JSON.parse(raw) as { type: string; fileId: string; fileUniqueId: string; caption?: string };
      return {
        bookingId: booking.id,
        type: a.type as BookingAttachmentType,
        telegramFileId: a.fileId,
        telegramFileUniqueId: a.fileUniqueId,
        caption: a.caption ?? null,
        sortOrder: i,
      };
    });
    await prisma.bookingAttachment.createMany({ data: attachments });
  }

  await updateSession(chatId, CustomerState.IDLE, {});

  if (isAutoApproved && !needsDeposit) {
    // Auto-approve بدون بیعانه: مستقیم CONFIRMED
    await rejectConflictingBookings(hairdresser.id, startAt, endAt, booking.id);

    await sendMessage(
      ctx,
      chatId,
      `✅ نوبتت ثبت شد!\n\n✂️ سرویس: ${service.title}\n🕐 زمان: ${formatJalaliDateTime(startAt)}`,
      { reply_markup: makeCustomerReplyMenu() }
    );
    const customer = await prisma.customer.findUnique({ where: { id: session.customerId! } });
    await notifyHairdresser(
      hairdresser,
      `✅ نوبت جدید (تایید خودکار)\n\n👤 مشتری: ${customer?.fullName ?? "—"}\n✂️ سرویس: ${service.title}\n🕐 زمان: ${formatJalaliDateTime(startAt)}`
    );
  } else if (needsDeposit) {
    // Auto-approve با بیعانه: نیاز به پرداخت
    await sendMessage(
      ctx,
      chatId,
      `✅ رزروت تایید شد!\n\n✂️ سرویس: ${service.title}\n🕐 زمان: ${formatJalaliDateTime(startAt)}\n💰 قیمت حدودی: ${service.priceMinToman.toLocaleString()} - ${service.priceMaxToman.toLocaleString()} تومان\n\nبرای نهایی شدن، بیعانه <b>${autoDeposit.toLocaleString()} تومان</b> رو پرداخت کن:`,
      {
        reply_markup: {
          inline_keyboard: [[{ text: "💳 پرداخت بیعانه", callback_data: `cust:payment:pay:${booking.id}` }]],
        },
      }
    );
    const customer = await prisma.customer.findUnique({ where: { id: session.customerId! } });
    await notifyHairdresser(
      hairdresser,
      `✅ نوبت جدید (تایید خودکار — منتظر پرداخت)\n\n👤 مشتری: ${customer?.fullName ?? "—"}\n✂️ سرویس: ${service.title}\n🕐 زمان: ${formatJalaliDateTime(startAt)}\n💰 بیعانه: ${autoDeposit.toLocaleString()} تومان`
    );
  } else {
    await sendMessage(ctx, chatId, "✅ درخواست رزروت ثبت شد!\n\nمنتظر تایید آرایشگر باش. بعد از تایید پیام می‌گیری.", {
      reply_markup: makeCustomerReplyMenu(),
    });
    await notifyHairdresserNewBooking(ctx, booking.id);
  }
}

async function notifyHairdresserNewBooking(_ctx: BotContext, bookingId: string): Promise<void> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { hairdresser: true, customer: true, service: true, attachments: true },
  });
  if (!booking) return;

  const lines = [
    "🔔 <b>درخواست رزرو جدید</b>",
    "",
    `👤 مشتری: ${booking.customer.fullName}`,
    `✂️ سرویس: ${booking.service.title}`,
    `🕐 زمان: ${formatJalaliDateTime(booking.requestedStartAt)}`,
  ];
  if (booking.customerDescription) lines.push(`📝 توضیحات: ${booking.customerDescription}`);
  if (booking.attachments.length > 0) lines.push(`📎 فایل‌های پیوست: ${booking.attachments.length}`);

  const inlineKeyboard: Array<Array<{ text: string; callback_data: string }>> = [
    [
      { text: "✅ تایید", callback_data: `hd:booking:approve:${bookingId}` },
      { text: "❌ رد", callback_data: `hd:booking:reject:${bookingId}` },
    ],
  ];
  if (booking.attachments.length > 0) {
    inlineKeyboard.push([{ text: "📎 مشاهده فایل‌ها", callback_data: `hd:booking:attachments:${bookingId}` }]);
  }

  await notifyHairdresser(booking.hairdresser, lines.join("\n"), {
    reply_markup: { inline_keyboard: inlineKeyboard },
  });
}

/**
 * Rejects all PENDING_REVIEW / APPROVED_AWAITING_DEPOSIT bookings that overlap
 * with the given slot and notifies those customers.
 * Called both on auto-approve (CONFIRMED) and on payment initiation (PAYMENT_PENDING).
 */
export async function rejectConflictingBookings(
  hairdresserId: string,
  startAt: Date,
  endAt: Date,
  excludeBookingId: string
): Promise<void> {
  const conflictIds = await getConflictingPendingBookings(hairdresserId, startAt, endAt, excludeBookingId);
  if (conflictIds.length === 0) return;

  await prisma.booking.updateMany({
    where: { id: { in: conflictIds } },
    data: {
      status: BookingStatus.REJECTED,
      rejectionReason: "زمان این نوبت توسط مشتری دیگری رزرو شد",
    },
  });

  const rejected = await prisma.booking.findMany({
    where: { id: { in: conflictIds } },
    include: { customer: true },
  });

  await Promise.allSettled(
    rejected.map((b) =>
      notifyCustomer(
        b.customer,
        "❌ متأسفانه زمان درخواستی شما توسط مشتری دیگری رزرو شد.\n\nمی‌تونی زمان دیگه‌ای انتخاب کنی."
      )
    )
  );
}
