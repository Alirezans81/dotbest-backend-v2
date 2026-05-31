import { prisma } from "@/lib/prisma";
import { notifyHairdresser, notifyCustomer } from "@/bot/notify";
import { formatTehranDateTime } from "@/lib/time";
import { BookingStatus, NotificationStatus, RecipientType } from "@prisma/client";
import { generateIdempotencyKey } from "@/lib/slug";

const REMINDER_WINDOWS = [
  { label: "24h", offsetHours: 24 },
  { label: "2h", offsetHours: 2 },
];

export async function runReminderJob(): Promise<{ sent: number; skipped: number; failed: number }> {
  const now = new Date();
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const window of REMINDER_WINDOWS) {
    const windowStart = new Date(now.getTime() + (window.offsetHours - 0.5) * 60 * 60 * 1000);
    const windowEnd = new Date(now.getTime() + (window.offsetHours + 0.5) * 60 * 60 * 1000);

    const bookings = await prisma.booking.findMany({
      where: {
        status: BookingStatus.CONFIRMED,
        requestedStartAt: { gte: windowStart, lt: windowEnd },
      },
      include: { customer: true, hairdresser: true, service: true },
    });

    for (const booking of bookings) {
      for (const recipientType of [RecipientType.CUSTOMER, RecipientType.HAIRDRESSER]) {
        const key = generateIdempotencyKey("reminder", booking.id, window.label, recipientType);

        const existing = await prisma.notificationLog.findUnique({ where: { idempotencyKey: key } });
        if (existing) { skipped++; continue; }

        const recipientChatId =
          recipientType === RecipientType.CUSTOMER
            ? (booking.customer.telegramChatId ?? booking.customer.baleChatId ?? "")
            : (booking.hairdresser.telegramChatId ?? booking.hairdresser.baleChatId ?? "");

        const log = await prisma.notificationLog.create({
          data: {
            bookingId: booking.id,
            recipientType,
            recipientChatId,
            channel: "TELEGRAM",
            templateKey: `reminder_${window.label}`,
            idempotencyKey: key,
            status: NotificationStatus.PENDING,
            scheduledFor: now,
          },
        });

        const text = buildReminderText(booking, window.offsetHours, recipientType);

        try {
          if (recipientType === RecipientType.CUSTOMER) {
            await notifyCustomer(booking.customer, text, {
              reply_markup: {
                inline_keyboard: [[
                  { text: "❌ لغو رزرو", callback_data: `cust:cancel:request:${booking.id}` },
                ]],
              },
            });
          } else {
            await notifyHairdresser(booking.hairdresser, text);
          }

          await prisma.notificationLog.update({
            where: { id: log.id },
            data: { status: NotificationStatus.SENT, sentAt: new Date() },
          });
          sent++;
        } catch (err) {
          await prisma.notificationLog.update({
            where: { id: log.id },
            data: { status: NotificationStatus.FAILED, errorMessage: String(err) },
          });
          failed++;
        }
      }
    }
  }

  return { sent, skipped, failed };
}

function buildReminderText(
  booking: {
    requestedStartAt: Date;
    service: { title: string };
    customer: { fullName: string };
    hairdresser: { fullName: string };
  },
  offsetHours: number,
  recipientType: RecipientType
): string {
  const timeLabel = offsetHours === 24 ? "فردا" : `${offsetHours} ساعت دیگه`;

  if (recipientType === RecipientType.CUSTOMER) {
    return [
      "🔔 یادآوری نوبت",
      "",
      `${timeLabel} نوبت داری:`,
      `✂️ سرویس: ${booking.service.title}`,
      `🕐 زمان: ${formatTehranDateTime(booking.requestedStartAt)}`,
    ].join("\n");
  }

  return [
    "🔔 یادآوری نوبت",
    "",
    `${timeLabel} این نوبت داری:`,
    `👤 مشتری: ${booking.customer.fullName}`,
    `✂️ سرویس: ${booking.service.title}`,
    `🕐 زمان: ${formatTehranDateTime(booking.requestedStartAt)}`,
  ].join("\n");
}
