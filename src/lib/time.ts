import { toZonedTime, fromZonedTime, format } from "date-fns-tz";

export const TIMEZONE = process.env.DEFAULT_TIMEZONE ?? "Asia/Tehran";

export function nowInTehran(): Date {
  return toZonedTime(new Date(), TIMEZONE);
}

export function toTehranTime(utcDate: Date): Date {
  return toZonedTime(utcDate, TIMEZONE);
}

export function fromTehranTime(localDate: Date): Date {
  return fromZonedTime(localDate, TIMEZONE);
}

export function formatTehranDate(utcDate: Date): string {
  return format(toZonedTime(utcDate, TIMEZONE), "yyyy-MM-dd", { timeZone: TIMEZONE });
}

export function formatTehranDateTime(utcDate: Date): string {
  return format(toZonedTime(utcDate, TIMEZONE), "yyyy-MM-dd HH:mm", { timeZone: TIMEZONE });
}

export function formatTehranTime(utcDate: Date): string {
  return format(toZonedTime(utcDate, TIMEZONE), "HH:mm", { timeZone: TIMEZONE });
}

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
