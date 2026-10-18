import { describe, expect, it, vi } from 'vitest'

import { girthOf, measurement, metricList, metrics } from '@/test/fixtures'

import { copy } from './copy'
import {
  MEASUREMENT_COPY,
  measurementHistoryOffline,
  type MeasurementsCopy,
  measurementsCopy,
  measurementSummaryOffline,
} from './measurements'
import { refreshCopy } from './sync'

const NEW_ID = '0199b7a0-0000-7000-8000-00000000aa01'

async function seed(items: MeasurementsCopy['items']) {
  await copy.put(MEASUREMENT_COPY.metrics, metricList())
  await copy.put(MEASUREMENT_COPY.all, { etag: '"1"', items } satisfies MeasurementsCopy)
}

const stored = async () => (await copy.get<MeasurementsCopy>(MEASUREMENT_COPY.all))?.items

describe('замеры в копии', () => {
  it('новый замер встаёт на своё место по дате, как его вернул бы сервер', async () => {
    const older = measurement('2026-10-01', 73)
    const newer = measurement('2026-10-10', 72.4)
    await seed([newer, older])

    await measurementsCopy.save(NEW_ID, {
      metric_id: metrics.weight.id,
      value: '160',
      unit: 'lb',
      measured_at: '2026-10-05T07:00:00.000Z',
      local_date: '2026-10-05',
    })

    expect(await stored()).toEqual([
      newer,
      {
        id: NEW_ID,
        metric_id: metrics.weight.id,
        // Канонически — в килограммах до тысячных, как введено — в фунтах.
        value: 72.575,
        unit: 'kg',
        original_value: 160,
        original_unit: 'lb',
        measured_at: '2026-10-05T07:00:00.000Z',
        local_date: '2026-10-05',
      },
      older,
    ])
  })

  it('повтор под тем же ключом заменяет замер, удаление убирает его', async () => {
    const item = measurement('2026-10-10', 72.4)
    await seed([item])

    await measurementsCopy.save(item.id, {
      metric_id: item.metric_id,
      value: 71.9,
      unit: 'kg',
      measured_at: item.measured_at,
      local_date: '2026-10-11',
    })
    expect((await stored())?.map((row) => [row.local_date, row.value])).toEqual([
      ['2026-10-11', 71.9],
    ])

    await measurementsCopy.remove(item.id)
    expect(await stored()).toEqual([])
  })

  it('в одном дне позднее время стоит первым', async () => {
    const morning = measurement('2026-10-10', 72.1, { measured_at: '2026-10-10T05:00:00Z' })
    await seed([morning])

    await measurementsCopy.save(NEW_ID, {
      metric_id: metrics.weight.id,
      value: 72.9,
      unit: 'kg',
      measured_at: '2026-10-10T18:00:00.000Z',
      local_date: '2026-10-10',
    })

    expect((await stored())?.map((row) => row.value)).toEqual([72.9, 72.1])
  })

  it('без копии запись в неё не попадает: неполную историю не выдать за полную', async () => {
    await measurementsCopy.save(NEW_ID, {
      metric_id: metrics.weight.id,
      value: 72,
      unit: 'kg',
      measured_at: '2026-10-10T07:00:00.000Z',
      local_date: '2026-10-10',
    })

    expect(await stored()).toBeUndefined()
  })

  it('история — по виду и с даты, сводка — последний и предыдущий по каждому виду', async () => {
    const waist = girthOf(metrics.waist, '2026-10-08', 84)
    const latest = measurement('2026-10-10', 72.4)
    const previous = measurement('2026-10-03', 72.8)
    const old = measurement('2024-01-01', 80)
    await seed([latest, waist, previous, old])

    expect(await measurementHistoryOffline(metrics.weight.id)).toEqual([latest, previous, old])
    expect(await measurementHistoryOffline(metrics.weight.id, '2026-10-03')).toEqual([
      latest,
      previous,
    ])
    expect(await measurementSummaryOffline()).toEqual([
      { metric_id: metrics.weight.id, latest, previous },
      { metric_id: metrics.neck.id, latest: null, previous: null },
      { metric_id: metrics.waist.id, latest: waist, previous: null },
      { metric_id: metrics.hips.id, latest: null, previous: null },
    ])
  })
})

describe('обновление копии замеров', () => {
  /** Сервер с замерами под меткой `etag`: на неё же в `If-None-Match` отвечает 304. */
  function serve(items: MeasurementsCopy['items'], etag: string) {
    const asked: (string | null)[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        const path = new URL(request.url).pathname
        if (path === '/api/metrics') return Response.json(metricList())
        if (path !== '/api/measurements/all') return new Response(null, { status: 404 })
        asked.push(request.headers.get('If-None-Match'))
        if (request.headers.get('If-None-Match') === etag)
          return new Response(null, { status: 304, headers: { ETag: etag } })
        return Response.json(items, { headers: { ETag: etag } })
      }),
    )
    return asked
  }

  it('берёт все замеры со списком видов, а неизменные — ответом 304 по метке', async () => {
    const items = [measurement('2026-10-10', 72.4), measurement('2023-05-01', 81)]
    const asked = serve(items, '"a"')

    await refreshCopy()
    await refreshCopy()

    expect(asked).toEqual([null, '"a"'])
    expect(await copy.get(MEASUREMENT_COPY.all)).toEqual({ etag: '"a"', items })
    expect(await copy.get(MEASUREMENT_COPY.metrics)).toEqual(metricList())
  })
})
