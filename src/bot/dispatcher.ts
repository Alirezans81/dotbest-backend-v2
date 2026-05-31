import { prisma } from "@/lib/prisma";
import { getOrCreateHairdresserSession, getOrCreateCustomerSession, updateSession } from "./session";
import { HairdresserState, CustomerState } from "./states";
import { ConversationActorType } from "@prisma/client";
import { sendMessage, answerCallbackQuery } from "./telegram/client";
import type { BotContext } from "./telegram/client";
import type { TelegramUpdate, TelegramMessage, TelegramCallbackQuery } from "./telegram/types";

import {
  handleHairdresserStart,
  handleHairdresserContact,
  handleHairdresserName,
  handleHairdresserFirstCategory,
  handleHairdresserFirstServiceName,
  handleHairdresserFirstServiceDuration,
  handleHairdresserFirstServicePriceMin,
  handleHairdresserFirstServicePriceMax,
  makeHairdresserMainMenu,
} from "./handlers/hairdresser/onboarding";

import {
  handleServiceAddCallback,
  handleServiceCategoryCallback,
  handleNewCategoryName,
  handleNewServiceName,
  handleNewServiceDuration,
  handleNewServicePriceMin,
  handleNewServicePriceMax,
} from "./handlers/hairdresser/services";

import {
  handleBookingApproveCallback,
  handleApprovalQuoteMin,
  handleApprovalQuoteMax,
  handleApprovalDeposit,
  handleBookingRejectCallback,
  handleRejectionReason,
} from "./handlers/hairdresser/booking-review";

import {
  handleTodayMenu,
  handleCustomersMenu,
  handleBookingViewCallback,
  handleSettingsMenu,
  handleAutoApproveToggle,
  handleNotifMenu,
  handleNotifSet,
  handleHoursEditCallback,
  handleHoursDayCallback,
  handleWorkingStart,
  handleWorkingEnd,
  handleBlockAddCallback,
  handleBlockStart,
  handleBlockEnd,
  handleBlockReason,
} from "./handlers/hairdresser/schedule";

import {
  handleCustomerDeepLink,
  handleCustomerCategoryCallback,
  handleCustomerServiceCallback,
  handleCustomerDateCallback,
  handleCustomerSlotCallback,
  handleCustomerDescriptionSkip,
  handleCustomerDescription,
  handleCustomerAttachmentSkip,
  handleCustomerBookingSubmit,
} from "./handlers/customer/booking";

import {
  handleCustomerPayCallback,
  handleCustomerCancelRequest,
  handleCustomerCancelConfirm,
  handleCustomerCancelAbort,
} from "./handlers/customer/payment";

export async function dispatch(update: TelegramUpdate, ctx: BotContext): Promise<void> {
  if (update.message) {
    await handleMessage(ctx, update.message);
  } else if (update.callback_query) {
    await handleCallbackQuery(ctx, update.callback_query);
  }
}

async function handleMessage(ctx: BotContext, msg: TelegramMessage): Promise<void> {
  const userId = String(msg.from?.id);
  const chatId = String(msg.chat.id);
  const text = msg.text ?? "";

  // deep link from customer: /start hd_<slug>
  if (text.startsWith("/start hd_")) {
    const slug = text.replace("/start hd_", "").trim();
    const session = await getOrCreateCustomerSession(chatId);
    await handleCustomerDeepLink(ctx, msg, session, slug);
    return;
  }

  const hairdresser = await prisma.hairdresser.findFirst({ where: { telegramUserId: userId } });

  if (hairdresser || text === "/start") {
    await handleHairdresserMessage(ctx, msg, hairdresser?.id);
    return;
  }

  const session = await getOrCreateCustomerSession(chatId);
  if (session.actorType === ConversationActorType.HAIRDRESSER) {
    await handleHairdresserMessage(ctx, msg);
    return;
  }

  await handleCustomerMessage(ctx, msg, session);
}

async function handleHairdresserMessage(
  ctx: BotContext,
  msg: TelegramMessage,
  hairdresserId?: string
): Promise<void> {
  const chatId = String(msg.chat.id);
  const text = msg.text ?? "";
  const session = await getOrCreateHairdresserSession(chatId, hairdresserId);

  if (text === "/start") {
    await handleHairdresserStart(ctx, msg, session);
    return;
  }

  if (text === "/menu") {
    await sendMessage(ctx, chatId, "منوی اصلی:", { reply_markup: makeHairdresserMainMenu() });
    return;
  }

  switch (session.state) {
    case HairdresserState.WAIT_CONTACT:
      await handleHairdresserContact(ctx, msg, session); break;
    case HairdresserState.WAIT_NAME:
      await handleHairdresserName(ctx, msg, session); break;
    case HairdresserState.WAIT_FIRST_CATEGORY:
      await handleHairdresserFirstCategory(ctx, msg, session); break;
    case HairdresserState.WAIT_FIRST_SERVICE_NAME:
      await handleHairdresserFirstServiceName(ctx, msg, session); break;
    case HairdresserState.WAIT_FIRST_SERVICE_DURATION:
      await handleHairdresserFirstServiceDuration(ctx, msg, session); break;
    case HairdresserState.WAIT_FIRST_SERVICE_PRICE_MIN:
      await handleHairdresserFirstServicePriceMin(ctx, msg, session); break;
    case HairdresserState.WAIT_FIRST_SERVICE_PRICE_MAX:
      await handleHairdresserFirstServicePriceMax(ctx, msg, session); break;
    case HairdresserState.WAIT_NEW_CATEGORY:
      await handleNewCategoryName(ctx, msg, session); break;
    case HairdresserState.WAIT_NEW_SERVICE_NAME:
      await handleNewServiceName(ctx, msg, session); break;
    case HairdresserState.WAIT_NEW_SERVICE_DURATION:
      await handleNewServiceDuration(ctx, msg, session); break;
    case HairdresserState.WAIT_NEW_SERVICE_PRICE_MIN:
      await handleNewServicePriceMin(ctx, msg, session); break;
    case HairdresserState.WAIT_NEW_SERVICE_PRICE_MAX:
      await handleNewServicePriceMax(ctx, msg, session); break;
    case HairdresserState.WAIT_APPROVAL_QUOTE_MIN:
      await handleApprovalQuoteMin(ctx, msg, session); break;
    case HairdresserState.WAIT_APPROVAL_QUOTE_MAX:
      await handleApprovalQuoteMax(ctx, msg, session); break;
    case HairdresserState.WAIT_APPROVAL_DEPOSIT:
      await handleApprovalDeposit(ctx, msg, session); break;
    case HairdresserState.WAIT_REJECTION_REASON:
      await handleRejectionReason(ctx, msg, session); break;
    case HairdresserState.WAIT_WORKING_START:
      await handleWorkingStart(ctx, msg, session); break;
    case HairdresserState.WAIT_WORKING_END:
      await handleWorkingEnd(ctx, msg, session); break;
    case HairdresserState.WAIT_BLOCK_START:
      await handleBlockStart(ctx, msg, session); break;
    case HairdresserState.WAIT_BLOCK_END:
      await handleBlockEnd(ctx, msg, session); break;
    case HairdresserState.WAIT_BLOCK_REASON:
      await handleBlockReason(ctx, msg, session); break;
    default:
      await sendMessage(ctx, chatId, "برای شروع /start رو بزن یا از منوی زیر استفاده کن:", {
        reply_markup: makeHairdresserMainMenu(),
      });
  }
}

async function handleCustomerMessage(
  ctx: BotContext,
  msg: TelegramMessage,
  session: Awaited<ReturnType<typeof getOrCreateCustomerSession>>
): Promise<void> {
  const chatId = String(msg.chat.id);

  switch (session.state) {
    case CustomerState.WAIT_DESCRIPTION:
    case CustomerState.WAIT_ATTACHMENT:
      await handleCustomerDescription(ctx, msg, session);
      break;
    default:
      await sendMessage(ctx, chatId, "برای رزرو نوبت از لینک آرایشگرت استفاده کن.");
  }
}

async function handleCallbackQuery(ctx: BotContext, query: TelegramCallbackQuery): Promise<void> {
  const data = query.data ?? "";
  const chatId = String(query.message?.chat.id);
  const userId = String(query.from.id);

  await answerCallbackQuery(ctx, query.id);

  const parts = data.split(":");
  const ns = parts[0];
  const action = parts[1];
  const resource = parts[2];
  // extra may itself contain colons (e.g. hd:settings:notif:set:TELEGRAM_ONLY)
  const extra = parts.slice(3).join(":");

  if (ns === "hd") {
    const userIdField = ctx.platform === "BALE" ? "baleUserId" : "telegramUserId";
    const hairdresser = await prisma.hairdresser.findFirst({ where: { [userIdField]: userId } });
    if (!hairdresser) {
      await sendMessage(ctx, chatId, "دسترسی نداری. /start رو بزن.");
      return;
    }
    const session = await getOrCreateHairdresserSession(chatId, hairdresser.id, ctx.platform);
    await handleHairdresserCallback(ctx, query, session, action, resource, extra);
    return;
  }

  if (ns === "cust") {
    const session = await getOrCreateCustomerSession(chatId, undefined, ctx.platform);
    await handleCustomerCallback(ctx, query, session, action, resource, extra, data);
    return;
  }
}

async function handleHairdresserCallback(
  ctx: BotContext,
  query: TelegramCallbackQuery,
  session: Awaited<ReturnType<typeof getOrCreateHairdresserSession>>,
  action: string,
  resource: string,
  extra: string
): Promise<void> {
  if (action === "menu") {
    switch (resource) {
      case "today": await handleTodayMenu(ctx, query, session); break;
      case "customers": await handleCustomersMenu(ctx, query, session); break;
      case "settings": await handleSettingsMenu(ctx, query, session); break;
    }
  } else if (action === "service") {
    if (resource === "add") await handleServiceAddCallback(ctx, query, session);
    else if (resource === "category") await handleServiceCategoryCallback(ctx, query, session, extra);
  } else if (action === "booking") {
    if (resource === "approve") await handleBookingApproveCallback(ctx, query, session, extra);
    else if (resource === "reject") await handleBookingRejectCallback(ctx, query, session, extra);
    else if (resource === "view") await handleBookingViewCallback(ctx, query, session, extra);
  } else if (action === "hours") {
    if (resource === "edit") await handleHoursEditCallback(ctx, query, session);
    else if (resource === "day") await handleHoursDayCallback(ctx, query, session, parseInt(extra, 10));
  } else if (action === "block") {
    if (resource === "add") await handleBlockAddCallback(ctx, query, session);
  } else if (action === "settings") {
    if (resource === "autoapprove") await handleAutoApproveToggle(ctx, query, session);
    else if (resource === "notif") {
      if (extra === "menu" || !extra) await handleNotifMenu(ctx, query, session);
      else await handleNotifSet(ctx, query, session, extra);
    }
  }
}

async function handleCustomerCallback(
  ctx: BotContext,
  query: TelegramCallbackQuery,
  session: Awaited<ReturnType<typeof getOrCreateCustomerSession>>,
  action: string,
  resource: string,
  extra: string,
  rawData: string
): Promise<void> {
  switch (action) {
    case "start":
      // cust:start:<slug> — from deep link callback (not typical but handled)
      await handleCustomerDeepLink(ctx, query.message!, session, resource);
      break;
    case "category":
      await handleCustomerCategoryCallback(ctx, query, session, resource); break;
    case "service":
      await handleCustomerServiceCallback(ctx, query, session, resource); break;
    case "date":
      await handleCustomerDateCallback(ctx, query, session, resource); break;
    case "slot": {
      // cust:slot:<isoStartAt> — isoStartAt contains colons, grab everything after "cust:slot:"
      const isoStartAt = rawData.replace(/^cust:slot:/, "");
      await handleCustomerSlotCallback(ctx, query, session, isoStartAt);
      break;
    }
    case "description":
      if (resource === "skip") await handleCustomerDescriptionSkip(ctx, query, session);
      break;
    case "attachment":
      if (resource === "skip") await handleCustomerAttachmentSkip(ctx, query, session);
      break;
    case "booking":
      if (resource === "submit") await handleCustomerBookingSubmit(ctx, query, session);
      break;
    case "payment":
      if (resource === "pay") await handleCustomerPayCallback(ctx, query, session, extra);
      break;
    case "cancel":
      if (resource === "request") await handleCustomerCancelRequest(ctx, query, session, extra);
      else if (resource === "confirm") await handleCustomerCancelConfirm(ctx, query, session, extra);
      else if (resource === "abort") await handleCustomerCancelAbort(ctx, query, session);
      break;
  }
}
