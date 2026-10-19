// Давление на границе интерфейса (ADR 0022): отметка «выше 135/85» и среднее за неделю.
// Они вычисляются при выводе и не хранятся (инвариант I22).

import type { Schemas } from '@/api/client'

import { shiftDays } from './dates'

export type PressureReading = Schemas['BloodPressureOut']

/**
 * Порог домашнего измерения: с этих значений рекомендации ESH и Минздрава считают
 * давление повышенным.
 */
export const HOME_LIMIT = { systolic: 135, diastolic: 85 } as const

/** Пределы полей, как их проверяет сервер. */
export const SYSTOLIC = { min: 50, max: 300 } as const
export const DIASTOLIC = { min: 25, max: 200 } as const
export const PULSE = { min: 20, max: 250 } as const

/** Сколько дней берёт среднее, включая сегодня. */
export const AVERAGE_DAYS = 7

/** Выше порога домашнего измерения: верхнее не ниже 135 или нижнее не ниже 85. */
export function aboveHomeLimit(reading: Pick<PressureReading, 'systolic' | 'diastolic'>): boolean {
  return reading.systolic >= HOME_LIMIT.systolic || reading.diastolic >= HOME_LIMIT.diastolic
}

export interface PressureAverage {
  systolic: number
  diastolic: number
  /** Средний пульс по показаниям, где он есть; нет ни одного — `null`. */
  pulse: number | null
  count: number
}

const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length

/** Среднее за последние 7 дней по местной дате; показаний нет — `null`. */
export function weekAverage(
  readings: readonly PressureReading[],
  today: string,
): PressureAverage | null {
  const from = shiftDays(today, -(AVERAGE_DAYS - 1))
  const week = readings.filter((item) => item.local_date >= from && item.local_date <= today)
  if (week.length === 0) return null
  const pulses = week.flatMap((item) => (item.pulse === null ? [] : [item.pulse]))
  return {
    systolic: mean(week.map((item) => item.systolic)),
    diastolic: mean(week.map((item) => item.diastolic)),
    pulse: pulses.length > 0 ? Math.round(mean(pulses)) : null,
    count: week.length,
  }
}
