import { prisma } from "@/lib/prisma";
import { sendMessage, makeInlineKeyboard } from "@/bot/telegram/client";
import { updateSession, mergeSessionPayload } from "@/bot/session";
import { HairdresserState } from "@/bot/states";
import { formatTehranDateTime, TIMEZONE } from "@/lib/time";
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
    include: { customer: true, service: true },
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
    lines.push(`${statusLabel} ${formatTehranDateTime(b.requestedStartAt)} — ${b.customer.fullName} — ${b.service.title}`);
  }

  await sendMessage(ctx, chatId, lines.join("\n"));
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
    lines.push(`${statusEmoji[b.status] ?? "•"} ${formatTehranDateTime(b.requestedStartAt)} — ${b.service.title}`);
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
  const notifLabel = {
    [NotificationChannel.TELEGRAM_ONLY]: "📱 نوتیف: فقط تلگرام",
    [NotificationChannel.BALE_ONLY]: "📱 نوتیف: فقط بله",
    [NotificationChannel.BOTH]: "📱 نوتیف: تلگرام + بله",
  }[hairdresser.notificationChannel];

  await sendMessage(ctx, chatId, "⚙️ تنظیمات:", {
    reply_markup: makeInlineKeyboard([
      [{ text: "🕐 ساعت کاری", data: "hd:hours:edit" }],
      [{ text: "🚫 زمان مسدود", data: "hd:block:add" }],
      [{ text: autoLabel, data: "hd:settings:autoapprove:toggle" }],
      [{ text: notifLabel, data: "hd:settings:notif:menu" }],
    ]),
  });
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
  const days = ["یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه", "شنبه"];

  const workingHours = await prisma.workingHours.findMany({
    where: { hairdresserId, isActive: true },
    orderBy: { dayOfWeek: "asc" },
  });

  const rows = days.map((dayName, index) => {
    const wh = workingHours.find((w) => w.dayOfWeek === index);
    const label = wh
      ? `${dayName}: ${minutesToTime(wh.startMinuteOfDay)} - ${minutesToTime(wh.endMinuteOfDay)}`
      : `${dayName}: تعطیل`;
    return [{ text: label, data: `hd:hours:day:${index}` }];
  });

  await sendMessage(ctx, chatId, "🕐 ساعت کاری:\nبرای ویرایش روز مورد نظر رو انتخاب کن:", {
    reply_markup: makeInlineKeyboard(rows),
  });
}

export async function handleHoursDayCallback(
  ctx: BotContext,
  query: TelegramCallbackQuery,
  session: Session,
  dow: number
): Promise<void> {
  const chatId = String(query.message!.chat.id);
  const days = ["یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه", "شنبه"];

  await mergeSessionPayload(chatId, { draftWorkingDay: dow });
  await updateSession(chatId, HairdresserState.WAIT_WORKING_START);
  await sendMessage(ctx, chatId, `ساعت شروع کار ${days[dow]} رو بنویس (مثلاً 9:00 یا 09:30):`);
}

export async function handleWorkingStart(
  ctx: BotContext,
  msg: TelegramMessage,
  session: Session
): Promise<void> {
  const chatId = String(msg.chat.id);
  const minutes = parseTimeInput(msg.text?.trim() ?? "");

  if (minutes === null) {
    await sendMessage(ctx, chatId, "فرمت نادرست. مثلاً: 9:00 یا 09:30");
    return;
  }

  await mergeSessionPayload(chatId, { draftWorkingStart: minutes });
  await updateSession(chatId, HairdresserState.WAIT_WORKING_END);
  await sendMessage(ctx, chatId, "ساعت پایان کار رو بنویس:");
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
    await sendMessage(ctx, chatId, "فرمت نادرست. مثلاً: 18:00");
    return;
  }

  const startMinutes = payload.draftWorkingStart ?? 0;
  if (endMinutes <= startMinutes) {
    await sendMessage(ctx, chatId, "ساعت پایان باید بعد از ساعت شروع باشه:");
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
  await sendMessage(ctx, chatId, "✅ ساعت کاری ذخیره شد!");
}

export async function handleBlockAddCallback(
  ctx: BotContext,
  query: TelegramCallbackQuery,
  session: Session
): Promise<void> {
  const chatId = String(query.message!.chat.id);
  await updateSession(chatId, HairdresserState.WAIT_BLOCK_START);
  await sendMessage(ctx, chatId, "زمان شروع مسدودسازی رو بنویس (مثلاً: 2026-06-01 10:00):");
}

export async function handleBlockStart(
  ctx: BotContext,
  msg: TelegramMessage,
  session: Session
): Promise<void> {
  const chatId = String(msg.chat.id);
  const dt = parseDateTimeInput(msg.text?.trim() ?? "");

  if (!dt) {
    await sendMessage(ctx, chatId, "فرمت نادرست. مثلاً: 2026-06-01 10:00");
    return;
  }

  await mergeSessionPayload(chatId, { draftBlockStart: dt.toISOString() });
  await updateSession(chatId, HairdresserState.WAIT_BLOCK_END);
  await sendMessage(ctx, chatId, "زمان پایان مسدودسازی:");
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
    await sendMessage(ctx, chatId, "فرمت نادرست. مثلاً: 2026-06-01 18:00");
    return;
  }

  const startDt = new Date(payload.draftBlockStart!);
  if (endDt <= startDt) {
    await sendMessage(ctx, chatId, "زمان پایان باید بعد از زمان شروع باشه:");
    return;
  }

  await mergeSessionPayload(chatId, { draftBlockEnd: endDt.toISOString() });
  await updateSession(chatId, HairdresserState.WAIT_BLOCK_REASON);
  await sendMessage(ctx, chatId, "دلیل مسدودسازی (اختیاری) یا «رد» بزن:");
}

export async function handleBlockReason(
  ctx: BotContext,
  msg: TelegramMessage,
  session: Session
): Promise<void> {
  const chatId = String(msg.chat.id);
  const payload = session.payload as { draftBlockStart?: string; draftBlockEnd?: string };
  const reason = msg.text?.trim();
  const effectiveReason = reason && reason !== "رد" ? reason : null;

  await prisma.blockedTime.create({
    data: {
      hairdresserId: session.hairdresserId!,
      startsAt: new Date(payload.draftBlockStart!),
      endsAt: new Date(payload.draftBlockEnd!),
      reason: effectiveReason,
    },
  });

  await updateSession(chatId, HairdresserState.IDLE, {});
  await sendMessage(ctx, chatId, "✅ زمان مسدود شد!");
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
