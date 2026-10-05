import type { Schemas } from '@/api/client'
import type { User } from '@/auth/session'

export const anna: User = {
  id: '0199b7a0-0000-7000-8000-000000000001',
  email: 'anna@example.com',
  display_name: 'Анна',
  role: 'user',
  language: 'ru',
  timezone: 'Europe/Moscow',
  unit_system: 'metric',
  sex: null,
  birth_date: null,
  height_cm: null,
}

export const boris: User = { ...anna, id: '0199b7a0-0000-7000-8000-000000000002', role: 'admin' }

export function sessionOf(user: User, token = 'access-1'): Schemas['SessionOut'] {
  return { access_token: token, expires_in: 900, user }
}

export const metricTypes: Schemas['MetricTypeOut'][] = [
  { code: 'weight', quantity: 'mass', unit: 'kg', min_value: 2, max_value: 500 },
  { code: 'neck', quantity: 'length', unit: 'cm', min_value: 15, max_value: 80 },
  { code: 'waist', quantity: 'length', unit: 'cm', min_value: 30, max_value: 250 },
  { code: 'hips', quantity: 'length', unit: 'cm', min_value: 30, max_value: 250 },
]

let sequence = 0

/** Замер веса в килограммах на дату `local_date`; остальное — через `overrides`. */
export function measurement(
  local_date: string,
  value: number,
  overrides: Partial<Schemas['MeasurementOut']> = {},
): Schemas['MeasurementOut'] {
  sequence += 1
  return {
    id: `0199b7a0-0000-7000-8000-${String(sequence).padStart(12, '0')}`,
    metric: 'weight',
    value,
    unit: 'kg',
    original_value: value,
    original_unit: 'kg',
    measured_at: `${local_date}T07:00:00Z`,
    local_date,
    ...overrides,
  }
}

export function summaryOf(
  entries: Partial<
    Record<Schemas['Metric'], [Schemas['MeasurementOut'], Schemas['MeasurementOut']?]>
  >,
): Schemas['MetricSummary'][] {
  return metricTypes.map(({ code }) => ({
    metric: code,
    latest: entries[code]?.[0] ?? null,
    previous: entries[code]?.[1] ?? null,
  }))
}
