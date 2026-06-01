import { prisma } from "@/lib/prisma";
import { sendMessage, makeInlineKeyboard } from "@/bot/telegram/client";
import { updateSession, mergeSessionPayload } from "@/bot/session";
import { getOrCreateHairdresserWallet, getOrCreateCustomerWallet, requestWithdrawal, getHairdresserLockedBalance } from "@/domain/wallet";
import { HairdresserState, CustomerState } from "@/bot/states";
import { WalletTransactionType } from "@prisma/client";
import type { BotContext } from "@/bot/telegram/client";
import type { Session } from "@/bot/session";
import type { TelegramMessage, TelegramCallbackQuery } from "@/bot/telegram/types";

const TX_LABELS: Record<WalletTransactionType, string> = {
  DEPOSIT_CREDIT: "دریافت بیعانه",
  REFUND_DEBIT: "برگشت به مشتری",
  PENALTY_CREDIT: "جریمه کنسلی",
  REFUND_CREDIT: "برگشت پول",
  WITHDRAWAL_DEBIT: "برداشت",
};

// ─── Show wallet balance ───────────────────────────────────────────────────────

export async function showHairdresserWallet(ctx: BotContext, query: TelegramCallbackQuery, session: Session): Promise<void> {
  const chatId = String(query.message!.chat.id);
  const wallet = await getOrCreateHairdresserWallet(session.hairdresserId!);
  const [txs, pending, locked] = await Promise.all([
    prisma.walletTransaction.findMany({ where: { walletId: wallet.id }, orderBy: { createdAt: "desc" }, take: 5 }),
    prisma.withdrawalRequest.count({ where: { walletId: wallet.id, status: "PENDING" } }),
    getHairdresserLockedBalance(session.hairdresserId!),
  ]);
  const available = wallet.balanceToman - locked;

  const lines = [
    "💰 <b>کیف پول شما</b>",
    "",
    `موجودی کل: <b>${wallet.balanceToman.toLocaleString()} تومان</b>`,
    locked > 0 ? `🔒 قفل‌شده (رزروهای آینده): ${locked.toLocaleString()} تومان` : "",
    locked > 0 ? `✅ قابل برداشت: <b>${available.toLocaleString()} تومان</b>` : "",
    pending > 0 ? `⏳ درخواست برداشت در انتظار: ${pending}` : "",
    "",
    "آخرین تراکنش‌ها:",
    ...txs.map((t) => `• ${TX_LABELS[t.type]} — ${t.amountToman > 0 ? "+" : ""}${t.amountToman.toLocaleString()} تومان`),
  ].filter(Boolean);

  await sendMessage(ctx, chatId, lines.join("\n"), {
    reply_markup: makeInlineKeyboard([
      [{ text: "💸 درخواست برداشت", data: "hd:wallet:withdraw" }],
    ]),
  });
}

export async function showCustomerWallet(ctx: BotContext, query: TelegramCallbackQuery | TelegramMessage, session: Session): Promise<void> {
  const chatId = "message" in query ? String((query as TelegramCallbackQuery).message!.chat.id) : String((query as TelegramMessage).chat.id);
  const wallet = await getOrCreateCustomerWallet(session.customerId!);
  const txs = await prisma.walletTransaction.findMany({
    where: { walletId: wallet.id },
    orderBy: { createdAt: "desc" },
    take: 5,
  });

  const pending = await prisma.withdrawalRequest.count({
    where: { walletId: wallet.id, status: "PENDING" },
  });

  const lines = [
    "💰 <b>کیف پول شما</b>",
    "",
    `موجودی: <b>${wallet.balanceToman.toLocaleString()} تومان</b>`,
    pending > 0 ? `⏳ درخواست برداشت در انتظار: ${pending}` : "",
    "",
    "آخرین تراکنش‌ها:",
    ...txs.map((t) => `• ${TX_LABELS[t.type]} — ${t.amountToman > 0 ? "+" : ""}${t.amountToman.toLocaleString()} تومان`),
  ].filter(Boolean);

  await sendMessage(ctx, chatId, lines.join("\n"), {
    reply_markup: makeInlineKeyboard([
      [{ text: "💸 درخواست برداشت", data: "cust:wallet:withdraw" }],
    ]),
  });
}

// ─── Withdrawal flow (shared steps, actor-agnostic) ───────────────────────────

export async function startWithdrawalFlow(
  ctx: BotContext,
  chatId: string,
  isHairdresser: boolean
): Promise<void> {
  const idleState = isHairdresser ? HairdresserState.WAIT_WITHDRAWAL_AMOUNT : CustomerState.WAIT_WITHDRAWAL_AMOUNT;
  await updateSession(chatId, idleState);
  await sendMessage(ctx, chatId, "مبلغ درخواست برداشت رو بنویس (تومان):", {
    reply_markup: makeInlineKeyboard([[{ text: "❌ لغو", data: isHairdresser ? "hd:cancel" : "cust:wallet:cancel" }]]),
  });
}

export async function handleWithdrawalAmount(
  ctx: BotContext,
  msg: TelegramMessage,
  session: Session,
  isHairdresser: boolean
): Promise<void> {
  const chatId = String(msg.chat.id);
  const amount = parseInt(msg.text?.trim().replace(/,/g, "") ?? "", 10);
  const cancelData = isHairdresser ? "hd:cancel" : "cust:wallet:cancel";

  if (isNaN(amount) || amount <= 0) {
    await sendMessage(ctx, chatId, "مبلغ باید عدد مثبت باشه:", {
      reply_markup: makeInlineKeyboard([[{ text: "❌ لغو", data: cancelData }]]),
    });
    return;
  }

  const walletId = isHairdresser
    ? (await getOrCreateHairdresserWallet(session.hairdresserId!)).id
    : (await getOrCreateCustomerWallet(session.customerId!)).id;

  const wallet = await prisma.wallet.findUnique({ where: { id: walletId } });
  const locked = isHairdresser ? await getHairdresserLockedBalance(session.hairdresserId!) : 0;
  const available = (wallet?.balanceToman ?? 0) - locked;
  if (!wallet || available < amount) {
    const msg = isHairdresser && locked > 0
      ? `موجودی قابل برداشت کافی نیست.\nموجودی کل: ${wallet?.balanceToman.toLocaleString() ?? 0} تومان\nقفل‌شده: ${locked.toLocaleString()} تومان\nقابل برداشت: ${available.toLocaleString()} تومان`
      : `موجودی کافی نیست. موجودی فعلی: ${wallet?.balanceToman.toLocaleString() ?? 0} تومان`;
    await sendMessage(ctx, chatId, msg, {
      reply_markup: makeInlineKeyboard([[{ text: "❌ لغو", data: cancelData }]]),
    });
    return;
  }

  await mergeSessionPayload(chatId, { withdrawalAmount: amount });
  const nextState = isHairdresser ? HairdresserState.WAIT_WITHDRAWAL_IBAN : CustomerState.WAIT_WITHDRAWAL_IBAN;
  await updateSession(chatId, nextState);
  await sendMessage(ctx, chatId, "شماره شبا رو بنویس (مثلاً IR123456...):", {
    reply_markup: makeInlineKeyboard([[{ text: "❌ لغو", data: cancelData }]]),
  });
}

export async function handleWithdrawalIban(
  ctx: BotContext,
  msg: TelegramMessage,
  session: Session,
  isHairdresser: boolean
): Promise<void> {
  const chatId = String(msg.chat.id);
  const iban = msg.text?.trim().replace(/\s/g, "").toUpperCase() ?? "";
  const cancelData = isHairdresser ? "hd:cancel" : "cust:wallet:cancel";

  if (!iban.match(/^IR\d{24}$/)) {
    await sendMessage(ctx, chatId, "فرمت شبا نادرست. باید با IR شروع بشه و ۲۶ کاراکتر باشه:", {
      reply_markup: makeInlineKeyboard([[{ text: "❌ لغو", data: cancelData }]]),
    });
    return;
  }

  await mergeSessionPayload(chatId, { withdrawalIban: iban });
  const nextState = isHairdresser ? HairdresserState.WAIT_WITHDRAWAL_NAME : CustomerState.WAIT_WITHDRAWAL_NAME;
  await updateSession(chatId, nextState);
  await sendMessage(ctx, chatId, "نام صاحب حساب رو بنویس:", {
    reply_markup: makeInlineKeyboard([[{ text: "❌ لغو", data: cancelData }]]),
  });
}

export async function handleWithdrawalName(
  ctx: BotContext,
  msg: TelegramMessage,
  session: Session,
  isHairdresser: boolean
): Promise<void> {
  const chatId = String(msg.chat.id);
  const name = msg.text?.trim() ?? "";
  const cancelData = isHairdresser ? "hd:cancel" : "cust:wallet:cancel";

  if (name.length < 3) {
    await sendMessage(ctx, chatId, "نام باید حداقل ۳ کاراکتر باشه:", {
      reply_markup: makeInlineKeyboard([[{ text: "❌ لغو", data: cancelData }]]),
    });
    return;
  }

  const payload = session.payload as { withdrawalAmount?: number; withdrawalIban?: string };

  try {
    const walletId = isHairdresser
      ? (await getOrCreateHairdresserWallet(session.hairdresserId!)).id
      : (await getOrCreateCustomerWallet(session.customerId!)).id;

    await requestWithdrawal(walletId, payload.withdrawalAmount!, payload.withdrawalIban!, name);

    const idleState = isHairdresser ? HairdresserState.IDLE : CustomerState.IDLE;
    await updateSession(chatId, idleState, {});
    await sendMessage(
      ctx,
      chatId,
      `✅ درخواست برداشت <b>${payload.withdrawalAmount!.toLocaleString()} تومان</b> ثبت شد.\n\nبعد از بررسی ادمین، مبلغ به شبا <code>${payload.withdrawalIban}</code> واریز میشه.`
    );
  } catch (err) {
    await sendMessage(ctx, chatId, `❌ ${err instanceof Error ? err.message : "خطا در ثبت درخواست"}`, {
      reply_markup: makeInlineKeyboard([[{ text: "❌ لغو", data: cancelData }]]),
    });
  }
}
