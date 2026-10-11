import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { User } from '@/auth/session'
import { json, mockApi } from '@/test/api'
import { renderApp } from '@/test/app'
import { anna, metricTypes } from '@/test/fixtures'

/** Открывает историю веса, которая падает при отрисовке: сервер ответил не списком. */
async function openCrashedScreen(user: User = anna) {
  // О сбое в консоль пишут и сбор ошибок, и роутер — в выводе теста это шум.
  const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  mockApi({
    'GET /api/metric-types': json(200, metricTypes),
    'GET /api/measurements': json(200, { unexpected: 'weight 72.4' }),
    'POST /api/errors': json(204),
  })
  await renderApp('/measurements/weight', user)
  return { crash: await screen.findByRole('alert'), logged }
}

describe('экран сбоя', () => {
  it('вместо упавшего экрана — заголовок, пояснение и кнопка «Обновить»', async () => {
    const { crash } = await openCrashedScreen()

    expect(
      within(crash).getByRole('heading', { name: 'Не удалось показать экран' }),
    ).toBeInTheDocument()
    expect(
      within(crash).getByText('Обновите страницу. Если сбой повторится, сообщите администратору.'),
    ).toBeInTheDocument()
    expect(within(crash).getByRole('button', { name: 'Обновить' })).toBeInTheDocument()
  })

  it('текст исключения пользователю не показывается', async () => {
    const { logged } = await openCrashedScreen()

    const error = logged.mock.calls.flat().find((value) => value instanceof Error)
    expect(error?.message).toBeTruthy()
    expect(document.body).not.toHaveTextContent(error!.message)
    // Встроенный экран роутера — с непереведённой строкой и кнопкой показа ошибки.
    expect(screen.queryByText('Something went wrong!')).not.toBeInTheDocument()
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual(['Обновить'])
  })

  it('переведён: у пользователя с английским языком экран сбоя английский', async () => {
    const { crash } = await openCrashedScreen({ ...anna, language: 'en' })

    expect(
      within(crash).getByRole('heading', { name: 'This screen could not be shown' }),
    ).toBeInTheDocument()
    expect(
      within(crash).getByText('Reload the page. If it happens again, tell the administrator.'),
    ).toBeInTheDocument()
    expect(within(crash).getByRole('button', { name: 'Reload' })).toBeInTheDocument()
  })

  it('разделы остаются на месте: с экрана сбоя можно уйти в другой раздел', async () => {
    await openCrashedScreen()

    await userEvent.click(screen.getByRole('link', { name: 'Профиль' }))

    expect(await screen.findByRole('heading', { name: 'Профиль' })).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'Не удалось показать экран' }),
    ).not.toBeInTheDocument()
  })

  it('«Обновить» перезагружает страницу', async () => {
    const { crash } = await openCrashedScreen()
    const reload = vi.fn<() => void>()
    vi.stubGlobal('location', { ...window.location, reload })

    await userEvent.click(within(crash).getByRole('button', { name: 'Обновить' }))

    expect(reload).toHaveBeenCalledOnce()
  })
})
