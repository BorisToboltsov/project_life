import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'
import { callsTo, json, mockApi } from '@/test/api'
import { renderApp } from '@/test/app'
import { anna } from '@/test/fixtures'
import { labCatalog, labReport, REPORT_ID } from '@/test/health'
import { offlineState } from '@/offline/store'

const FILES = `GET /api/lab-reports/${REPORT_ID}/files`
const base = {
  'GET /api/lab-reports': json(200, [labReport()]),
  'GET /api/lab-analytes': json(200, labCatalog),
}
it('файлы требуют сети; числовой бланк остаётся доступен', async () => {
  mockApi({ ...base, [FILES]: json(200, []) })
  await renderApp(`/labs/${REPORT_ID}`, anna)
  await screen.findByLabelText('Прикрепить файл')
  offlineState.setOnline(false)
  expect(
    await screen.findByText('Для загрузки и просмотра файлов нужен интернет.'),
  ).toBeInTheDocument()
  expect(screen.queryByLabelText('Прикрепить файл')).not.toBeInTheDocument()
})
it('ошибка списка не выглядит пустым списком', async () => {
  mockApi({ ...base, [FILES]: json(503, { error: 'file_storage_unavailable' }) })
  await renderApp(`/labs/${REPORT_ID}`, anna)
  expect(await screen.findByText('Не удалось загрузить список файлов.')).toBeInTheDocument()
})
it('удаление требует подтверждения и обновляет список', async () => {
  const item = {
    id: 'file',
    name: 'scan.pdf',
    size: 1024,
    state: 'ready',
    content_type: 'application/pdf',
  }
  let deleted = false
  const calls = mockApi({
    ...base,
    [FILES]: () => json(200, deleted ? [] : [item])({} as never),
    'DELETE /api/files/file': () => {
      deleted = true
      return new Response(null, { status: 204 })
    },
  })
  await renderApp(`/labs/${REPORT_ID}`, anna)
  const panel = within(await screen.findByRole('region', { name: 'Файлы' }))
  await userEvent.click(await panel.findByRole('button', { name: 'Удалить файл' }))
  expect(callsTo(calls, 'DELETE /api/files/file')).toHaveLength(0)
  await userEvent.click(panel.getByRole('button', { name: 'Отмена' }))
  await userEvent.click(panel.getByRole('button', { name: 'Удалить файл' }))
  await userEvent.click(panel.getByRole('button', { name: /^Удалить$/ }))
  await waitFor(() => expect(panel.queryByText('scan.pdf')).not.toBeInTheDocument())
  expect(callsTo(calls, 'DELETE /api/files/file')).toHaveLength(1)
})
