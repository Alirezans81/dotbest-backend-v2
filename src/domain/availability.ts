import { prisma } from "@/lib/prisma";
import { toZonedTime } from "date-fns-tz";
import { addMinutes, formatTehranDate, formatTehranTime, TIMEZONE, dayOfWeek, minuteOfDay } from "@/lib/time";
import { BookingStatus } from "@prisma/client";

/**
 * Statuses that physically occupy a slot and prevent new bookings.
 * PENDING_REVIEW and APPROVED_AWAITING_DEPOSIT do NOT block slots —
 * multiple customers may request the same time concurrently.
 * The slot gets hard-locked only when a payment is initiated (PAYMENT_PENDING).
 */
export const SLOT_BLOCKING_STATUSES: BookingStatus[] = [
  BookingStatus.PAYMENT_PENDING,
  BookingStatus.CONFIRMED,
];

/** Statuses that are still "live" (not yet resolved) — used for conflict detection. */
export const ACTIVE_BOOKING_STATUSES: BookingStatus[] = [
  BookingStatus.PENDING_REVIEW,
  BookingStatus.APPROVED_AWAITING_DEPOSIT,
  BookingStatus.PAYMENT_PENDING,
  BookingStatus.CONFIRMED,
];

const SLOT_INTERVAL = parseInt(process.env.BOOKING_SLOT_INTERVAL_MINUTES ?? "30", 10);
const HORIZON_DAYS = 14;

export interface TimeSlot {
  startAt: Date;
  endAt: Date;
  label: string;
  isoStartAt: string;
  date: string;
}

export async function getAvailableSlots(
  hairdresserId: string,
  serviceDurationMinutes: number,
  onDate?: string
): Promise<Map<string, TimeSlot[]>> {
  const now = new Date();
  const horizonEnd = addMinutes(now, HORIZON_DAYS * 24 * 60);

  const [workingHoursRaw, blockedTimes, blockingBookings] = await Promise.all([
    prisma.workingHours.findMany({ where: { hairdresserId, isActive: true }, orderBy: { updatedAt: "desc" } }),
    prisma.blockedTime.findMany({
      where: { hairdresserId, startsAt: { lte: horizonEnd }, endsAt: { gte: now } },
    }),
    prisma.booking.findMany({
      where: {
        hairdresserId,
        status: { in: SLOT_BLOCKING_STATUSES },
        requestedEndAt: { gte: now },
      },
    }),
  ]);

  // Deduplicate: one entry per dayOfWeek, keep the most recently updated
  const seenDays = new Set<number>();
  const workingHours = workingHoursRaw.filter((wh) => {
    if (seenDays.has(wh.dayOfWeek)) return false;
    seenDays.add(wh.dayOfWeek);
    return true;
  });

  const slotsByDate = new Map<string, TimeSlot[]>();

  let cursor = new Date(now);
  cursor.setSeconds(0, 0);
  const roundedMinute = Math.ceil(cursor.getMinutes() / SLOT_INTERVAL) * SLOT_INTERVAL;
  cursor.setMinutes(roundedMinute);

  while (cursor < horizonEnd) {
    const dateKey = formatTehranDate(cursor);

    if (onDate && dateKey !== onDate) {
      cursor = addMinutes(cursor, SLOT_INTERVAL);
      continue;
    }

    const dow = dayOfWeek(cursor);
    const slotStart = cursor;
    const slotEnd = addMinutes(slotStart, serviceDurationMinutes);

    const wh = workingHours.find((w) => w.dayOfWeek === dow && w.isActive);
    if (!wh) { cursor = addMinutes(cursor, SLOT_INTERVAL); continue; }

    const slotStartMin = minuteOfDay(slotStart);
    if (slotStartMin < wh.startMinuteOfDay || slotStartMin >= wh.endMinuteOfDay) {
      cursor = addMinutes(cursor, SLOT_INTERVAL); continue;
    }

    if (blockedTimes.some((b) => slotStart < b.endsAt && slotEnd > b.startsAt)) {
      cursor = addMinutes(cursor, SLOT_INTERVAL); continue;
    }

    if (blockingBookings.some((b) => slotStart < b.requestedEndAt && slotEnd > b.requestedStartAt)) {
      cursor = addMinutes(cursor, SLOT_INTERVAL); continue;
    }

    const slot: TimeSlot = {
      startAt: new Date(slotStart),
      endAt: new Date(slotEnd),
      label: formatTehranTime(slotStart),
      isoStartAt: slotStart.toISOString(),
      date: dateKey,
    };

    if (!slotsByDate.has(dateKey)) slotsByDate.set(dateKey, []);
    slotsByDate.get(dateKey)!.push(slot);

    cursor = addMinutes(cursor, SLOT_INTERVAL);
  }

  return slotsByDate;
}

export async function getAvailableDates(
  hairdresserId: string,
  serviceDurationMinutes: number
): Promise<string[]> {
  const slots = await getAvailableSlots(hairdresserId, serviceDurationMinutes);
  return Array.from(slots.keys()).sort();
}

export async function isSlotAvailable(
  hairdresserId: string,
  startAt: Date,
  durationMinutes: number
): Promise<boolean> {
  const endAt = addMinutes(startAt, durationMinutes);

  const [workingHours, blockedOverlap, bookingOverlap] = await Promise.all([
    prisma.workingHours.findMany({
      where: { hairdresserId, isActive: true, dayOfWeek: dayOfWeek(startAt) },
      orderBy: { updatedAt: "desc" },
      take: 1,
    }),
    prisma.blockedTime.count({
      where: { hairdresserId, startsAt: { lt: endAt }, endsAt: { gt: startAt } },
    }),
    prisma.booking.count({
      where: {
        hairdresserId,
        status: { in: SLOT_BLOCKING_STATUSES },
        requestedStartAt: { lt: endAt },
        requestedEndAt: { gt: startAt },
      },
    }),
  ]);

  if (blockedOverlap > 0 || bookingOverlap > 0) return false;

  const slotStartMin = minuteOfDay(startAt);

  return workingHours.some(
    (wh) => wh.isActive && slotStartMin >= wh.startMinuteOfDay && slotStartMin < wh.endMinuteOfDay
  );
}

/** Find concurrent PENDING_REVIEW / APPROVED_AWAITING_DEPOSIT bookings that overlap a slot. */
export async function getConflictingPendingBookings(
  hairdresserId: string,
  startAt: Date,
  endAt: Date,
  excludeBookingId: string
): Promise<string[]> {
  const conflicts = await prisma.booking.findMany({
    where: {
      hairdresserId,
      id: { not: excludeBookingId },
      status: { in: [BookingStatus.PENDING_REVIEW, BookingStatus.APPROVED_AWAITING_DEPOSIT] },
      requestedStartAt: { lt: endAt },
      requestedEndAt: { gt: startAt },
    },
    select: { id: true },
  });
  return conflicts.map((b) => b.id);
}
