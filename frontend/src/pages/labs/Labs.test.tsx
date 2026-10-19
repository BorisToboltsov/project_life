import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'
import { labCatalog, labReport, labValue, REPORT_ID, VALUE_ID } from '@/test/health'
import { json, mockApi, callsTo } from '@/test/api'
import { renderApp } from '@/test/app'
import { anna } from '@/test/fixtures'
import { copy } from '@/offline/copy'
import { LAB_COPY, labCopy, labReportsOffline } from '@/offline/labs'
import { offlineState } from '@/offline/store'
import { db } from '@/offline/db'

const LIST = 'GET /api/lab-reports'
const CATALOG = 'GET /api/lab-analytes'
it('смена единицы пересчитывает подставленный референс и введённое число перед сохранением', async () => {
  const current = labReport({ values: [] })
  const calls = mockApi({
    [LIST]: json(200, [current, labReport({ id: 'older' })]),
    [CATALOG]: json(200, labCatalog),
    'PUT /api/lab-reports/*': json(201, labValue()),
  })
  await renderApp(`/labs/${REPORT_ID}/add/hemoglobin`, anna)
  await userEvent.type(await screen.findByLabelText('Значение'), '142')
  expect(screen.getByLabelText('От')).toHaveValue('120')
  await userEvent.click(screen.getByRole('radio', { name: 'г/дл' }))
  expect(screen.getByLabelText('Значение')).toHaveValue('14.2')
  expect(screen.getByLabelText('От')).toHaveValue('12')
  expect(screen.getByLabelText('До')).toHaveValue('16')
  await userEvent.click(screen.getByRole('button', { name: 'Добавить' }))
  await waitFor(() => expect(callsTo(calls, 'PUT /api/lab-reports/*')).toHaveLength(1))
  expect(callsTo(calls, 'PUT /api/lab-reports/*')[0]?.body).toEqual({
    preset: 'hemoglobin',
    unit: 'g_dl',
    value: 14.2,
    ref_low: 12,
    ref_high: 16,
  })
})
it('создаёт бланк без сети и сразу открывает поиск показателя; значение видно после сохранения', async () => {
  mockApi({})
  await copy.put(LAB_COPY.analytes, labCatalog)
  await labCopy.replaceReports({ etag: null, items: [] })
  await renderApp('/labs/new', anna)
  offlineState.setOnline(false)
  await userEvent.type(await screen.findByLabelText('Лаборатория'), 'Инвитро')
  await userEvent.click(screen.getByRole('button', { name: 'Создать бланк' }))
  await userEvent.click(await screen.findByRole('link', { name: 'Гемоглобин' }))
  await userEvent.type(await screen.findByLabelText('Значение'), '100')
  await userEvent.type(screen.getByLabelText('От'), '120')
  await userEvent.click(screen.getByRole('button', { name: 'Добавить' }))
  expect(await screen.findByRole('img', { name: 'ниже референса' })).toBeInTheDocument()
  expect((await labReportsOffline())[0]?.values[0]?.original_value).toBe(100)
  expect(await db.queue.count()).toBe(2)
})
it('на графике сопоставляет разные единицы, отметки берёт с каждого бланка', async () => {
  mockApi({
    [LIST]: json(200, [
      labReport({
        values: [
          labValue({ original_value: 14.2, original_unit: 'g_dl', ref_low: 12, ref_high: 16 }),
        ],
      }),
      labReport({
        id: 'older',
        local_date: '2026-01-01',
        values: [labValue({ id: 'older-value', value: 100, original_value: 100 })],
      }),
    ]),
    [CATALOG]: json(200, labCatalog),
  })
  await renderApp('/labs/analytes/hemoglobin', anna)
  expect(await screen.findByTestId('band')).toHaveTextContent('120..160')
  expect(screen.getByTestId('values')).toHaveTextContent('2026-01-01=100!')
  expect(screen.getByTestId('values')).toHaveTextContent('=142')
  expect(screen.getByRole('link', { name: 'Ещё' })).toHaveAttribute('aria-current', 'page')
  expect(screen.getByRole('navigation', { name: 'Разделы' })).toContainElement(
    screen.getByRole('link', { name: 'Анализы' }),
  )
})
it('правит и удаляет значение, ошибки API показывает без ухода с формы', async () => {
  const calls = mockApi({
    [LIST]: json(200, [labReport()]),
    [CATALOG]: json(200, labCatalog),
    'PUT /api/lab-reports/*': json(409, { detail: 'lab_value_taken' }),
    'DELETE /api/lab-reports/*': json(204),
  })
  await renderApp(`/labs/${REPORT_ID}/values/${VALUE_ID}`, anna)
  await userEvent.click(await screen.findByRole('button', { name: 'Сохранить' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Этот показатель уже есть в бланке')
  await userEvent.click(screen.getByRole('button', { name: 'Удалить показатель' }))
  await userEvent.click(screen.getByRole('button', { name: 'Да, удалить' }))
  await waitFor(() => expect(callsTo(calls, 'DELETE /api/lab-reports/*')).toHaveLength(1))
})
it('отказы анализов показывают показатель и лабораторию, удаляются с экрана', async () => {
  mockApi({ [CATALOG]: json(200, labCatalog) })
  await db.rejected.put({
    seq: 1,
    method: 'PUT',
    path: '/api/lab-reports/{report_id}/values/{value_id}',
    params: { report_id: REPORT_ID, value_id: VALUE_ID },
    context: {
      kind: 'labValue',
      lab: { preset: 'hemoglobin', value: 100, unit: 'g_l', lab: 'Инвитро' },
    },
    failure: 'errors.lab_value_taken',
  })
  await offlineState.reload()
  await renderApp('/unsent', anna)
  const row = await screen.findByRole('region', { name: 'Гемоглобин · 100 г/л' })
  expect(row).toHaveTextContent('Инвитро')
  await userEvent.click(within(row).getByRole('button', { name: 'Убрать' }))
  await waitFor(() => expect(db.rejected.count()).resolves.toBe(0))
})

it('свой показатель создаётся без сети и открывает форму значения с заданной единицей', async () => {
  mockApi({})
  await copy.put(LAB_COPY.analytes, labCatalog)
  await labCopy.replaceReports({ etag: null, items: [labReport({ values: [] })] })
  offlineState.setOnline(false)
  await renderApp(`/labs/${REPORT_ID}/add/own`, anna)
  await userEvent.type(await screen.findByLabelText('Название'), 'Кортизол свой')
  await userEvent.type(screen.getByLabelText('Единица'), 'мкг/дл')
  await userEvent.click(screen.getByRole('button', { name: 'Добавить' }))
  expect(await screen.findByRole('heading', { name: 'Кортизол свой' })).toBeVisible()
  await userEvent.type(screen.getByLabelText('Значение'), '9.5')
  await userEvent.click(screen.getByRole('button', { name: 'Добавить' }))
  expect(await screen.findByRole('link', { name: /Кортизол свой.*9,5/ })).toBeVisible()
  expect((await db.queue.toArray()).map((item) => item.context.kind)).toEqual([
    'labAnalyte',
    'labValue',
  ])
})
