import { useQuery } from '@tanstack/react-query'

import { attempt } from '@/lib/errors'

import { api, type Schemas } from './client'

export type Metric = Schemas['Metric']
export type Measurement = Schemas['MeasurementOut']
export type MetricType = Schemas['MetricTypeOut']

/** Порядок показателей в интерфейсе. */
export const METRICS: Metric[] = ['weight', 'neck', 'waist', 'hips']

/** Все запросы замеров начинаются с этого ключа: сохранение сбрасывает их разом. */
export const MEASUREMENTS_KEY = ['measurements'] as const

export function useMetricTypes() {
  return useQuery({
    queryKey: ['metric-types'],
    staleTime: Infinity,
    queryFn: async () => (await api.GET('/api/metric-types')).data ?? [],
  })
}

export function useMeasurementSummary() {
  return useQuery({
    queryKey: [...MEASUREMENTS_KEY, 'summary'],
    queryFn: async () => (await api.GET('/api/measurements/summary')).data ?? [],
  })
}

/** История показателя, новые записи первыми; `from` — с какой местной даты. */
export function useMeasurementHistory(metric: Metric, from?: string) {
  return useQuery({
    queryKey: [...MEASUREMENTS_KEY, 'history', metric, from ?? 'all'],
    queryFn: async () => {
      const query = from ? { metric, from } : { metric }
      return (await api.GET('/api/measurements', { params: { query } })).data ?? []
    },
  })
}

export function saveMeasurement(id: string, body: Schemas['MeasurementIn']) {
  return attempt(() =>
    api.PUT('/api/measurements/{measurement_id}', {
      params: { path: { measurement_id: id } },
      body,
    }),
  )
}

export function deleteMeasurement(id: string) {
  return attempt(() =>
    api.DELETE('/api/measurements/{measurement_id}', {
      params: { path: { measurement_id: id } },
    }),
  )
}
