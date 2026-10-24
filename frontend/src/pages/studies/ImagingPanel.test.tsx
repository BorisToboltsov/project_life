import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'
import { json, mockApi, callsTo } from '@/test/api'
import { renderApp } from '@/test/app'
import { anna } from '@/test/fixtures'
import { offlineState } from '@/offline/store'
import { archiveHash } from './archiveHash'

const id = '019a0000-0000-7000-8000-000000000013'
const importId = '019a0000-0000-7000-8000-000000000014'
const base = {
  [`GET /api/studies/${id}`]: json(200, {
    id,
    title: 'CT',
    local_date: '2026-10-22',
    institution: null,
    note: null,
  }),
  [`GET /api/studies/${id}/files`]: json(200, []),
}
const item = {
  id: importId,
  name: 'CT.zip',
  size: 100,
  sha256: 'a'.repeat(64),
  state: 'awaiting_confirmation',
  failure: null,
  skipped: 2,
  selection: null,
  candidates: [
    {
      uid: '1.2.3',
      description: 'CT chest',
      patients: ['TEST'],
      modalities: ['CT'],
      series: 1,
      frames: 50,
      warnings: ['fallback_order'],
    },
  ],
}
it('requires explicit selection and preserves client ids on retry', async () => {
  const calls = mockApi({
    ...base,
    [`GET /api/studies/${id}/imports`]: json(200, [item]),
    [`POST /api/imaging-imports/${importId}/confirm`]: json(503, {
      detail: 'file_storage_unavailable',
    }),
  })
  await renderApp(`/studies/${id}`, anna)
  const button = await screen.findByRole('button', { name: 'Импортировать выбранное' })
  expect(button).toBeDisabled()
  expect(screen.getByText(/Геометрии недостаточно/)).toBeInTheDocument()
  expect(screen.getByText('Пропущено файлов: 2')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('checkbox'))
  await userEvent.click(button)
  await waitFor(() => expect(button).toBeEnabled())
  await userEvent.click(button)
  const requests = callsTo(calls, `POST /api/imaging-imports/${importId}/confirm`)
  expect(requests).toHaveLength(2)
  expect(requests[0].body).toEqual({ studies: { '1.2.3': id } })
  expect(requests[1].body).toEqual(requests[0].body)
})
it('disables ZIP and confirmation offline', async () => {
  mockApi({ ...base, [`GET /api/studies/${id}/imports`]: json(200, [item]) })
  await renderApp(`/studies/${id}`, anna)
  await screen.findByRole('checkbox')
  offlineState.setOnline(false)
  await waitFor(() => expect(screen.getByRole('checkbox')).toBeDisabled())
  expect(screen.getByLabelText('Выбрать ZIP или продолжить загрузку того же файла')).toBeDisabled()
})
it('shows archive list errors and requires confirmation to remove', async () => {
  const calls = mockApi({
    ...base,
    [`GET /api/studies/${id}/imports`]: json(200, [{ ...item, state: 'uploading' }]),
    [`DELETE /api/imaging-imports/${importId}`]: () => new Response(null, { status: 204 }),
  })
  await renderApp(`/studies/${id}`, anna)
  await userEvent.click(await screen.findByRole('button', { name: 'Удалить загрузку' }))
  expect(callsTo(calls, `DELETE /api/imaging-imports/${importId}`)).toHaveLength(0)
  await userEvent.click(screen.getByRole('button', { name: 'Удалить загрузку' }))
  expect(callsTo(calls, `DELETE /api/imaging-imports/${importId}`)).toHaveLength(1)
})
it('hashes chunks and stops on cancellation', async () => {
  const bytes = new TextEncoder().encode('abc')
  const blob = {
    size: bytes.length,
    slice: (start: number, end: number) => ({
      arrayBuffer: async () => bytes.slice(start, end).buffer,
    }),
  } as Blob
  expect(await archiveHash(blob, new AbortController().signal)).toBe(
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  )
  const controller = new AbortController()
  controller.abort()
  await expect(archiveHash(blob, controller.signal)).rejects.toThrow(/abort/i)
})
