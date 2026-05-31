import { prisma } from "@/lib/prisma";
import { sendMessage } from "@/bot/telegram/client";
import { updateSession, mergeSessionPayload } from "@/bot/session";
import { HairdresserState } from "@/bot/states";
import type { BotContext } from "@/bot/telegram/client";
import type { Session } from "@/bot/session";
import type { TelegramMessage, TelegramCallbackQuery } from "@/bot/telegram/types";

export async function handleServiceAddCallback(
  ctx: BotContext,
  query: TelegramCallbackQuery,
  session: Session
): Promise<void> {
  const chatId = String(query.message!.chat.id);
  const hairdresserId = session.hairdresserId!;

  const categories = await prisma.serviceCategory.findMany({
    where: { hairdresserId, isActive: true },
    orderBy: { sortOrder: "asc" },
  });

  if (categories.length > 0) {
    const rows = categories.map((c) => [
      { text: c.title, callback_data: `hd:service:category:${c.id}` },
    ]);
    rows.push([{ text: "➕ دسته‌بندی جدید", callback_data: "hd:service:category:new" }]);
    await updateSession(chatId, HairdresserState.WAIT_NEW_CATEGORY);
    await sendMessage(ctx, chatId, "یه دسته‌بندی انتخاب کن یا دسته‌بندی جدید بساز:", {
      reply_markup: { inline_keyboard: rows },
    });
  } else {
    await updateSession(chatId, HairdresserState.WAIT_NEW_CATEGORY);
    await sendMessage(ctx, chatId, "اسم دسته‌بندی جدید رو بنویس:");
  }
}

export async function handleServiceCategoryCallback(
  ctx: BotContext,
  query: TelegramCallbackQuery,
  session: Session,
  categoryId: string
): Promise<void> {
  const chatId = String(query.message!.chat.id);

  if (categoryId === "new") {
    await updateSession(chatId, HairdresserState.WAIT_NEW_CATEGORY);
    await sendMessage(ctx, chatId, "اسم دسته‌بندی جدید رو بنویس:");
    return;
  }

  await mergeSessionPayload(chatId, { targetCategoryId: categoryId });
  await updateSession(chatId, HairdresserState.WAIT_NEW_SERVICE_NAME);
  await sendMessage(ctx, chatId, "اسم سرویس جدید رو بنویس:");
}

export async function handleNewCategoryName(
  ctx: BotContext,
  msg: TelegramMessage,
  session: Session
): Promise<void> {
  const chatId = String(msg.chat.id);
  const title = msg.text?.trim();

  if (!title || title.length < 2) {
    await sendMessage(ctx, chatId, "اسم دسته‌بندی باید حداقل ۲ کاراکتر باشه:");
    return;
  }

  const category = await prisma.serviceCategory.create({
    data: { hairdresserId: session.hairdresserId!, title, sortOrder: 0 },
  });

  await mergeSessionPayload(chatId, { targetCategoryId: category.id, draftCategoryTitle: title });
  await updateSession(chatId, HairdresserState.WAIT_NEW_SERVICE_NAME);
  await sendMessage(ctx, chatId, `دسته‌بندی «${title}» ساخته شد.\nحالا اسم سرویس رو بنویس:`);
}

export async function handleNewServiceName(
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
  await updateSession(chatId, HairdresserState.WAIT_NEW_SERVICE_DURATION);
  await sendMessage(ctx, chatId, `مدت زمان سرویس «${name}» چقدره؟ (مضرب ۳۰ دقیقه)`);
}

export async function handleNewServiceDuration(
  ctx: BotContext,
  msg: TelegramMessage,
  session: Session
): Promise<void> {
  const chatId = String(msg.chat.id);
  const minutes = parseInt(msg.text?.trim() ?? "", 10);

  if (isNaN(minutes) || minutes <= 0 || minutes % 30 !== 0) {
    await sendMessage(ctx, chatId, "مدت زمان باید مضرب ۳۰ دقیقه باشه (مثلاً 30، 60، 90، 120):");
    return;
  }

  await mergeSessionPayload(chatId, { draftDurationMinutes: minutes });
  await updateSession(chatId, HairdresserState.WAIT_NEW_SERVICE_PRICE_MIN);
  await sendMessage(ctx, chatId, "حداقل قیمت (تومان):");
}

export async function handleNewServicePriceMin(
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
  await updateSession(chatId, HairdresserState.WAIT_NEW_SERVICE_PRICE_MAX);
  await sendMessage(ctx, chatId, "حداکثر قیمت (تومان):");
}

export async function handleNewServicePriceMax(
  ctx: BotContext,
  msg: TelegramMessage,
  session: Session
): Promise<void> {
  const chatId = String(msg.chat.id);
  const payload = session.payload as {
    targetCategoryId?: string;
    draftServiceTitle?: string;
    draftDurationMinutes?: number;
    draftPriceMinToman?: number;
  };
  const priceMax = parseInt(msg.text?.trim().replace(/,/g, "") ?? "", 10);

  if (isNaN(priceMax) || priceMax < 0) {
    await sendMessage(ctx, chatId, "قیمت باید عدد مثبت باشه:");
    return;
  }

  const priceMin = payload.draftPriceMinToman ?? 0;
  if (priceMax < priceMin) {
    await sendMessage(ctx, chatId, `حداکثر نمی‌تونه کمتر از حداقل (${priceMin.toLocaleString()} تومان) باشه:`);
    return;
  }

  if (!payload.targetCategoryId || !payload.draftServiceTitle || !payload.draftDurationMinutes) {
    await sendMessage(ctx, chatId, "مشکلی پیش اومد. دوباره امتحان کن.");
    await updateSession(chatId, HairdresserState.IDLE, {});
    return;
  }

  const service = await prisma.service.create({
    data: {
      hairdresserId: session.hairdresserId!,
      categoryId: payload.targetCategoryId,
      title: payload.draftServiceTitle,
      durationMinutes: payload.draftDurationMinutes,
      priceMinToman: priceMin,
      priceMaxToman: priceMax,
    },
  });

  await updateSession(chatId, HairdresserState.IDLE, {});
  await sendMessage(
    ctx,
    chatId,
    `✅ سرویس «${service.title}» اضافه شد!\n${service.durationMinutes} دقیقه | ${priceMin.toLocaleString()} - ${priceMax.toLocaleString()} تومان`,
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: "➕ سرویس دیگه‌ای اضافه کن", callback_data: "hd:service:add" }],
          [{ text: "📋 منوی اصلی", callback_data: "hd:menu:today" }],
        ],
      },
    }
  );
}
