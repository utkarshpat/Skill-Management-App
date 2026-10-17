// Cache formatters, never formatted dates: the same zone must remain fresh
// across midnight and daylight-saving changes. Bound retained Intl objects.
const dateFormatters = new Map<string, Intl.DateTimeFormat>();
const formatterLimit = 32;
export function dateInZone(date: Date, zone: string) {
  let formatter = dateFormatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    if (dateFormatters.size >= formatterLimit)
      dateFormatters.delete(dateFormatters.keys().next().value!);
  } else dateFormatters.delete(zone);
  dateFormatters.set(zone, formatter);
  return formatter.format(date);
}
export const shiftDay = (day: string, n: number) => {
  const d = new Date(day + 'T12:00:00Z');
  if (!Number.isFinite(d.getTime())) return '';
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export function currentStreak(days: string[], today: string) {
  const set = new Set(days);
  let cursor = set.has(today) ? today : shiftDay(today, -1),
    total = 0;
  while (set.has(cursor)) {
    total++;
    cursor = shiftDay(cursor, -1);
  }
  return total;
}
