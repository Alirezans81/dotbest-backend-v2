import { prisma } from "@/lib/prisma";
import { sendMessage, makeInlineKeyboard, makeHairdresserReplyMenu } from "@/bot/telegram/client";
import { updateSession, mergeSessionPayload } from "@/bot/session";
import { HairdresserState } from "@/bot/states";
import { formatJalaliDateTime, formatJalaliDate, TIMEZONE } from "@/lib/time";
import { IRAN_DAYS, iranIndexToJsDay, JS_DAY_NAME } from "@/lib/days";
import { toZonedTime } from "date-fns-tz";
import { startOfDay, endOfDay } from "date-fns";
import { BookingStatus, NotificationChannel } from "@prisma/client";
import type { BotContext } from "@/bot/telegram/client";
import type { Session } from "@/bot/session";
import type { TelegramCallbackQuery, TelegramMessage } from "@/bot/telegram/types";

export async function handleTodayMenu(
  ctx: BotContext,
  query: TelegramCallbackQuery,
  session: Session
): Promise<void> {
  const chatId = String(query.message!.chat.id);
  const hairdresserId = session.hairdresserId!;

  const todayInTehran = toZonedTime(new Date(), TIMEZONE);
  const dayStart = startOfDay(todayInTehran);
  const dayEnd = endOfDay(todayInTehran);

  const utcOffset = 3.5 * 60 * 60 * 1000;
  const utcStart = new Date(dayStart.getTime() - utcOffset);
  const utcEnd = new Date(dayEnd.getTime() - utcOffset);

  const bookings = await prisma.booking.findMany({
    where: {
      hairdresserId,
      requestedStartAt: { gte: utcStart, lt: utcEnd },
      status: { in: [BookingStatus.CONFIRMED, BookingStatus.PENDING_REVIEW, BookingStatus.APPROVED_AWAITING_DEPOSIT] },
    },
    include: { customer: true, service: true, attachments: true },
    orderBy: { requestedStartAt: "asc" },
  });

  if (bookings.length === 0) {
    await sendMessage(ctx, chatId, "📅 امروز هیچ نوبتی نداری.");
    return;
  }

  const lines = [`📅 <b>نوبت‌های امروز (${bookings.length} نوبت):</b>`, ""];
  for (const b of bookings) {
    const statusLabel = {
      [BookingStatus.CONFIRMED]: "✅",
      [BookingStatus.PENDING_REVIEW]: "⏳",
      [BookingStatus.APPROVED_AWAITING_DEPOSIT]: "💳",
    }[b.status as string] ?? "•";
    const hasExtra = b.customerDescription || b.attachments.length > 0;
    lines.push(`${statusLabel} ${formatJalaliDateTime(b.requestedStartAt)} — ${b.customer.fullName} — ${b.service.title}${hasExtra ? " 📎" : ""}`);
  }

  const detailButtons = bookings
    .filter((b) => b.customerDescription || b.attachments.length > 0)
    .map((b) => [{ text: `📎 ${b.customer.fullName}`, data: `hd:booking:attachments:${b.id}` }]);

  await sendMessage(ctx, chatId, lines.join("\n"), {
    reply_markup: detailButtons.length > 0 ? makeInlineKeyboard(detailButtons) : undefined,
  });
}

export async function handleUpcomingMenu(
  ctx: BotContext,
  query: TelegramCallbackQuery,
  session: Session
): Promise<void> {
  const chatId = String(query.message!.chat.id);
  const hairdresserId = session.hairdresserId!;

  const todayInTehran = toZonedTime(new Date(), TIMEZONE);
  const tomorrowStart = startOfDay(new Date(todayInTehran.getTime() + 24 * 60 * 60 * 1000));

  const utcOffset = 3.5 * 60 * 60 * 1000;
  const utcStart = new Date(tomorrowStart.getTime() - utcOffset);

  const bookings = await prisma.booking.findMany({
    where: {
      hairdresserId,
      requestedStartAt: { gte: utcStart },
      status: { in: [BookingStatus.CONFIRMED, BookingStatus.PENDING_REVIEW, BookingStatus.APPROVED_AWAITING_DEPOSIT] },
    },
    include: { customer: true, service: true, attachments: true },
    orderBy: { requestedStartAt: "asc" },
    take: 30,
  });

  if (bookings.length === 0) {
    await sendMessage(ctx, chatId, "📆 نوبت آینده‌ای نداری.");
    return;
  }

  const lines = [`📆 <b>نوبت‌های آینده (${bookings.length} نوبت):</b>`, ""];
  let lastDate = "";
  for (const b of bookings) {
    const dateLabel = formatJalaliDate(b.requestedStartAt);
    if (dateLabel !== lastDate) {
      if (lastDate) lines.push("");
      lines.push(`📅 <b>${dateLabel}</b>`);
      lastDate = dateLabel;
    }
    const statusLabel = {
      [BookingStatus.CONFIRMED]: "✅",
      [BookingStatus.PENDING_REVIEW]: "⏳",
      [BookingStatus.APPROVED_AWAITING_DEPOSIT]: "💳",
    }[b.status as string] ?? "•";
    const hasExtra = b.customerDescription || b.attachments.length > 0;
    lines.push(`  ${statusLabel} ${formatJalaliDateTime(b.requestedStartAt)} — ${b.customer.fullName} — ${b.service.title}${hasExtra ? " 📎" : ""}`);
  }

  const detailButtons = bookings
    .filter((b) => b.customerDescription || b.attachments.length > 0)
    .map((b) => [{ text: `📎 ${b.customer.fullName}`, data: `hd:booking:attachments:${b.id}` }]);

  await sendMessage(ctx, chatId, lines.join("\n"), {
    reply_markup: detailButtons.length > 0 ? makeInlineKeyboard(detailButtons) : undefined,
  });
}

export async function handleCustomersMenu(
  ctx: BotContext,
  query: TelegramCallbackQuery,
  session: Session
): Promise<void> {
  const chatId = String(query.message!.chat.id);
  const hairdresserId = session.hairdresserId!;

  const customers = await prisma.customer.findMany({
    where: { bookings: { some: { hairdresserId } } },
    include: {
      bookings: {
        where: { hairdresserId },
        orderBy: { requestedStartAt: "desc" },
        take: 1,
        include: { service: true },
      },
    },
    take: 20,
  });

  if (customers.length === 0) {
    await sendMessage(ctx, chatId, "👥 هنوز مشتری‌ای نداری.");
    return;
  }

  const rows = customers.map((c) => {
    const lastBooking = c.bookings[0];
    const label = lastBooking ? `${c.fullName} — ${lastBooking.service.title}` : c.fullName;
    return [{ text: label, data: `hd:booking:view:${lastBooking?.id ?? "none"}` }];
  });

  await sendMessage(ctx, chatId, `👥 مشتریان (${customers.length})`, {
    reply_markup: makeInlineKeyboard(rows),
  });
}

export async function handleBookingViewCallback(
  ctx: BotContext,
  query: TelegramCallbackQuery,
  session: Session,
  bookingId: string
): Promise<void> {
  const chatId = String(query.message!.chat.id);

  if (bookingId === "none") {
    await sendMessage(ctx, chatId, "اطلاعاتی موجود نیست.");
    return;
  }

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { customer: true, service: true },
  });

  if (!booking) {
    await sendMessage(ctx, chatId, "رزرو یافت نشد.");
    return;
  }

  const history = await prisma.booking.findMany({
    where: { customerId: booking.customerId, hairdresserId: booking.hairdresserId },
    orderBy: { requestedStartAt: "desc" },
    include: { service: true },
    take: 5,
  });

  const lines = [
    `👤 <b>${booking.customer.fullName}</b>`,
    booking.customer.phoneNumber ? `📞 ${booking.customer.phoneNumber}` : "",
    "",
    "📋 <b>آخرین نوبت‌ها:</b>",
  ].filter(Boolean);

  const statusEmoji: Record<string, string> = {
    [BookingStatus.CONFIRMED]: "✅",
    [BookingStatus.COMPLETED]: "✔️",
    [BookingStatus.CANCELLED_WITH_PENALTY]: "❌",
    [BookingStatus.CANCELLED_WITHOUT_PENALTY]: "❌",
    [BookingStatus.REJECTED]: "🚫",
  };

  for (const b of history) {
    lines.push(`${statusEmoji[b.status] ?? "•"} ${formatJalaliDateTime(b.requestedStartAt)} — ${b.service.title}`);
  }

  await sendMessage(ctx, chatId, lines.join("\n"));
}

export async function handleSettingsMenu(
  ctx: BotContext,
  query: TelegramCallbackQuery,
  session: Session
): Promise<void> {
  const chatId = String(query.message!.chat.id);
  const hairdresser = await prisma.hairdresser.findUnique({ where: { id: session.hairdresserId! } });
  if (!hairdresser) return;

  const autoLabel = hairdresser.autoApproveBookings ? "✅ تایید خودکار: فعال" : "❌ تایید خودکار: غیرفعال";
  const depositLabel = hairdresser.autoApproveDeposit
    ? `💵 بیعانه خودکار: ${hairdresser.autoApproveDeposit.toLocaleString()} تومان`
    : "💵 بیعانه خودکار: ندارد";
  const notifLabel = {
    [NotificationChannel.TELEGRAM_ONLY]: "📱 نوتیف: فقط تلگرام",
    [NotificationChannel.BALE_ONLY]: "📱 نوتیف: فقط بله",
    [NotificationChannel.BOTH]: "📱 نوتیف: تلگرام + بله",
  }[hairdresser.notificationChannel];

  const rows: Array<Array<{ text: string; data: string }>> = [
    [{ text: "🕐 ساعت کاری", data: "hd:hours:edit" }],
    [{ text: "🚫 زمان مسدود", data: "hd:block:add" }],
    [{ text: autoLabel, data: "hd:settings:autoapprove:toggle" }],
  ];
  if (hairdresser.autoApproveBookings) {
    rows.push([{ text: depositLabel, data: "hd:settings:autoapprove:deposit" }]);
  }
  rows.push([{ text: notifLabel, data: "hd:settings:notif:menu" }]);
  rows.push([{ text: "💰 کیف پول", data: "hd:wallet:show" }]);

  await sendMessage(ctx, chatId, "⚙️ تنظیمات:", { reply_markup: makeInlineKeyboard(rows) });
}

export async function handleAutoApproveToggle(
  ctx: BotContext,
  query: TelegramCallbackQuery,
  session: Session
): Promise<void> {
  const chatId = String(query.message!.chat.id);
  const hairdresser = await prisma.hairdresser.findUnique({ where: { id: session.hairdresserId! } });
  if (!hairdresser) return;

  const newValue = !hairdresser.autoApproveBookings;
  await prisma.hairdresser.update({
    where: { id: hairdresser.id },
    data: { autoApproveBookings: newValue },
  });

  const msg = newValue
    ? "✅ تایید خودکار فعال شد.\n\nاز این به بعد رزروهای جدید بدون نیاز به تایید، مستقیم ثبت می‌شن."
    : "❌ تایید خودکار غیرفعال شد.\n\nاز این به بعد هر رزرو رو باید خودت تایید کنی.";

  await sendMessage(ctx, chatId, msg);
}

export async function handleAutoApproveDepositCallback(
  ctx: BotContext,
  query: TelegramCallbackQuery,
  session: Session
): Promise<void> {
  const chatId = String(query.message!.chat.id);
  await updateSession(chatId, HairdresserState.WAIT_AUTO_APPROVE_DEPOSIT);
  await sendMessage(
    ctx,
    chatId,
    "مبلغ بیعانه ثابت برای تایید خودکار رو بنویس (تومان):\n\n(برای حذف بیعانه، عدد <b>0</b> وارد کن — رزروهای خودکار بدون پرداخت تایید می‌شن)",
    { reply_markup: makeInlineKeyboard([[{ text: "❌ لغو", data: "hd:cancel" }]]) }
  );
}

export async function handleAutoApproveDeposit(
  ctx: BotContext,
  msg: TelegramMessage,
  session: Session
): Promise<void> {
  const chatId = String(msg.chat.id);
  const amount = parseInt(msg.text?.trim().replace(/,/g, "") ?? "", 10);

  if (isNaN(amount) || amount < 0) {
    await sendMessage(ctx, chatId, "مبلغ باید عدد مثبت یا صفر باشه:", {
      reply_markup: makeInlineKeyboard([[{ text: "❌ لغو", data: "hd:cancel" }]]),
    });
    return;
  }

  await prisma.hairdresser.update({
    where: { id: session.hairdresserId! },
    data: { autoApproveDeposit: amount > 0 ? amount : null },
  });
  await updateSession(chatId, HairdresserState.IDLE, {});
  await sendMessage(
    ctx,
    chatId,
    amount > 0
      ? `✅ بیعانه ثابت روی <b>${amount.toLocaleString()} تومان</b> تنظیم شد.\nرزروهای خودکار نیاز به پرداخت این مبلغ دارند.`
      : "✅ بیعانه ثابت حذف شد. رزروهای خودکار بدون پرداخت تایید می‌شن.",
    { reply_markup: makeHairdresserReplyMenu() }
  );
}

export async function handleNotifMenu(
  ctx: BotContext,
  query: TelegramCallbackQuery,
  session: Session
): Promise<void> {
  const chatId = String(query.message!.chat.id);

  await sendMessage(ctx, chatId, "📱 نوتیف‌هات رو از کجا دریافت کنی؟", {
    reply_markup: makeInlineKeyboard([
      [{ text: "فقط تلگرام", data: "hd:settings:notif:set:TELEGRAM_ONLY" }],
      [{ text: "فقط بله", data: "hd:settings:notif:set:BALE_ONLY" }],
      [{ text: "هر دو (تلگرام + بله)", data: "hd:settings:notif:set:BOTH" }],
    ]),
  });
}

export async function handleNotifSet(
  ctx: BotContext,
  query: TelegramCallbackQuery,
  session: Session,
  channel: string
): Promise<void> {
  const chatId = String(query.message!.chat.id);
  const validChannels = Object.values(NotificationChannel) as string[];
  if (!validChannels.includes(channel)) {
    await sendMessage(ctx, chatId, "مقدار نامعتبر.");
    return;
  }

  await prisma.hairdresser.update({
    where: { id: session.hairdresserId! },
    data: { notificationChannel: channel as NotificationChannel },
  });

  const label = {
    TELEGRAM_ONLY: "فقط تلگرام",
    BALE_ONLY: "فقط بله",
    BOTH: "تلگرام + بله",
  }[channel] ?? channel;

  await sendMessage(ctx, chatId, `✅ نوتیف‌ها از این به بعد روی «${label}» می‌رسن.`);
}

export async function handleHoursEditCallback(
  ctx: BotContext,
  query: TelegramCallbackQuery,
  session: Session
): Promise<void> {
  const chatId = String(query.message!.chat.id);
  const hairdresserId = session.hairdresserId!;

  const workingHours = await prisma.workingHours.findMany({
    where: { hairdresserId, isActive: true },
  });

  // Display in Iranian week order (شنبه first)
  const rows = IRAN_DAYS.map(({ name, jsDay }) => {
    const wh = workingHours.find((w) => w.dayOfWeek === jsDay);
    const label = wh
      ? `${name}: ${minutesToTime(wh.startMinuteOfDay)} - ${minutesToTime(wh.endMinuteOfDay)}`
      : `${name}: تعطیل`;
    return [{ text: label, data: `hd:hours:day:${jsDay}` }];
  });

  await sendMessage(ctx, chatId, "🕐 ساعت کاری:\nبرای ویرایش روز مورد نظر رو انتخاب کن:", {
    reply_markup: makeInlineKeyboard(rows),
  });
}

export async function handleHoursDayCallback(
  ctx: BotContext,
  query: TelegramCallbackQuery,
  session: Session,
  jsDay: number
): Promise<void> {
  const chatId = String(query.message!.chat.id);
  await mergeSessionPayload(chatId, { draftWorkingDay: jsDay });
  await updateSession(chatId, HairdresserState.WAIT_WORKING_START);
  await sendMessage(ctx, chatId, `ساعت شروع کار <b>${JS_DAY_NAME[jsDay]}</b> رو بنویس (مثلاً 9:00 یا 09:30):`, {
    reply_markup: makeInlineKeyboard([[{ text: "❌ لغو", data: "hd:cancel" }]]),
  });
}

export async function handleWorkingStart(
  ctx: BotContext,
  msg: TelegramMessage,
  session: Session
): Promise<void> {
  const chatId = String(msg.chat.id);
  const minutes = parseTimeInput(msg.text?.trim() ?? "");

  if (minutes === null) {
    await sendMessage(ctx, chatId, "فرمت نادرست. مثلاً: 9:00 یا 09:30", {
      reply_markup: makeInlineKeyboard([[{ text: "❌ لغو", data: "hd:cancel" }]]),
    });
    return;
  }

  await mergeSessionPayload(chatId, { draftWorkingStart: minutes });
  await updateSession(chatId, HairdresserState.WAIT_WORKING_END);
  await sendMessage(ctx, chatId, "ساعت پایان کار رو بنویس:", {
    reply_markup: makeInlineKeyboard([[{ text: "❌ لغو", data: "hd:cancel" }]]),
  });
}

export async function handleWorkingEnd(
  ctx: BotContext,
  msg: TelegramMessage,
  session: Session
): Promise<void> {
  const chatId = String(msg.chat.id);
  const payload = session.payload as { draftWorkingDay?: number; draftWorkingStart?: number };
  const endMinutes = parseTimeInput(msg.text?.trim() ?? "");

  if (endMinutes === null) {
    await sendMessage(ctx, chatId, "فرمت نادرست. مثلاً: 18:00", {
      reply_markup: makeInlineKeyboard([[{ text: "❌ لغو", data: "hd:cancel" }]]),
    });
    return;
  }

  const startMinutes = payload.draftWorkingStart ?? 0;
  if (endMinutes <= startMinutes) {
    await sendMessage(ctx, chatId, "ساعت پایان باید بعد از ساعت شروع باشه:", {
      reply_markup: makeInlineKeyboard([[{ text: "❌ لغو", data: "hd:cancel" }]]),
    });
    return;
  }

  const targetDay = payload.draftWorkingDay!;
  const hairdresserId = session.hairdresserId!;

  const existing = await prisma.workingHours.findFirst({ where: { hairdresserId, dayOfWeek: targetDay } });
  if (existing) {
    await prisma.workingHours.update({
      where: { id: existing.id },
      data: { startMinuteOfDay: startMinutes, endMinuteOfDay: endMinutes, isActive: true },
    });
  } else {
    await prisma.workingHours.create({
      data: { hairdresserId, dayOfWeek: targetDay, startMinuteOfDay: startMinutes, endMinuteOfDay: endMinutes },
    });
  }

  await updateSession(chatId, HairdresserState.IDLE, {});
  await sendMessage(ctx, chatId, "✅ ساعت کاری ذخیره شد!", { reply_markup: makeHairdresserReplyMenu() });
}

export async function handleBlockAddCallback(
  ctx: BotContext,
  query: TelegramCallbackQuery,
  session: Session
): Promise<void> {
  const chatId = String(query.message!.chat.id);
  await updateSession(chatId, HairdresserState.WAIT_BLOCK_START);
  await sendMessage(ctx, chatId, "زمان شروع مسدودسازی رو بنویس (مثلاً: 2026-06-01 10:00):", {
    reply_markup: makeInlineKeyboard([[{ text: "❌ لغو", data: "hd:cancel" }]]),
  });
}

export async function handleBlockStart(
  ctx: BotContext,
  msg: TelegramMessage,
  session: Session
): Promise<void> {
  const chatId = String(msg.chat.id);
  const dt = parseDateTimeInput(msg.text?.trim() ?? "");

  if (!dt) {
    await sendMessage(ctx, chatId, "فرمت نادرست. مثلاً: 2026-06-01 10:00", {
      reply_markup: makeInlineKeyboard([[{ text: "❌ لغو", data: "hd:cancel" }]]),
    });
    return;
  }

  await mergeSessionPayload(chatId, { draftBlockStart: dt.toISOString() });
  await updateSession(chatId, HairdresserState.WAIT_BLOCK_END);
  await sendMessage(ctx, chatId, `شروع: ${formatJalaliDateTime(dt)}\n\nزمان پایان مسدودسازی:`, {
    reply_markup: makeInlineKeyboard([[{ text: "❌ لغو", data: "hd:cancel" }]]),
  });
}

export async function handleBlockEnd(
  ctx: BotContext,
  msg: TelegramMessage,
  session: Session
): Promise<void> {
  const chatId = String(msg.chat.id);
  const payload = session.payload as { draftBlockStart?: string };
  const endDt = parseDateTimeInput(msg.text?.trim() ?? "");

  if (!endDt) {
    await sendMessage(ctx, chatId, "فرمت نادرست. مثلاً: 2026-06-01 18:00", {
      reply_markup: makeInlineKeyboard([[{ text: "❌ لغو", data: "hd:cancel" }]]),
    });
    return;
  }

  const startDt = new Date(payload.draftBlockStart!);
  if (endDt <= startDt) {
    await sendMessage(ctx, chatId, "زمان پایان باید بعد از زمان شروع باشه:", {
      reply_markup: makeInlineKeyboard([[{ text: "❌ لغو", data: "hd:cancel" }]]),
    });
    return;
  }

  await mergeSessionPayload(chatId, { draftBlockEnd: endDt.toISOString() });
  await updateSession(chatId, HairdresserState.WAIT_BLOCK_REASON);
  await sendMessage(ctx, chatId, "دلیل مسدودسازی رو بنویس (اختیاری):", {
    reply_markup: makeInlineKeyboard([
      [{ text: "بدون دلیل", data: "hd:block:noreason" }],
      [{ text: "❌ لغو", data: "hd:cancel" }],
    ]),
  });
}

export async function handleBlockReason(
  ctx: BotContext,
  msg: TelegramMessage,
  session: Session
): Promise<void> {
  const chatId = String(msg.chat.id);
  const payload = session.payload as { draftBlockStart?: string; draftBlockEnd?: string };
  await saveBlockedTime(ctx, chatId, session, payload.draftBlockStart!, payload.draftBlockEnd!, msg.text?.trim() || null);
}

export async function handleBlockNoReasonCallback(
  ctx: BotContext,
  query: TelegramCallbackQuery,
  session: Session
): Promise<void> {
  const chatId = String(query.message!.chat.id);
  const payload = session.payload as { draftBlockStart?: string; draftBlockEnd?: string };
  await saveBlockedTime(ctx, chatId, session, payload.draftBlockStart!, payload.draftBlockEnd!, null);
}

async function saveBlockedTime(
  ctx: BotContext,
  chatId: string,
  session: Session,
  startIso: string,
  endIso: string,
  reason: string | null
): Promise<void> {
  const start = new Date(startIso);
  const end = new Date(endIso);
  await prisma.blockedTime.create({
    data: { hairdresserId: session.hairdresserId!, startsAt: start, endsAt: end, reason },
  });
  await updateSession(chatId, HairdresserState.IDLE, {});
  await sendMessage(
    ctx,
    chatId,
    `✅ زمان مسدود شد!\n${formatJalaliDateTime(start)} تا ${formatJalaliDateTime(end)}`,
    { reply_markup: makeHairdresserReplyMenu() }
  );
}

function minutesToTime(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

function parseTimeInput(input: string): number | null {
  const match = input.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const h = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

function parseDateTimeInput(input: string): Date | null {
  const match = input.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const [, y, mo, d, h, m] = match.map(Number);
  const dt = new Date(`${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00+03:30`);
  return isNaN(dt.getTime()) ? null : dt;
}
