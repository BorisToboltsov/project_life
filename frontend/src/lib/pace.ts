import type { Schemas } from '@/api/client'

export type PaceUnit = Schemas['PaceUnit']

const KM_PER_MILE = 1.609344

/** Подпись единицы темпа: по тренажёру и, для километров, по системе единиц профиля. */
export type PaceLabel = 'per_km' | 'per_mi' | 'speed_km' | 'speed_mi' | 'per_500m'

/**
 * Темп в единице показа (ADR 0021): секунды на километр или милю, секунды на 500 м либо
 * скорость в километрах или милях в час. Сервер отдаёт секунды на километр.
 */
export function paceValue(secondsPerKm: number, unit: PaceUnit, imperial: boolean): number {
  if (unit === 'speed') return 3600 / secondsPerKm / (imperial ? KM_PER_MILE : 1)
  if (unit === 'per_500m') return secondsPerKm / 2
  return secondsPerKm * (imperial ? KM_PER_MILE : 1)
}

/** Время на отрезок — меньше значит быстрее; скорость — наоборот. */
export function lowerIsFaster(unit: PaceUnit): boolean {
  return unit !== 'speed'
}

export function paceLabel(unit: PaceUnit, imperial: boolean): PaceLabel {
  if (unit === 'per_500m') return 'per_500m'
  if (unit === 'speed') return imperial ? 'speed_mi' : 'speed_km'
  return imperial ? 'per_mi' : 'per_km'
}

/** Секунды часами: «5:12», «1:02:05». */
export function clockText(seconds: number): string {
  const total = Math.round(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const rest = String(total % 60).padStart(2, '0')
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`
}
