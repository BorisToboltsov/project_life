import { useQuery } from '@tanstack/react-query'

import { attempt } from '@/lib/errors'
import type { ChangeContext } from '@/offline/db'
import {
  MEASUREMENT_COPY,
  measurementFromCopy,
  measurementHistoryOffline,
  measurementsCopy,
  measurementSummaryOffline,
} from '@/offline/measurements'
import { readOr, readThrough, write } from '@/offline/queue'
import { offlineState } from '@/offline/store'

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
    networkMode: 'always',
    queryFn: async () =>
      (await readThrough(MEASUREMENT_COPY.metrics, () => api.GET('/api/metrics'))) ?? NO_METRICS,
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

/**
 * Чтение замеров: с сервера, а без сети и пока очередь не пуста — по копии, где все замеры
 * лежат целиком вместе с теми, которых сервер ещё не видел (ADR 0020).
 */
async function readMeasurements<T>(
  load: () => Promise<{ data?: T; response: Response }>,
  local: () => Promise<T>,
): Promise<T | undefined> {
  const { online, queued } = offlineState.get()
  return online && queued === 0 ? readOr(load, local) : local()
}

export function useMeasurementSummary() {
  return useQuery({
    queryKey: [...MEASUREMENTS_KEY, 'summary'],
    networkMode: 'always',
    queryFn: async () =>
      (await readMeasurements(
        () => api.GET('/api/measurements/summary'),
        measurementSummaryOffline,
      )) ?? [],
  })
}

/** История вида замера, новые записи первыми; `from` — с какой местной даты. */
export function useMeasurementHistory(metricId: string, from?: string) {
  return useQuery({
    queryKey: [...MEASUREMENTS_KEY, 'history', metricId, from ?? 'all'],
    networkMode: 'always',
    queryFn: async () => {
      const query = from ? { metric_id: metricId, from } : { metric_id: metricId }
      return (
        (await readMeasurements(
          () => api.GET('/api/measurements', { params: { query } }),
          () => measurementHistoryOffline(metricId, from),
        )) ?? []
      )
    },
  })
}

export async function saveMeasurement(id: string, body: Schemas['MeasurementIn']) {
  return write<Measurement>(
    {
      method: 'PUT',
      path: '/api/measurements/{measurement_id}',
      params: { measurement_id: id },
      body,
      context: {
        kind: 'measurement',
        localDate: body.local_date,
        measurement: { metricId: body.metric_id, value: Number(body.value), unit: body.unit },
      },
    },
    () => measurementsCopy.save(id, body),
  )
}

/** Что удаляли — для строки «Не отправлено»: из копии, как замер виден на телефоне. */
async function aboutRemoval(id: string): Promise<ChangeContext> {
  const item = await measurementFromCopy(id)
  return {
    kind: 'measurementRemove',
    ...(item && {
      localDate: item.local_date,
      measurement: {
        metricId: item.metric_id,
        value: item.original_value,
        unit: item.original_unit,
      },
    }),
  }
}

export async function deleteMeasurement(id: string) {
  return write(
    {
      method: 'DELETE',
      path: '/api/measurements/{measurement_id}',
      params: { measurement_id: id },
      context: await aboutRemoval(id),
    },
    () => measurementsCopy.remove(id),
  )
}
