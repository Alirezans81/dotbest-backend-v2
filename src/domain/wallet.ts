import { prisma } from "@/lib/prisma";
import { BookingStatus, WalletOwnerType, WalletTransactionType } from "@prisma/client";

// ─── Wallet creation / lookup ─────────────────────────────────────────────────

export async function getOrCreateHairdresserWallet(hairdresserId: string) {
  return prisma.wallet.upsert({
    where: { hairdresserId },
    update: {},
    create: { ownerType: WalletOwnerType.HAIRDRESSER, hairdresserId },
  });
}

export async function getOrCreateCustomerWallet(customerId: string) {
  return prisma.wallet.upsert({
    where: { customerId },
    update: {},
    create: { ownerType: WalletOwnerType.CUSTOMER, customerId },
  });
}

// ─── Transactions ─────────────────────────────────────────────────────────────

/** آرایشگر بیعانه دریافت می‌کند (بعد از پرداخت موفق مشتری) */
export async function creditHairdresserDeposit(
  hairdresserId: string,
  bookingId: string,
  depositToman: number
): Promise<void> {
  const wallet = await getOrCreateHairdresserWallet(hairdresserId);
  await prisma.$transaction([
    prisma.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type: WalletTransactionType.DEPOSIT_CREDIT,
        amountToman: depositToman,
        bookingId,
        description: `دریافت بیعانه رزرو #${bookingId.slice(-6)}`,
      },
    }),
    prisma.wallet.update({
      where: { id: wallet.id },
      data: { balanceToman: { increment: depositToman } },
    }),
  ]);
}

/**
 * کنسلی بدون جریمه:
 * - اگر بیعانه پرداخت شده بود → برگشت به مشتری + کسر از آرایشگر
 */
export async function processNopenaltyCancellation(
  hairdresserId: string,
  customerId: string,
  bookingId: string,
  depositToman: number
): Promise<void> {
  if (depositToman <= 0) return;

  const [hdWallet, custWallet] = await Promise.all([
    getOrCreateHairdresserWallet(hairdresserId),
    getOrCreateCustomerWallet(customerId),
  ]);

  await prisma.$transaction([
    // کسر از آرایشگر
    prisma.walletTransaction.create({
      data: {
        walletId: hdWallet.id,
        type: WalletTransactionType.REFUND_DEBIT,
        amountToman: -depositToman,
        bookingId,
        description: `برگشت بیعانه رزرو #${bookingId.slice(-6)} به مشتری`,
      },
    }),
    prisma.wallet.update({
      where: { id: hdWallet.id },
      data: { balanceToman: { decrement: depositToman } },
    }),
    // واریز به مشتری
    prisma.walletTransaction.create({
      data: {
        walletId: custWallet.id,
        type: WalletTransactionType.REFUND_CREDIT,
        amountToman: depositToman,
        bookingId,
        description: `برگشت کامل بیعانه رزرو #${bookingId.slice(-6)}`,
      },
    }),
    prisma.wallet.update({
      where: { id: custWallet.id },
      data: { balanceToman: { increment: depositToman } },
    }),
  ]);
}

/**
 * کنسلی با جریمه (۵۰٪):
 * - آرایشگر ۵۰٪ نگه می‌دارد (PENALTY_CREDIT)
 * - مشتری ۵۰٪ برمی‌گردد (REFUND_CREDIT)
 */
export async function processPenaltyCancellation(
  hairdresserId: string,
  customerId: string,
  bookingId: string,
  depositToman: number
): Promise<{ refundToman: number; penaltyToman: number }> {
  const refundToman = Math.floor(depositToman / 2);
  const penaltyToman = depositToman - refundToman;

  if (depositToman <= 0) return { refundToman: 0, penaltyToman: 0 };

  const [hdWallet, custWallet] = await Promise.all([
    getOrCreateHairdresserWallet(hairdresserId),
    getOrCreateCustomerWallet(customerId),
  ]);

  await prisma.$transaction([
    // آرایشگر جریمه نگه می‌دارد — فقط ثبت می‌شود، موجودی تغییر نمی‌کند (چون قبلاً credit شده)
    prisma.walletTransaction.create({
      data: {
        walletId: hdWallet.id,
        type: WalletTransactionType.PENALTY_CREDIT,
        amountToman: penaltyToman,
        bookingId,
        description: `جریمه کنسلی رزرو #${bookingId.slice(-6)} (${penaltyToman.toLocaleString()} تومان)`,
      },
    }),
    // کسر مبلغ برگشتی از آرایشگر
    prisma.walletTransaction.create({
      data: {
        walletId: hdWallet.id,
        type: WalletTransactionType.REFUND_DEBIT,
        amountToman: -refundToman,
        bookingId,
        description: `برگشت ۵۰٪ بیعانه رزرو #${bookingId.slice(-6)} به مشتری`,
      },
    }),
    prisma.wallet.update({
      where: { id: hdWallet.id },
      data: { balanceToman: { decrement: refundToman } },
    }),
    // واریز ۵۰٪ به مشتری
    prisma.walletTransaction.create({
      data: {
        walletId: custWallet.id,
        type: WalletTransactionType.REFUND_CREDIT,
        amountToman: refundToman,
        bookingId,
        description: `برگشت ۵۰٪ بیعانه رزرو #${bookingId.slice(-6)} (جریمه کنسلی)`,
      },
    }),
    prisma.wallet.update({
      where: { id: custWallet.id },
      data: { balanceToman: { increment: refundToman } },
    }),
  ]);

  return { refundToman, penaltyToman };
}

// ─── Locked balance ───────────────────────────────────────────────────────────

/**
 * بیعانه‌های پرداخت‌شده برای رزروهای CONFIRMED که هنوز زمانشان نرسیده.
 * تا بعد از زمان رزرو، این مبالغ قابل برداشت نیستند.
 */
export async function getHairdresserLockedBalance(hairdresserId: string): Promise<number> {
  const result = await prisma.booking.aggregate({
    where: {
      hairdresserId,
      status: BookingStatus.CONFIRMED,
      requestedStartAt: { gt: new Date() },
      depositAmountToman: { gt: 0 },
    },
    _sum: { depositAmountToman: true },
  });
  return result._sum.depositAmountToman ?? 0;
}

// ─── Withdrawal ───────────────────────────────────────────────────────────────

export async function requestWithdrawal(
  walletId: string,
  amountToman: number,
  iban: string,
  accountHolder: string
) {
  const wallet = await prisma.wallet.findUnique({ where: { id: walletId } });
  if (!wallet) throw new Error("Wallet not found");
  if (amountToman <= 0) throw new Error("مبلغ باید بیشتر از صفر باشه");

  if (wallet.ownerType === WalletOwnerType.HAIRDRESSER && wallet.hairdresserId) {
    const locked = await getHairdresserLockedBalance(wallet.hairdresserId);
    const available = wallet.balanceToman - locked;
    if (available < amountToman) {
      throw new Error(
        `موجودی آزاد کافی نیست.\nموجودی کل: ${wallet.balanceToman.toLocaleString()} تومان\nقفل‌شده (رزروهای آینده): ${locked.toLocaleString()} تومان\nقابل برداشت: ${available.toLocaleString()} تومان`
      );
    }
  } else {
    if (wallet.balanceToman < amountToman) throw new Error("موجودی کافی نیست");
  }

  return prisma.withdrawalRequest.create({
    data: { walletId, amountToman, iban, accountHolder },
  });
}

export async function approveWithdrawal(requestId: string, adminNote?: string) {
  const req = await prisma.withdrawalRequest.findUnique({
    where: { id: requestId },
    include: { wallet: true },
  });
  if (!req) throw new Error("Request not found");
  if (req.status !== "PENDING") throw new Error("این درخواست قبلاً پردازش شده");
  if (req.wallet.balanceToman < req.amountToman) throw new Error("موجودی کافی نیست");

  await prisma.$transaction([
    prisma.withdrawalRequest.update({
      where: { id: requestId },
      data: { status: "APPROVED", adminNote: adminNote ?? null, resolvedAt: new Date() },
    }),
    prisma.walletTransaction.create({
      data: {
        walletId: req.walletId,
        type: WalletTransactionType.WITHDRAWAL_DEBIT,
        amountToman: -req.amountToman,
        description: `برداشت تایید شده — شبا: ${req.iban}`,
      },
    }),
    prisma.wallet.update({
      where: { id: req.walletId },
      data: { balanceToman: { decrement: req.amountToman } },
    }),
  ]);
}

export async function rejectWithdrawal(requestId: string, adminNote?: string) {
  await prisma.withdrawalRequest.update({
    where: { id: requestId },
    data: { status: "REJECTED", adminNote: adminNote ?? null, resolvedAt: new Date() },
  });
}
