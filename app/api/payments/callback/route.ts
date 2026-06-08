import { NextRequest, NextResponse } from "next/server";
import { verifyPayment } from "@/domain/payment";
import { prisma } from "@/lib/prisma";
import { notifyCustomer, notifyHairdresser } from "@/bot/notify";
import { formatTehranDateTime } from "@/lib/time";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const authority = searchParams.get("Authority");
  const status = searchParams.get("Status");
  const intentId = searchParams.get("intentId");

  if (!authority || !intentId) {
    return htmlResponse("خطا در پردازش پرداخت. پارامترهای لازم ناقص هستند.", false);
  }

  if (status !== "OK") {
    await notifyPaymentFailed(intentId);
    return htmlResponse("پرداخت ناموفق بود یا لغو شد.", false);
  }

  try {
    const result = await verifyPayment(intentId);

    if (result.success) {
      if (!result.alreadyVerified) {
        await notifyPaymentSuccess(intentId);
      }
      return htmlResponse("پرداخت موفق! رزرو شما ثبت شد.", true);
    } else {
      await notifyPaymentFailed(intentId);
      return htmlResponse("تأیید پرداخت ناموفق بود. دوباره تلاش کنید.", false);
    }
  } catch (err) {
    console.error("[payments/callback]", err);
    return htmlResponse("خطا در سیستم. با پشتیبانی تماس بگیرید.", false);
  }
}

async function notifyPaymentSuccess(intentId: string): Promise<void> {
  const intent = await prisma.paymentIntent.findUnique({
    where: { id: intentId },
    include: { booking: { include: { customer: true, hairdresser: true, service: true } } },
  });
  if (!intent) return;

  const { booking } = intent;
  const { customer, hairdresser, service } = booking;

  await Promise.allSettled([
    notifyCustomer(
      customer,
      `✅ پرداخت موفق!\n\nنوبتت ثبت شد 🎉\n\n✂️ سرویس: ${service.title}\n🕐 زمان: ${formatTehranDateTime(booking.requestedStartAt)}`
    ),
    notifyHairdresser(
      hairdresser,
      `✅ پرداخت انجام شد!\n\nنوبت ثبت شد:\n👤 مشتری: ${customer.fullName}\n✂️ سرویس: ${service.title}\n🕐 زمان: ${formatTehranDateTime(booking.requestedStartAt)}`
    ),
  ]);
}

async function notifyPaymentFailed(intentId: string): Promise<void> {
  const intent = await prisma.paymentIntent.findUnique({
    where: { id: intentId },
    include: { booking: { include: { customer: true, service: true } } },
  });
  if (!intent) return;

  await notifyCustomer(
    intent.booking.customer,
    `❌ پرداخت ناموفق بود.\n\nمی‌تونی دوباره امتحان کنی:`,
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: "🔄 تلاش مجدد", callback_data: `cust:payment:pay:${intent.bookingId}` }],
        ],
      },
    }
  );
}

function htmlResponse(message: string, success: boolean): NextResponse {
  const color = success ? "#22c55e" : "#ef4444";
  const icon = success ? "✅" : "❌";
  const html = `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${success ? "پرداخت موفق" : "خطا در پرداخت"}</title>
  <style>
    body { font-family: Tahoma, sans-serif; display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0; background:#f8f9fa; }
    .box { text-align:center; padding:40px; background:#fff; border-radius:12px; box-shadow:0 2px 16px rgba(0,0,0,.08); max-width:400px; }
    h1 { color:${color}; font-size:2rem; }
    p { color:#555; line-height:1.6; }
  </style>
</head>
<body>
  <div class="box">
    <h1>${icon}</h1>
    <p>${message}</p>
    <p style="margin-top:20px; font-size:.9rem; color:#999;">می‌تونی این صفحه رو ببندی و به بله/تلگرام برگردی.</p>
  </div>
</body>
</html>`;
  return new NextResponse(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
