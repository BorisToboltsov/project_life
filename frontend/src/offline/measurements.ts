import type { Schemas } from '@/api/client'
import { canonicalUnit, toCanonical } from '@/lib/units'

import { copy } from './copy'

type Measurement = Schemas['MeasurementOut']
type MetricList = Schemas['MetricListOut']
type Summary = Schemas['MetricSummary']

/** Ключи копии замеров (ADR 0020). */
export const MEASUREMENT_COPY = {
  metrics: 'metrics',
  all: 'measurements',
} as const

/** Все замеры пользователя, новые первыми, и метка, с которой их отдал сервер. */
export interface MeasurementsCopy {
  etag: string | null
  items: Measurement[]
}

/** Порядок сервера: новые дни первыми, в одном дне — позднее время первым. */
const newestFirst = (a: Measurement, b: Measurement) =>
  b.local_date.localeCompare(a.local_date) ||
  Date.parse(b.measured_at) - Date.parse(a.measured_at) ||
  a.id.localeCompare(b.id)

async function stored(): Promise<Measurement[]> {
  return (await copy.get<MeasurementsCopy>(MEASUREMENT_COPY.all))?.items ?? []
}

/** История вида замера по копии — тот же ответ, что `GET /api/measurements`. */
export async function measurementHistoryOffline(
  metricId: string,
  from?: string,
): Promise<Measurement[]> {
  return (await stored()).filter(
    (item) => item.metric_id === metricId && (from === undefined || item.local_date >= from),
  )
}

/** Последний и предыдущий замер каждого вида по копии — как `GET /api/measurements/summary`. */
export async function measurementSummaryOffline(): Promise<Summary[]> {
  const [list, items] = await Promise.all([
    copy.get<MetricList>(MEASUREMENT_COPY.metrics),
    stored(),
  ])
  return (list?.metrics ?? []).map((metric) => {
    const [latest = null, previous = null] = items.filter((item) => item.metric_id === metric.id)
    return { metric_id: metric.id, latest, previous }
  })
}

export async function measurementFromCopy(id: string): Promise<Measurement | undefined> {
  return (await stored()).find((item) => item.id === id)
}

async function edit(change: (items: Measurement[]) => Measurement[]): Promise<void> {
  await copy.update<MeasurementsCopy>(MEASUREMENT_COPY.all, (current) =>
    current ? { ...current, items: change(current.items).sort(newestFirst) } : undefined,
  )
}

/** Изменения замеров в копии — те же, что делает сервер (ADR 0020). */
export const measurementsCopy = {
  async save(id: string, body: Schemas['MeasurementIn']): Promise<void> {
    const value = Number(body.value)
    const item: Measurement = {
      id,
      metric_id: body.metric_id,
      value: toCanonical(value, body.unit),
      unit: canonicalUnit(body.unit),
      original_value: value,
      original_unit: body.unit,
      measured_at: body.measured_at,
      local_date: body.local_date,
    }
    await edit((items) => [...items.filter((row) => row.id !== id), item])
  },

  async remove(id: string): Promise<void> {
    await edit((items) => items.filter((row) => row.id !== id))
  },

  /** Все замеры, как их отдал сервер. */
  async replace(next: MeasurementsCopy): Promise<void> {
    await copy.put(MEASUREMENT_COPY.all, next)
  },
}
