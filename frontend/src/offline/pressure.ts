import type { Schemas } from '@/api/client'
import type { PressureReading } from '@/lib/pressure'

import { copy } from './copy'

/** Ключ копии показаний давления (ADR 0020). */
export const PRESSURE_COPY = 'blood-pressure'

/** Все показания, новые первыми, и метка, с которой их отдал сервер. */
export interface PressureCopy {
  etag: string | null
  items: PressureReading[]
}

/** Порядок сервера: новые дни первыми, в одном дне — позднее время первым. */
const newestFirst = (a: PressureReading, b: PressureReading) =>
  b.local_date.localeCompare(a.local_date) ||
  Date.parse(b.measured_at) - Date.parse(a.measured_at) ||
  a.id.localeCompare(b.id)

/** Показания по копии — тот же ответ, что `GET /api/blood-pressure`. */
export async function pressureOffline(): Promise<PressureReading[]> {
  return (await copy.get<PressureCopy>(PRESSURE_COPY))?.items ?? []
}

async function edit(change: (items: PressureReading[]) => PressureReading[]): Promise<void> {
  await copy.update<PressureCopy>(PRESSURE_COPY, (current) =>
    current
      ? { ...current, etag: null, items: change(current.items).sort(newestFirst) }
      : undefined,
  )
}

/** Изменения показаний в копии — те же, что делает сервер (ADR 0020). */
export const pressureCopy = {
  async save(id: string, body: Schemas['BloodPressureIn']): Promise<void> {
    const item: PressureReading = {
      id,
      measured_at: body.measured_at,
      local_date: body.local_date,
      systolic: body.systolic,
      diastolic: body.diastolic,
      pulse: body.pulse ?? null,
    }
    await edit((items) => [...items.filter((row) => row.id !== id), item])
  },

  async remove(id: string): Promise<void> {
    await edit((items) => items.filter((row) => row.id !== id))
  },

  /** Все показания, как их отдал сервер. */
  async replace(next: PressureCopy): Promise<void> {
    await copy.put(PRESSURE_COPY, next)
  },
}
