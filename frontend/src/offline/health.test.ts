import { expect, it, vi } from 'vitest'
import {
  saveLabReport,
  saveLabValue,
  saveLabAnalyte,
  deleteLabReport,
  deleteLabValue,
  deleteLabAnalyte,
} from '@/api/labs'
import { savePressure, deletePressure } from '@/api/pressure'
import {
  labCatalog,
  labReport,
  labValue,
  ownAnalyte,
  pressureReading,
  OWN_ID,
  REPORT_ID,
  VALUE_ID,
} from '@/test/health'
import { mockApi, json, callsTo } from '@/test/api'
import { copy } from './copy'
import { db } from './db'
import { LAB_COPY, labCopy, labReportsOffline } from './labs'
import { pressureCopy, pressureOffline } from './pressure'
import { offlineState } from './store'
import { flush } from './queue'
import { refreshCopy } from './sync'

async function seed() {
  await copy.put(LAB_COPY.analytes, labCatalog)
  await labCopy.replaceReports({ etag: '"old"', items: [] })
  await pressureCopy.replace({ etag: '"old"', items: [] })
  offlineState.setOnline(false)
}
it('без сети создаёт бланк и свой показатель перед значением; повтор правки не дублирует очередь', async () => {
  await seed()
  const report = labReport({ values: [] })
  await saveLabReport(REPORT_ID, report)
  await saveLabAnalyte(OWN_ID, { name: 'Антитела', unit: 'МЕ/мл' })
  await saveLabValue(report, VALUE_ID, { analyte_id: OWN_ID, value: 10, ref_high: 9 })
  await saveLabValue(report, VALUE_ID, { analyte_id: OWN_ID, value: 11, ref_high: 9 })
  expect((await labReportsOffline())[0]?.values[0]?.original_value).toBe(11)
  expect((await db.queue.toArray()).map((row) => row.context.kind)).toEqual([
    'labReport',
    'labAnalyte',
    'labValue',
  ])
  const calls = mockApi({
    'PUT /api/lab-reports/*': json(200, {}),
    'PUT /api/lab-analytes/*': json(200, {}),
  })
  offlineState.setOnline(true)
  expect(await flush()).toBe(true)
  expect(calls.filter((c) => c.method === 'PUT').map((c) => c.path)).toEqual([
    `/api/lab-reports/${REPORT_ID}`,
    `/api/lab-analytes/${OWN_ID}`,
    `/api/lab-reports/${REPORT_ID}/values/${VALUE_ID}`,
  ])
  expect(await db.queue.count()).toBe(0)
})
it('сохраняет число в канонической единице и референс как на бланке, удаление бланка схлопывает детей', async () => {
  await seed()
  const report = labReport({ values: [] })
  await saveLabReport(REPORT_ID, report)
  await saveLabValue(report, VALUE_ID, {
    preset: 'hemoglobin',
    value: '14.2',
    unit: 'g_dl',
    ref_low: 12,
    ref_high: 16,
  })
  expect((await labReportsOffline())[0]?.values[0]).toMatchObject({
    value: 142,
    original_value: 14.2,
    ref_low: 12,
    ref_high: 16,
  })
  await deleteLabReport(report)
  expect(await labReportsOffline()).toEqual([])
  expect((await db.queue.toArray()).map((row) => [row.method, row.context.kind])).toEqual([
    ['DELETE', 'labReportRemove'],
  ])
})
it('удаляет значение отдельно и архивирует показатель без потери бланка', async () => {
  await seed()
  await labCopy.replaceReports({ etag: null, items: [labReport()] })
  await deleteLabValue(labReport(), labValue())
  await deleteLabAnalyte(ownAnalyte)
  expect((await labReportsOffline())[0]?.values).toEqual([])
  expect((await copy.get<typeof labCatalog>(LAB_COPY.analytes))?.analytes[0]?.archived).toBe(true)
  await saveLabAnalyte(OWN_ID, { name: 'Антитела новые', unit: 'МЕ/мл' })
  expect((await copy.get<typeof labCatalog>(LAB_COPY.analytes))?.analytes[0]).toMatchObject({
    name: 'Антитела новые',
    archived: false,
  })
})
it('давление правится и удаляется без сети, отказ не останавливает остальную очередь', async () => {
  await seed()
  await savePressure(VALUE_ID, pressureReading())
  await savePressure(VALUE_ID, pressureReading({ systolic: 140, pulse: 75 }))
  expect(await pressureOffline()).toEqual([pressureReading({ systolic: 140, pulse: 75 })])
  await saveLabReport(REPORT_ID, labReport())
  const calls = mockApi({
    'PUT /api/blood-pressure/*': json(422, { detail: [] }),
    'PUT /api/lab-reports/*': json(200, {}),
  })
  offlineState.setOnline(true)
  await flush()
  expect(await db.rejected.count()).toBe(1)
  expect(callsTo(calls, 'PUT /api/lab-reports/*')).toHaveLength(1)
  offlineState.setOnline(false)
  await deletePressure(pressureReading())
  expect(await pressureOffline()).toEqual([])
})
it('изменённая локальная копия не использует старый ETag после отказа сервера', async () => {
  await seed()
  await labCopy.saveReport(REPORT_ID, labReport())
  await pressureCopy.save(VALUE_ID, pressureReading())
  const asked: (string | null)[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const path = new URL(request.url).pathname
      if (path === '/api/lab-reports' || path === '/api/blood-pressure') {
        asked.push(request.headers.get('If-None-Match'))
        return Response.json([], { headers: { ETag: '"old"' } })
      }
      return new Response(null, { status: 404 })
    }),
  )
  offlineState.setOnline(true)
  await refreshCopy()
  expect(asked).toEqual([null, null])
  expect(await labReportsOffline()).toEqual([])
  expect(await pressureOffline()).toEqual([])
})
