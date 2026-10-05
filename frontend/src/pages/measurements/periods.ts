import { shiftDays, today } from '@/lib/dates'

export const PERIODS = ['month', 'quarter', 'year', 'all'] as const

export type Period = (typeof PERIODS)[number]

const DAYS: Record<Period, number | null> = { month: 30, quarter: 90, year: 365, all: null }

/** С какой местной даты показывать историю; `undefined` — с самого начала. */
export function periodStart(period: Period): string | undefined {
  const days = DAYS[period]
  return days === null ? undefined : shiftDays(today(), -days)
}
