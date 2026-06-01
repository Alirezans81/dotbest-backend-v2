import { prisma } from "@/lib/prisma";
import { normalizePhoneNumber } from "@/lib/phone";
import { generateBookingSlug } from "@/lib/slug";
import { syncHairdresserPlatform } from "@/lib/sync";
import { IRAN_DAYS, iranIndexToJsDay } from "@/lib/days";
import { sendMessage, makeContactKeyboard, removeKeyboard, makeInlineKeyboard, makeHairdresserReplyMenu, makeCancelRow } from "@/bot/telegram/client";
import { updateSession, mergeSessionPayload, linkHairdresserToSession } from "@/bot/session";
import { HairdresserState } from "@/bot/states";
import type { BotContext } from "@/bot/telegram/client";
import type { Session } from "@/bot/session";
import type { TelegramMessage, TelegramCallbackQuery } from "@/bot/telegram/types";

export async function handleHairdresserStart(
  ctx: BotContext,
  msg: TelegramMessage,
  session: Session
): Promise<void> {
  const chatId = String(msg.chat.id);

  const existing = await prisma.hairdresser.findFirst({
    where: { telegramUserId: String(msg.from!.id) },
  });

  if (existing && existing.isOnboardingCompleted) {
    await sendMessage(ctx, chatId, "سلام! به پنل مدیریت خوش اومدی.", {
      reply_markup: makeHairdresserReplyMenu(),
    });
    await updateSession(chatId, HairdresserState.IDLE);
    return;
  }

  await sendMessage(ctx, chatId, "سلام 👋\nبه سیستم رزرو خوش اومدی!\n\nبرای شروع، شماره موبایلت رو بفرست:", {
    reply_markup: makeContactKeyboard(),
  });
  await updateSession(chatId, HairdresserState.WAIT_CONTACT);
}

export async function handleHairdresserContact(
  ctx: BotContext,
  msg: TelegramMessage,
  session: Session
): Promise<void> {
  const chatId = String(msg.chat.id);

  let phone: string | null = null;
  if (msg.contact) {
    phone = normalizePhoneNumber(msg.contact.phone_number);
  } else if (msg.text) {
    phone = normalizePhoneNumber(msg.text);
  }

  if (!phone) {
    await sendMessage(ctx, chatId, "شماره موبایل معتبر نیست. لطفاً شماره‌ات رو با دکمه زیر بفرست یا عدد وارد کن:", {
      reply_markup: makeContactKeyboard(),
    });
    return;
  }

  await mergeSessionPayload(chatId, { pendingPhone: phone });
  await updateSession(chatId, HairdresserState.WAIT_NAME);
  await sendMessage(ctx, chatId, "ممنون! حالا اسمت رو بنویس:", { reply_markup: removeKeyboard() });
}

export async function handleHairdresserName(
  ctx: BotContext,
  msg: TelegramMessage,
  session: Session
): Promise<void> {
  const chatId = String(msg.chat.id);
  const name = msg.text?.trim();

  if (!name || name.length < 2) {
    await sendMessage(ctx, chatId, "اسم باید حداقل ۲ کاراکتر باشه. دوباره امتحان کن:");
    return;
  }

  const payload = session.payload as { pendingPhone?: string };
  const phone = payload.pendingPhone;

  if (!phone) {
    await sendMessage(ctx, chatId, "مشکلی پیش اومد. دوباره /start رو بزن.");
    await updateSession(chatId, HairdresserState.IDLE, {});
    return;
  }

  const userId = String(msg.from!.id);

  // Try to find or sync an existing hairdresser by phone across platforms
  const syncResult = await syncHairdresserPlatform(phone, ctx.platform, userId, chatId);

  let hairdresser = syncResult.id
    ? await prisma.hairdresser.findUnique({ where: { id: syncResult.id } })
    : null;

  if (!hairdresser) {
    // Brand-new hairdresser — find by userId on this platform as fallback
    const userIdField = ctx.platform === "BALE" ? "baleUserId" : "telegramUserId";
    hairdresser = await prisma.hairdresser.findFirst({ where: { [userIdField]: userId } });
  }

  if (!hairdresser) {
    const createData =
      ctx.platform === "BALE"
        ? { baleUserId: userId, baleChatId: chatId }
        : { telegramUserId: userId, telegramChatId: chatId };

    hairdresser = await prisma.hairdresser.create({
      data: { ...createData, fullName: name, phoneNumber: phone, bookingSlug: generateBookingSlug() },
    });
  } else {
    const updateData =
      ctx.platform === "BALE"
        ? { baleUserId: userId, baleChatId: chatId, fullName: name }
        : { telegramUserId: userId, telegramChatId: chatId, fullName: name };

    hairdresser = await prisma.hairdresser.update({
      where: { id: hairdresser.id },
      data: updateData,
    });
  }

  await linkHairdresserToSession(chatId, hairdresser.id);
  await updateSession(chatId, HairdresserState.WAIT_FIRST_CATEGORY, { hairdresserId: hairdresser.id });
  await sendMessage(
    ctx,
    chatId,
    `خوبه ${name}! حالا بیا خدماتت رو تعریف کنیم.\n\nاول باید یه دسته‌بندی بسازی. مثلاً: کوتاهی، رنگ، ناخن\n\nاسم دسته‌بندی رو بنویس:`
  );
}

export async function handleHairdresserFirstCategory(
  ctx: BotContext,
  msg: TelegramMessage,
  session: Session
): Promise<void> {
  const chatId = String(msg.chat.id);
  const title = msg.text?.trim();

  if (!title || title.length < 2) {
    await sendMessage(ctx, chatId, "اسم دسته‌بندی باید حداقل ۲ کاراکتر باشه. دوباره امتحان کن:");
    return;
  }

  await mergeSessionPayload(chatId, { draftCategoryTitle: title });
  await updateSession(chatId, HairdresserState.WAIT_FIRST_SERVICE_NAME);
  await sendMessage(ctx, chatId, `دسته‌بندی «${title}» ثبت شد.\n\nحالا اسم اولین سرویس رو بنویس:\nمثلاً: کراتین مو، رنگ کامل`);
}

export async function handleHairdresserFirstServiceName(
  ctx: BotContext,
  msg: TelegramMessage,
  session: Session
): Promise<void> {
  const chatId = String(msg.chat.id);
  const name = msg.text?.trim();

  if (!name || name.length < 2) {
    await sendMessage(ctx, chatId, "اسم سرویس باید حداقل ۲ کاراکتر باشه:");
    return;
  }

  await mergeSessionPayload(chatId, { draftServiceTitle: name });
  await updateSession(chatId, HairdresserState.WAIT_FIRST_SERVICE_DURATION);
  await sendMessage(ctx, chatId, `سرویس «${name}» ثبت شد.\n\nمدت زمان این سرویس چقدره؟\nفقط مضرب ۳۰ دقیقه وارد کن (مثلاً: 30، 60، 90، 120)`);
}

export async function handleHairdresserFirstServiceDuration(
  ctx: BotContext,
  msg: TelegramMessage,
  session: Session
): Promise<void> {
  const chatId = String(msg.chat.id);
  const minutes = parseInt(msg.text?.trim() ?? "", 10);

  if (isNaN(minutes) || minutes <= 0 || minutes % 30 !== 0) {
    await sendMessage(ctx, chatId, "مدت زمان باید مضرب ۳۰ دقیقه باشه. مثلاً: 30، 60، 90، 120");
    return;
  }

  await mergeSessionPayload(chatId, { draftDurationMinutes: minutes });
  await updateSession(chatId, HairdresserState.WAIT_FIRST_SERVICE_PRICE_MIN);
  await sendMessage(ctx, chatId, "حداقل قیمت این سرویس چقدره؟ (تومان، عدد بنویس)");
}

export async function handleHairdresserFirstServicePriceMin(
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

  await mergeSessionPayload(chatId, { draftPriceMinToman: price });
  await updateSession(chatId, HairdresserState.WAIT_FIRST_SERVICE_PRICE_MAX);
  await sendMessage(ctx, chatId, "حداکثر قیمت این سرویس چقدره؟ (باید بیشتر یا مساوی حداقل باشه)");
}

export async function handleHairdresserFirstServicePriceMax(
  ctx: BotContext,
  msg: TelegramMessage,
  session: Session
): Promise<void> {
  const chatId = String(msg.chat.id);
  const priceMax = parseInt(msg.text?.trim().replace(/,/g, "") ?? "", 10);
  const payload = session.payload as {
    hairdresserId?: string;
    draftCategoryTitle?: string;
    draftServiceTitle?: string;
    draftDurationMinutes?: number;
    draftPriceMinToman?: number;
  };

  if (isNaN(priceMax) || priceMax < 0) {
    await sendMessage(ctx, chatId, "قیمت باید عدد مثبت باشه:");
    return;
  }

  const priceMin = payload.draftPriceMinToman ?? 0;
  if (priceMax < priceMin) {
    await sendMessage(ctx, chatId, `حداکثر قیمت نمی‌تونه کمتر از حداقل (${priceMin.toLocaleString()} تومان) باشه:`);
    return;
  }

  const { hairdresserId, draftCategoryTitle, draftServiceTitle, draftDurationMinutes } = payload;
  if (!hairdresserId || !draftCategoryTitle || !draftServiceTitle || !draftDurationMinutes) {
    await sendMessage(ctx, chatId, "مشکلی پیش اومد. دوباره /start رو بزن.");
    await updateSession(chatId, HairdresserState.IDLE, {});
    return;
  }

  const category = await prisma.serviceCategory.create({
    data: { hairdresserId, title: draftCategoryTitle, sortOrder: 0 },
  });

  await prisma.service.create({
    data: {
      hairdresserId,
      categoryId: category.id,
      title: draftServiceTitle,
      durationMinutes: draftDurationMinutes,
      priceMinToman: priceMin,
      priceMaxToman: priceMax,
    },
  });

  // Don't mark onboarding complete yet — working hours step is next
  await updateSession(chatId, HairdresserState.WAIT_ONBOARDING_HOURS_CONFIRM, {
    hairdresserId,
    onboardingIranDayIndex: 0,
  });

  await sendMessage(ctx, chatId, "عالیه! حالا ساعت کاریت رو تنظیم کن.\n\nاین کار باعث میشه مشتریا فقط تو ساعت‌های درست رزرو کنن 🕐");
  await askOnboardingDayConfirm(ctx, chatId, 0);
}

export function makeHairdresserMainMenu() {
  return {
    inline_keyboard: [
      [{ text: "📅 نوبت‌های امروز", callback_data: "hd:menu:today" }],
      [{ text: "👥 مشتریان", callback_data: "hd:menu:customers" }],
      [{ text: "➕ سرویس جدید", callback_data: "hd:service:add" }],
      [{ text: "⚙️ تنظیمات", callback_data: "hd:menu:settings" }],
    ],
  };
}

// ─── Onboarding Working Hours ─────────────────────────────────────────────────

async function askOnboardingDayConfirm(
  ctx: BotContext,
  chatId: string,
  iranDayIndex: number
): Promise<void> {
  const day = IRAN_DAYS[iranDayIndex];
  await sendMessage(ctx, chatId, `روز <b>${day.name}</b> کار می‌کنی؟`, {
    reply_markup: makeInlineKeyboard([
      [
        { text: "✅ بله", data: `hd:onboarding:hours:yes:${iranDayIndex}` },
        { text: "❌ تعطیله", data: `hd:onboarding:hours:skip:${iranDayIndex}` },
      ],
    ]),
  });
}

export async function handleOnboardingHoursYes(
  ctx: BotContext,
  query: TelegramCallbackQuery,
  session: Session,
  iranDayIndex: number
): Promise<void> {
  const chatId = String(query.message!.chat.id);
  const day = IRAN_DAYS[iranDayIndex];

  await mergeSessionPayload(chatId, { onboardingIranDayIndex: iranDayIndex });
  await updateSession(chatId, HairdresserState.WAIT_ONBOARDING_HOURS_START);
  await sendMessage(ctx, chatId, `ساعت شروع کار <b>${day.name}</b> چنده؟ (مثلاً 9:00 یا 08:30)`);
}

export async function handleOnboardingHoursSkip(
  ctx: BotContext,
  query: TelegramCallbackQuery,
  session: Session,
  iranDayIndex: number
): Promise<void> {
  const chatId = String(query.message!.chat.id);
  await advanceOnboardingDay(ctx, chatId, session, iranDayIndex);
}

export async function handleOnboardingHoursStart(
  ctx: BotContext,
  msg: TelegramMessage,
  session: Session
): Promise<void> {
  const chatId = String(msg.chat.id);
  const startMinutes = parseTimeInput(msg.text?.trim() ?? "");

  if (startMinutes === null) {
    await sendMessage(ctx, chatId, "فرمت نادرست. مثلاً: 9:00 یا 08:30", {
      reply_markup: makeInlineKeyboard([[makeCancelRow()[0]].map((b) => ({ text: b.text, data: b.callback_data }))]),
    });
    return;
  }

  await mergeSessionPayload(chatId, { onboardingHourStart: startMinutes });
  await updateSession(chatId, HairdresserState.WAIT_ONBOARDING_HOURS_END);

  const payload = session.payload as { onboardingIranDayIndex?: number };
  const day = IRAN_DAYS[payload.onboardingIranDayIndex ?? 0];
  await sendMessage(ctx, chatId, `ساعت پایان کار <b>${day.name}</b> چنده؟`, {
    reply_markup: makeInlineKeyboard([[{ text: "❌ لغو", data: "hd:cancel" }]]),
  });
}

export async function handleOnboardingHoursEnd(
  ctx: BotContext,
  msg: TelegramMessage,
  session: Session
): Promise<void> {
  const chatId = String(msg.chat.id);
  const payload = session.payload as {
    hairdresserId?: string;
    onboardingIranDayIndex?: number;
    onboardingHourStart?: number;
  };

  const endMinutes = parseTimeInput(msg.text?.trim() ?? "");
  if (endMinutes === null) {
    await sendMessage(ctx, chatId, "فرمت نادرست. مثلاً: 18:00 یا 20:30");
    return;
  }

  const startMinutes = payload.onboardingHourStart ?? 0;
  if (endMinutes <= startMinutes) {
    await sendMessage(ctx, chatId, "ساعت پایان باید بعد از ساعت شروع باشه:");
    return;
  }

  const iranDayIndex = payload.onboardingIranDayIndex ?? 0;
  const jsDay = iranIndexToJsDay(iranDayIndex);

  const existingWh = await prisma.workingHours.findFirst({
    where: { hairdresserId: payload.hairdresserId!, dayOfWeek: jsDay },
  });
  if (existingWh) {
    await prisma.workingHours.update({
      where: { id: existingWh.id },
      data: { startMinuteOfDay: startMinutes, endMinuteOfDay: endMinutes, isActive: true },
    });
  } else {
    await prisma.workingHours.create({
      data: { hairdresserId: payload.hairdresserId!, dayOfWeek: jsDay, startMinuteOfDay: startMinutes, endMinuteOfDay: endMinutes },
    });
  }

  await advanceOnboardingDay(ctx, chatId, session, iranDayIndex);
}

async function advanceOnboardingDay(
  ctx: BotContext,
  chatId: string,
  session: Session,
  currentIranDayIndex: number
): Promise<void> {
  const nextIndex = currentIranDayIndex + 1;

  if (nextIndex < IRAN_DAYS.length) {
    await mergeSessionPayload(chatId, { onboardingIranDayIndex: nextIndex });
    await updateSession(chatId, HairdresserState.WAIT_ONBOARDING_HOURS_CONFIRM);
    await askOnboardingDayConfirm(ctx, chatId, nextIndex);
    return;
  }

  // All days processed — finish onboarding
  const payload = session.payload as { hairdresserId?: string };
  await prisma.hairdresser.update({
    where: { id: payload.hairdresserId! },
    data: { isOnboardingCompleted: true },
  });

  const hairdresser = await prisma.hairdresser.findUnique({
    where: { id: payload.hairdresserId! },
  });

  const botUsername = ctx.platform === "BALE"
    ? process.env.BALE_BOT_USERNAME!
    : process.env.TELEGRAM_BOT_USERNAME!;
  const deepLink = `https://t.me/${botUsername}?start=hd_${hairdresser!.bookingSlug}`;

  await updateSession(chatId, HairdresserState.IDLE, {});
  await sendMessage(
    ctx,
    chatId,
    `🎉 ثبت‌نام کامل شد!\n\nلینک رزرو اختصاصیت:\n<code>${deepLink}</code>\n\nاین لینک رو:\n• در بیو اینستاگرامت بذار\n• در واتساپت بذار\n• روی QR یا جلوی مغازه بذار\n\nمشتریا مستقیم از همین لینک نوبت می‌گیرن 👍`,
    { reply_markup: makeHairdresserReplyMenu() }
  );
}

function parseTimeInput(input: string): number | null {
  const match = input.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const h = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}
