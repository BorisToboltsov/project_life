import type { Viewer } from './viewerEngine'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { json, mockApi, callsTo } from '@/test/api'
import { renderApp } from '@/test/app'
import { anna } from '@/test/fixtures'
import { offlineState } from '@/offline/store'

const engine = vi.hoisted(() => ({
  show: vi.fn<Viewer['show']>(),
  window: vi.fn<Viewer['window']>(),
  zoom: vi.fn<Viewer['zoom']>(),
  pan: vi.fn<Viewer['pan']>(),
  reset: vi.fn<Viewer['reset']>(),
  destroy: vi.fn<Viewer['destroy']>(),
}))
vi.mock('./viewerEngine', () => ({ createViewer: () => engine }))
const id = '019a0000-0000-7000-8000-000000000013'
const display = { width: 400, center: 40, min: -1024, max: 3000, orientation: ['A', 'L', 'P', 'R'] }
const base = {
  [`GET /api/studies/${id}`]: json(200, {
    id,
    title: 'КТ груди',
    local_date: '2026-10-23',
    institution: null,
    note: null,
  }),
  [`GET /api/studies/${id}/viewer`]: json(200, {
    series: [
      { index: 0, description: 'Axial', frames: 3, geometric: true },
      { index: 1, description: 'Enhanced', frames: 2, geometric: false },
    ],
    warnings: ['fallback_order'],
  }),
  [`GET /api/studies/${id}/files`]: json(200, []),
  [`GET /api/studies/${id}/imports`]: json(200, []),
}
beforeEach(() => {
  for (const fn of Object.values(engine)) fn.mockReset()
  engine.show.mockResolvedValue(display)
})
it('opens a separate screen, changes frames/series and returns to the study', async () => {
  mockApi(base)
  await renderApp(`/studies/${id}/viewer`, anna)
  await screen.findByText('Ширина окна: 400')
  expect(screen.queryByRole('navigation', { name: 'Разделы' })).not.toBeInTheDocument()
  expect(screen.getByText(/Геометрии недостаточно/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Назад' })).toBeDisabled()
  await userEvent.click(screen.getByRole('button', { name: 'Вперёд' }))
  await waitFor(() => expect(engine.show).toHaveBeenLastCalledWith(id, 0, 1))
  expect(screen.getByText('Кадр 2 из 3')).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('Номер кадра'), { target: { value: '2' } })
  expect(screen.getByRole('button', { name: 'Вперёд' })).toBeDisabled()
  await userEvent.selectOptions(screen.getByRole('combobox'), '1')
  await waitFor(() => expect(engine.show).toHaveBeenLastCalledWith(id, 1, 0))
  expect(screen.getByText('Кадр 1 из 2')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('link', { name: 'К исследованию' }))
  await screen.findByLabelText('Название')
  expect(engine.destroy).toHaveBeenCalled()
})
it('applies window, zoom and reset without another pixel request', async () => {
  mockApi(base)
  await renderApp(`/studies/${id}/viewer`, anna)
  await screen.findByText('Ширина окна: 400')
  fireEvent.change(screen.getByLabelText('Ширина окна'), { target: { value: '800' } })
  await waitFor(() => expect(engine.window).toHaveBeenCalledWith({ ...display, width: 800 }))
  await userEvent.click(screen.getByRole('button', { name: 'Масштаб' }))
  fireEvent.change(screen.getByRole('slider', { name: 'Масштаб' }), { target: { value: '2' } })
  await waitFor(() => expect(engine.zoom).toHaveBeenCalledWith(2))
  await userEvent.click(screen.getByRole('button', { name: 'Сбросить' }))
  expect(engine.reset).toHaveBeenCalled()
  expect(engine.show).toHaveBeenCalledTimes(1)
  await userEvent.click(screen.getByRole('button', { name: 'Перемещение' }))
  expect(screen.getByText('Перемещайте снимок пальцем или мышью.')).toBeInTheDocument()
})
it('reports unsupported frames, retries and permits native streaming download', async () => {
  engine.show.mockRejectedValueOnce({ key: 'errors.imaging_unsupported' })
  const calls = mockApi({ ...base, [`POST /api/studies/${id}/original-download`]: json(204) })
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
  await renderApp(`/studies/${id}/viewer`, anna)
  expect(await screen.findByRole('alert')).toHaveTextContent('Этот кадр не поддерживается')
  await userEvent.click(screen.getByRole('button', { name: 'Повторить' }))
  await screen.findByText('Ширина окна: 400')
  await userEvent.click(screen.getByRole('button', { name: 'Скачать исходный ZIP' }))
  expect(callsTo(calls, `POST /api/studies/${id}/original-download`)).toHaveLength(1)
  expect(click).toHaveBeenCalledTimes(1)
  expect(click.mock.instances[0]).toHaveAttribute('href', `/api/studies/${id}/original`)
  click.mockRestore()
})
it('hides the frame while loading a replacement and ignores late results', async () => {
  let finish!: (value: typeof display) => void
  engine.show.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  mockApi(base)
  await renderApp(`/studies/${id}/viewer`, anna)
  await waitFor(() => expect(engine.show).toHaveBeenCalledTimes(1))
  await userEvent.click(screen.getByRole('button', { name: 'Вперёд' }))
  expect(screen.getByTestId('dicom-viewport')).not.toBeVisible()
  await screen.findByText('Ширина окна: 400')
  finish({ ...display, width: 999 })
  await waitFor(() => expect(screen.queryByText('Ширина окна: 999')).not.toBeInTheDocument())
  offlineState.setOnline(false)
  await waitFor(() => expect(screen.queryByTestId('dicom-viewport')).not.toBeInTheDocument())
  expect(engine.destroy).toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'Скачать исходный ZIP' })).toBeDisabled()
})
it('shows study errors and download failures', async () => {
  const calls = mockApi({
    ...base,
    [`POST /api/studies/${id}/original-download`]: json(503, {
      detail: 'file_storage_unavailable',
    }),
  })
  await renderApp(`/studies/${id}/viewer`, anna)
  await screen.findByText('Ширина окна: 400')
  await userEvent.click(screen.getByRole('button', { name: 'Скачать исходный ZIP' }))
  expect(await screen.findByRole('alert')).toBeVisible()
  expect(callsTo(calls, `GET /api/studies/${id}/original`)).toHaveLength(0)
})
