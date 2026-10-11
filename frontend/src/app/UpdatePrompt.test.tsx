import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { renderApp } from '@/test/app'
import { anna } from '@/test/fixtures'

import { appUpdate, watchForUpdates } from './appUpdate'

describe('новая версия приложения', () => {
  it('пока её нет, приложение о ней молчит', async () => {
    await renderApp('/', anna)

    expect(await screen.findByRole('heading', { name: 'Здравствуйте, Анна!' })).toBeInTheDocument()
    expect(screen.queryByText('Доступна новая версия приложения.')).not.toBeInTheDocument()
  })

  it('предлагает обновиться и включает новую версию только по нажатию', async () => {
    const reload = vi.fn<() => void>()
    await renderApp('/', anna)
    await screen.findByRole('heading', { name: 'Здравствуйте, Анна!' })

    act(() => appUpdate.offer(reload))

    expect(screen.getByText('Доступна новая версия приложения.')).toBeInTheDocument()
    // Экран под строкой остаётся рабочим: обновление ничего не прерывает.
    expect(screen.getByRole('heading', { name: 'Здравствуйте, Анна!' })).toBeInTheDocument()
    expect(reload).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Обновить' }))

    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('видна и до входа', async () => {
    await renderApp('/login')
    await screen.findByRole('heading', { name: 'Вход' })

    act(() => appUpdate.offer(vi.fn<() => void>()))

    expect(screen.getByRole('button', { name: 'Обновить' })).toBeInTheDocument()
  })
})

describe('проверка новой версии', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  function show(state: 'visible' | 'hidden') {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(state)
    document.dispatchEvent(new Event('visibilitychange'))
  }

  it('спрашивает сервер, когда приложение снова открыли, но не чаще раза в час', () => {
    vi.useFakeTimers()
    const update = vi.fn<() => Promise<unknown>>().mockResolvedValue(undefined)
    watchForUpdates({ update })

    // Только что запущено: service worker и так проверил версию.
    show('visible')
    expect(update).not.toHaveBeenCalled()

    vi.advanceTimersByTime(61 * 60 * 1000)
    show('hidden')
    expect(update).not.toHaveBeenCalled()
    show('visible')
    expect(update).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(10 * 60 * 1000)
    show('visible')
    expect(update).toHaveBeenCalledTimes(1)
  })

  it('без сети проверка молча откладывается', async () => {
    vi.useFakeTimers()
    const update = vi.fn<() => Promise<unknown>>().mockRejectedValue(new Error('offline'))
    watchForUpdates({ update })

    vi.advanceTimersByTime(61 * 60 * 1000)
    show('visible')

    await vi.runAllTimersAsync()
    expect(update).toHaveBeenCalledTimes(1)
  })
})
