import { toZonedTime, fromZonedTime, format } from "date-fns-tz";
import { toJalaali } from "jalaali-js";

export const TIMEZONE = process.env.DEFAULT_TIMEZONE ?? "Asia/Tehran";

const JALALI_MONTHS = [
  "فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور",
  "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند",
];

export function nowInTehran(): Date {
  return toZonedTime(new Date(), TIMEZONE);
}

export function toTehranTime(utcDate: Date): Date {
  return toZonedTime(utcDate, TIMEZONE);
}

export function fromTehranTime(localDate: Date): Date {
  return fromZonedTime(localDate, TIMEZONE);
}

// ─── Gregorian (internal storage) ────────────────────────────────────────────

export function formatTehranDate(utcDate: Date): string {
  return format(toZonedTime(utcDate, TIMEZONE), "yyyy-MM-dd", { timeZone: TIMEZONE });
}

export function formatTehranDateTime(utcDate: Date): string {
  return format(toZonedTime(utcDate, TIMEZONE), "yyyy-MM-dd HH:mm", { timeZone: TIMEZONE });
}

export function formatTehranTime(utcDate: Date): string {
  return format(toZonedTime(utcDate, TIMEZONE), "HH:mm", { timeZone: TIMEZONE });
}

// ─── Jalali (display to users) ────────────────────────────────────────────────

export function formatJalaliDate(utcDate: Date): string {
  const t = toZonedTime(utcDate, TIMEZONE);
  const { jy, jm, jd } = toJalaali(t.getFullYear(), t.getMonth() + 1, t.getDate());
  return `${jy}/${String(jm).padStart(2, "0")}/${String(jd).padStart(2, "0")}`;
}

export function formatJalaliDateTime(utcDate: Date): string {
  return `${formatJalaliDate(utcDate)} ${formatTehranTime(utcDate)}`;
}

export function formatJalaliDateFull(utcDate: Date): string {
  const t = toZonedTime(utcDate, TIMEZONE);
  const { jy, jm, jd } = toJalaali(t.getFullYear(), t.getMonth() + 1, t.getDate());
  return `${jd} ${JALALI_MONTHS[jm - 1]} ${jy}`;
}

/** Convert a Gregorian date string "yyyy-MM-dd" to Jalali display "yyyy/MM/dd" */
export function gregorianToJalali(gregorianDate: string): string {
  const [y, m, d] = gregorianDate.split("-").map(Number);
  const { jy, jm, jd } = toJalaali(y, m, d);
  return `${jy}/${String(jm).padStart(2, "0")}/${String(jd).padStart(2, "0")}`;
}

/** Convert a Gregorian date string "yyyy-MM-dd" to full Jalali "d MonthName yyyy" */
export function gregorianToJalaliFull(gregorianDate: string): string {
  const [y, m, d] = gregorianDate.split("-").map(Number);
  const { jy, jm, jd } = toJalaali(y, m, d);
  return `${jd} ${JALALI_MONTHS[jm - 1]} ${jy}`;
}

const JALALI_DAY_NAMES: Record<number, string> = {
  0: "یکشنبه", 1: "دوشنبه", 2: "سه‌شنبه", 3: "چهارشنبه",
  4: "پنجشنبه", 5: "جمعه", 6: "شنبه",
};

/** Convert a Gregorian date string "yyyy-MM-dd" to "DayName، d MonthName yyyy" */
export function gregorianToJalaliWithDayName(gregorianDate: string): string {
  const [y, m, d] = gregorianDate.split("-").map(Number);
  const jsDay = toZonedTime(new Date(Date.UTC(y, m - 1, d, 12, 0, 0)), TIMEZONE).getDay();
  const { jy, jm, jd } = toJalaali(y, m, d);
  return `${JALALI_DAY_NAMES[jsDay]}، ${jd} ${JALALI_MONTHS[jm - 1]} ${jy}`;
}

// ─── Arithmetic ──────────────────────────────────────────────────────────────

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

export function addHours(date: Date, hours: number): Date {
  return addMinutes(date, hours * 60);
}

export function minuteOfDay(date: Date): number {
  const tehran = toZonedTime(date, TIMEZONE);
  return tehran.getHours() * 60 + tehran.getMinutes();
}

export function dayOfWeek(date: Date): number {
  return toZonedTime(date, TIMEZONE).getDay();
}
