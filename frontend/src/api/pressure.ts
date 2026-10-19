import { useQuery } from '@tanstack/react-query'

import type { PressureReading } from '@/lib/pressure'
import { pressureCopy, pressureOffline } from '@/offline/pressure'
import { readOr, write } from '@/offline/queue'
import { offlineState } from '@/offline/store'

import { api, type Schemas } from './client'

/** Показания давления: внесение, правка и удаление сбрасывают их. */
export const PRESSURE_KEY = ['blood-pressure'] as const

/**
 * Все показания давления, новые первыми: с сервера, а без сети и пока очередь не пуста — по
 * копии, где они лежат целиком вместе с теми, которых сервер ещё не видел (ADR 0020).
 */
export function usePressureReadings() {
  return useQuery({
    queryKey: PRESSURE_KEY,
    networkMode: 'always',
    queryFn: async () => {
      const { online, queued } = offlineState.get()
      const load = async () => {
        const result = await api.GET('/api/blood-pressure')
        // Ответ экрана тоже наполняет копию: связь может пропасть до фонового обновления.
        if (result.data && offlineState.get().queued === 0)
          await pressureCopy.replace({
            etag: result.response.headers.get('ETag'),
            items: result.data,
          })
        return result
      }
      return (
        (online && queued === 0 ? await readOr(load, pressureOffline) : await pressureOffline()) ??
        []
      )
    },
  })
}

export async function savePressure(id: string, body: Schemas['BloodPressureIn']) {
  return write<PressureReading>(
    {
      method: 'PUT',
      path: '/api/blood-pressure/{reading_id}',
      params: { reading_id: id },
      body,
      context: {
        kind: 'pressure',
        localDate: body.local_date,
        pressure: { systolic: body.systolic, diastolic: body.diastolic, pulse: body.pulse ?? null },
      },
    },
    () => pressureCopy.save(id, body),
  )
}

export async function deletePressure(reading: PressureReading) {
  return write(
    {
      method: 'DELETE',
      path: '/api/blood-pressure/{reading_id}',
      params: { reading_id: reading.id },
      context: {
        kind: 'pressureRemove',
        localDate: reading.local_date,
        pressure: {
          systolic: reading.systolic,
          diastolic: reading.diastolic,
          pulse: reading.pulse,
        },
      },
    },
    () => pressureCopy.remove(reading.id),
  )
}
