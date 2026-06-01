/**
 * Iranian week starts on Saturday.
 * JS Date.getDay(): 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
 * Iranian display index: 0=شنبه(Sat=6), 1=یکشنبه(Sun=0), 2=دوشنبه(Mon=1),
 *   3=سه‌شنبه(Tue=2), 4=چهارشنبه(Wed=3), 5=پنجشنبه(Thu=4), 6=جمعه(Fri=5)
 */

export interface DayInfo {
  iranIndex: number;
  jsDay: number;
  name: string;
}

export const IRAN_DAYS: DayInfo[] = [
  { iranIndex: 0, jsDay: 6, name: "شنبه" },
  { iranIndex: 1, jsDay: 0, name: "یکشنبه" },
  { iranIndex: 2, jsDay: 1, name: "دوشنبه" },
  { iranIndex: 3, jsDay: 2, name: "سه‌شنبه" },
  { iranIndex: 4, jsDay: 3, name: "چهارشنبه" },
  { iranIndex: 5, jsDay: 4, name: "پنجشنبه" },
  { iranIndex: 6, jsDay: 5, name: "جمعه" },
];

/** JS day (0-6) → فارسی نام */
export const JS_DAY_NAME: Record<number, string> = Object.fromEntries(
  IRAN_DAYS.map((d) => [d.jsDay, d.name])
);

/** ایندکس ایرانی (0=شنبه) → JS day */
export function iranIndexToJsDay(iranIndex: number): number {
  return IRAN_DAYS[iranIndex].jsDay;
}

/** JS day → ایندکس ایرانی */
export function jsDayToIranIndex(jsDay: number): number {
  return IRAN_DAYS.find((d) => d.jsDay === jsDay)!.iranIndex;
}
