import { isoToLocalDate, localDateToIso, shiftDays } from '@/lib/dates'

export type Period = 'week' | 'month'

/** Календарный период: неделя с понедельника, месяц с первого числа. */
export function periodStart(date: string, period: Period): string {
  const day = isoToLocalDate(date)!
  return period === 'month' ? `${date.slice(0, 7)}-01` : shiftDays(date, -((day.getDay() + 6) % 7))
}

export function shiftPeriod(date: string, period: Period, direction: number): string {
  const start = periodStart(date, period)
  if (period === 'week') return shiftDays(start, direction * 7)
  const day = isoToLocalDate(start)!
  day.setMonth(day.getMonth() + direction)
  return localDateToIso(day)
}
