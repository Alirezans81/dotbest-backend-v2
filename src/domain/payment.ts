import { prisma } from "@/lib/prisma";
import { addMinutes } from "@/lib/time";
import { getConflictingPendingBookings } from "@/domain/availability";
import { notifyCustomer } from "@/bot/notify";
import { creditHairdresserDeposit } from "@/domain/wallet";
import {
  BookingStatus,
  PaymentIntentStatus,
  PaymentTransactionStatus,
  PaymentTransactionType,
} from "@prisma/client";
import type { Booking } from "@prisma/client";

const TIMEOUT_MINUTES = parseInt(process.env.PAYMENT_REQUEST_TIMEOUT_MINUTES ?? "30", 10);
const FEE_PERCENT_FALLBACK = parseFloat(process.env.PAYMENT_GATEWAY_FEE_PERCENT ?? "0");

async function fetchZarinpalFee(depositToman: number): Promise<number> {
  try {
    const res = await fetch("https://payment.zarinpal.com/pg/v4/payment/feeCalculation.json", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({
        merchant_id: process.env.PAYMENT_PROVIDER_MERCHANT_ID,
        amount: depositToman * 10,
        currency: "IRR",
      }),
    });
    const data = await res.json() as { data?: { code?: number; fee?: number }; errors?: unknown };
    if (data.data?.code === 100 && typeof data.data.fee === "number") {
      return Math.ceil(data.data.fee / 10);
    }
  } catch {
    // fall through to fallback
  }
  return FEE_PERCENT_FALLBACK > 0 ? Math.ceil(depositToman * FEE_PERCENT_FALLBACK / 100) : 0;
}

export interface InitiateResult {
  paymentIntentId: string;
  redirectUrl: string;
  expiresAt: Date;
  depositAmountToman: number;
  gatewayFeeToman: number;
  totalAmountToman: number;
}

export async function initiatePayment(bookingId: string): Promise<InitiateResult> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { customer: true },
  });

  if (!booking) throw new Error("Booking not found");
  if (booking.status !== BookingStatus.APPROVED_AWAITING_DEPOSIT) {
    throw new Error("Booking is not in APPROVED_AWAITING_DEPOSIT status");
  }
  if (!booking.depositAmountToman) throw new Error("Deposit amount not set");

  // Return existing active intent if present (idempotency)
  const existing = await prisma.paymentIntent.findFirst({
    where: {
      bookingId,
      status: { in: [PaymentIntentStatus.INITIATED, PaymentIntentStatus.REDIRECTED] },
      expiresAt: { gt: new Date() },
    },
  });

  if (existing?.redirectUrl) {
    const depositAmountToman = booking.depositAmountToman!;
    const gatewayFeeToman = existing.amountToman - depositAmountToman;
    return {
      paymentIntentId: existing.id,
      redirectUrl: existing.redirectUrl,
      expiresAt: existing.expiresAt,
      depositAmountToman,
      gatewayFeeToman,
      totalAmountToman: existing.amountToman,
    };
  }

  const callbackUrl = `${process.env.APP_BASE_URL}/api/payments/callback`;
  const expiresAt = addMinutes(new Date(), TIMEOUT_MINUTES);
  const gatewayFeeToman = await fetchZarinpalFee(booking.depositAmountToman!);
  const totalToman = booking.depositAmountToman! + gatewayFeeToman;

  const intent = await prisma.paymentIntent.create({
    data: {
      bookingId,
      provider: "zarinpal",
      amountToman: totalToman,
      callbackUrl,
      expiresAt,
      initiatedAt: new Date(),
    },
  });

  await prisma.paymentTransaction.create({
    data: {
      paymentIntentId: intent.id,
      transactionType: PaymentTransactionType.INITIATE_REQUEST,
      status: PaymentTransactionStatus.SUCCESS,
      amountToman: booking.depositAmountToman,
      providerRawPayload: { bookingId, amount: booking.depositAmountToman },
    },
  });

  const result = await callZarinpalRequest(
    totalToman,
    `${callbackUrl}?intentId=${intent.id}`,
    `بیعانه رزرو ${booking.id}`
  );

  await prisma.paymentTransaction.create({
    data: {
      paymentIntentId: intent.id,
      transactionType: PaymentTransactionType.INITIATE_RESPONSE,
      status: result.success ? PaymentTransactionStatus.SUCCESS : PaymentTransactionStatus.FAILED,
      amountToman: booking.depositAmountToman,
      providerRawPayload: result.raw as import("@prisma/client").Prisma.InputJsonValue,
    },
  });

  if (!result.success || !result.authority) {
    throw new Error("Payment provider initiate failed: " + JSON.stringify(result.raw));
  }

  const redirectUrl = `${process.env.PAYMENT_PROVIDER_BASE_URL}/pg/StartPay/${result.authority}`;

  // Atomically lock the slot and reject competing bookings
  const conflictIds = await getConflictingPendingBookings(
    booking.hairdresserId,
    booking.requestedStartAt,
    booking.requestedEndAt,
    bookingId
  );

  await prisma.$transaction([
    prisma.paymentIntent.update({
      where: { id: intent.id },
      data: { providerAuthority: result.authority, redirectUrl, status: PaymentIntentStatus.REDIRECTED },
    }),
    prisma.booking.update({
      where: { id: bookingId },
      data: { status: BookingStatus.PAYMENT_PENDING },
    }),
    ...(conflictIds.length > 0
      ? [
          prisma.booking.updateMany({
            where: { id: { in: conflictIds } },
            data: {
              status: BookingStatus.REJECTED,
              rejectionReason: "زمان این نوبت توسط مشتری دیگری رزرو شد",
            },
          }),
        ]
      : []),
  ]);

  // Notify auto-rejected customers outside the transaction
  if (conflictIds.length > 0) {
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

  return {
    paymentIntentId: intent.id,
    redirectUrl,
    expiresAt,
    depositAmountToman: booking.depositAmountToman,
    gatewayFeeToman,
    totalAmountToman: totalToman,
  };
}

export async function verifyPayment(intentId: string): Promise<{ success: boolean; alreadyVerified?: boolean }> {
  const intent = await prisma.paymentIntent.findUnique({
    where: { id: intentId },
    include: { booking: true },
  });

  if (!intent) throw new Error("PaymentIntent not found");
  if (intent.status === PaymentIntentStatus.VERIFIED) return { success: true, alreadyVerified: true };
  if (!intent.providerAuthority) throw new Error("No authority on intent");

  const alreadyVerified = await prisma.paymentTransaction.findFirst({
    where: {
      paymentIntentId: intentId,
      transactionType: PaymentTransactionType.VERIFY_RESPONSE,
      status: PaymentTransactionStatus.SUCCESS,
    },
  });

  if (alreadyVerified) {
    await prisma.paymentTransaction.create({
      data: {
        paymentIntentId: intentId,
        transactionType: PaymentTransactionType.VERIFY_RESPONSE,
        status: PaymentTransactionStatus.IGNORED_DUPLICATE,
        amountToman: intent.amountToman,
        providerRawPayload: { reason: "already verified" },
      },
    });
    return { success: true, alreadyVerified: true };
  }

  await prisma.paymentTransaction.create({
    data: {
      paymentIntentId: intentId,
      transactionType: PaymentTransactionType.VERIFY_REQUEST,
      status: PaymentTransactionStatus.SUCCESS,
      amountToman: intent.amountToman,
      providerRawPayload: { authority: intent.providerAuthority },
    },
  });

  const result = await callZarinpalVerify(intent.providerAuthority, intent.amountToman);

  await prisma.paymentTransaction.create({
    data: {
      paymentIntentId: intentId,
      transactionType: PaymentTransactionType.VERIFY_RESPONSE,
      status: result.success ? PaymentTransactionStatus.SUCCESS : PaymentTransactionStatus.FAILED,
      amountToman: intent.amountToman,
      providerReferenceId: result.refId ?? undefined,
      providerRawPayload: result.raw as import("@prisma/client").Prisma.InputJsonValue,
    },
  });

  if (!result.success) return { success: false };

  await prisma.paymentIntent.update({
    where: { id: intentId },
    data: { status: PaymentIntentStatus.VERIFIED, verifiedAt: new Date() },
  });

  const confirmedBooking = await prisma.booking.update({
    where: { id: intent.bookingId },
    data: { status: BookingStatus.CONFIRMED, confirmedAt: new Date() },
  });

  await rejectConflictingOnConfirm(confirmedBooking);

  // واریز بیعانه به کیف پول آرایشگر
  await creditHairdresserDeposit(
    confirmedBooking.hairdresserId,
    intent.bookingId,
    confirmedBooking.depositAmountToman!
  ).catch((err) => console.error("[wallet] creditHairdresserDeposit failed:", err));

  return { success: true };
}

export async function expireStaleIntents(): Promise<void> {
  const stale = await prisma.paymentIntent.findMany({
    where: {
      status: { in: [PaymentIntentStatus.INITIATED, PaymentIntentStatus.REDIRECTED] },
      expiresAt: { lt: new Date() },
    },
    include: { booking: true },
  });

  for (const intent of stale) {
    await prisma.paymentIntent.update({
      where: { id: intent.id },
      data: { status: PaymentIntentStatus.EXPIRED },
    });

    if (intent.booking.status === BookingStatus.PAYMENT_PENDING) {
      await prisma.booking.update({
        where: { id: intent.bookingId },
        data: { status: BookingStatus.APPROVED_AWAITING_DEPOSIT },
      });
    }
  }
}

async function callZarinpalRequest(
  amountToman: number,
  callbackUrl: string,
  description: string
): Promise<{ success: boolean; authority?: string; raw: unknown }> {
  try {
    const res = await fetch(`${process.env.PAYMENT_PROVIDER_BASE_URL}/pg/v4/payment/request.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        merchant_id: process.env.PAYMENT_PROVIDER_MERCHANT_ID,
        amount: amountToman * 10,
        callback_url: callbackUrl,
        description,
      }),
    });
    const data = await res.json() as { data?: { authority?: string; code?: number }; errors?: unknown };
    if (data.data?.code === 100 && data.data.authority) {
      return { success: true, authority: data.data.authority, raw: data };
    }
    return { success: false, raw: data };
  } catch (err) {
    return { success: false, raw: { error: String(err) } };
  }
}

async function callZarinpalVerify(
  authority: string,
  amountToman: number
): Promise<{ success: boolean; refId?: string; raw: unknown }> {
  try {
    const res = await fetch(`${process.env.PAYMENT_PROVIDER_BASE_URL}/pg/v4/payment/verify.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        merchant_id: process.env.PAYMENT_PROVIDER_MERCHANT_ID,
        amount: amountToman * 10,
        authority,
      }),
    });
    const data = await res.json() as { data?: { ref_id?: string; code?: number }; errors?: unknown };
    if ((data.data?.code === 100 || data.data?.code === 101) && data.data.ref_id) {
      return { success: true, refId: String(data.data.ref_id), raw: data };
    }
    return { success: false, raw: data };
  } catch (err) {
    return { success: false, raw: { error: String(err) } };
  }
}

/**
 * Safety net: after a booking is CONFIRMED, reject any remaining
 * PENDING_REVIEW / APPROVED_AWAITING_DEPOSIT bookings for the same slot
 * and notify those customers. Runs outside a transaction intentionally —
 * the primary rejection already happened at PAYMENT_PENDING stage.
 */
async function rejectConflictingOnConfirm(confirmed: Booking): Promise<void> {
  const conflictIds = await getConflictingPendingBookings(
    confirmed.hairdresserId,
    confirmed.requestedStartAt,
    confirmed.requestedEndAt,
    confirmed.id
  );
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
