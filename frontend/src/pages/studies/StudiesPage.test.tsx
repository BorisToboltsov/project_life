import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'
import { offlineState } from '@/offline/store'
import { callsTo, json, mockApi } from '@/test/api'
import { renderApp } from '@/test/app'
import { anna } from '@/test/fixtures'

const id = '019a0000-0000-7000-8000-000000000013'
const study = {
  id,
  title: 'КТ грудной клетки',
  local_date: '2026-10-20',
  institution: 'Клиника',
  note: null,
  created_at: '2026-10-20T00:00:00Z',
  updated_at: '2026-10-20T00:00:00Z',
}
it('показывает исследования и дату в порядке день-месяц-год', async () => {
  mockApi({ 'GET /api/studies': json(200, [study]) })
  await renderApp('/studies', anna)
  expect(await screen.findByRole('link', { name: /КТ грудной клетки/ })).toHaveAttribute(
    'href',
    `/studies/${id}`,
  )
  expect(screen.getByText(/20\/10\/2026/)).toBeInTheDocument()
})
it('показывает ошибку списка вместо пустого результата', async () => {
  mockApi({ 'GET /api/studies': json(503, { detail: 'file_storage_unavailable' }) })
  await renderApp('/studies', anna)
  expect(await screen.findByText('Не удалось загрузить исследования')).toBeInTheDocument()
  expect(screen.queryByText('Исследований пока нет')).not.toBeInTheDocument()
})
it('создаёт исследование и открывает карточку', async () => {
  const calls = mockApi({
    'GET /api/studies': json(200, []),
    'PUT /api/studies/*': json(201, study),
    'GET /api/studies/*': (call) =>
      json(200, call.path.endsWith('/files') || call.path.endsWith('/imports') ? [] : study)(call),
  })
  await renderApp('/studies', anna)
  await userEvent.click(await screen.findByRole('button', { name: 'Добавить исследование' }))
  await userEvent.type(screen.getByLabelText('Название'), 'МРТ')
  await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
  expect(await screen.findByRole('heading', { name: 'Заключение' })).toBeInTheDocument()
  expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(1)
})
it('подтверждает удаление и блокирует запись без сети', async () => {
  const calls = mockApi({
    [`GET /api/studies/${id}`]: json(200, study),
    [`GET /api/studies/${id}/files`]: json(200, []),
    [`DELETE /api/studies/${id}`]: () => new Response(null, { status: 204 }),
    'GET /api/studies': json(200, []),
  })
  await renderApp(`/studies/${id}`, anna)
  await userEvent.click(await screen.findByRole('button', { name: 'Удалить' }))
  expect(callsTo(calls, `DELETE /api/studies/${id}`)).toHaveLength(0)
  offlineState.setOnline(false)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Удалить' })).toBeDisabled())
  offlineState.setOnline(true)
  await userEvent.click(screen.getByRole('button', { name: 'Удалить' }))
  expect(await screen.findByText('Исследований пока нет')).toBeInTheDocument()
  expect(callsTo(calls, `DELETE /api/studies/${id}`)).toHaveLength(1)
})

it('ошибка открытия удалённого исследования не запускает повторы', async () => {
  const calls = mockApi({ [`GET /api/studies/${id}`]: json(404, { detail: 'not_found' }) })
  await renderApp(`/studies/${id}`, anna)
  expect(await screen.findByText('Не удалось загрузить исследования')).toBeInTheDocument()
  expect(callsTo(calls, `GET /api/studies/${id}`)).toHaveLength(1)
})
