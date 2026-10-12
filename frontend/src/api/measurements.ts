import { useQuery } from '@tanstack/react-query'

import { attempt } from '@/lib/errors'

import { api, type Schemas } from './client'

export type Metric = Schemas['MetricOut']
export type MetricPreset = Schemas['MetricPreset']
export type Measurement = Schemas['MeasurementOut']

/** Список видов замеров пользователя: добавление, переименование и удаление сбрасывают его. */
export const METRICS_KEY = ['metrics'] as const

/** Все запросы замеров начинаются с этого ключа: сохранение сбрасывает их разом. */
export const MEASUREMENTS_KEY = ['measurements'] as const

const NO_METRICS: Schemas['MetricListOut'] = { metrics: [], available: [] }

/**
 * Виды замеров пользователя по порядку, вместе с убранными, и штатные виды, которых в
 * списке нет.
 */
export function useMetrics() {
  return useQuery({
    queryKey: METRICS_KEY,
    queryFn: async () => (await api.GET('/api/metrics')).data ?? NO_METRICS,
  })
}

/** Виды, которые сейчас в списке: по ним вносят замеры. */
export function listed(metrics: Metric[] | undefined): Metric[] {
  return (metrics ?? []).filter((metric) => !metric.archived)
}

/** Свой вид замера: создаёт, переименовывает или возвращает убранный в список. */
export function saveMetric(id: string, body: Schemas['MetricIn']) {
  return attempt(() =>
    api.PUT('/api/metrics/{metric_id}', { params: { path: { metric_id: id } }, body }),
  )
}

/** Ставит штатный вид замера в список: новый или убранный раньше. */
export function addPresetMetric(preset: MetricPreset) {
  return attempt(() => api.POST('/api/metrics/presets', { body: { preset } }))
}

/** Убирает вид замера из списка; внесённые по нему замеры остаются. */
export function deleteMetric(id: string) {
  return attempt(() =>
    api.DELETE('/api/metrics/{metric_id}', { params: { path: { metric_id: id } } }),
  )
}

export function useMeasurementSummary() {
  return useQuery({
    queryKey: [...MEASUREMENTS_KEY, 'summary'],
    queryFn: async () => (await api.GET('/api/measurements/summary')).data ?? [],
  })
}

/** История вида замера, новые записи первыми; `from` — с какой местной даты. */
export function useMeasurementHistory(metricId: string, from?: string) {
  return useQuery({
    queryKey: [...MEASUREMENTS_KEY, 'history', metricId, from ?? 'all'],
    queryFn: async () => {
      const query = from ? { metric_id: metricId, from } : { metric_id: metricId }
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
