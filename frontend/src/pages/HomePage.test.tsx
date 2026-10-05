import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n'
import { renderWithProviders } from '@/test/render'

import { HomePage } from './HomePage'

function respondWith(status: number, body?: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        new Response(body === undefined ? null : JSON.stringify(body), {
          status,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    ),
  )
}

describe('HomePage', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('ru')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('показывает версию сервера, когда он отвечает', async () => {
    respondWith(200, { status: 'ok', version: '1.2.3' })

    renderWithProviders(<HomePage />)

    expect(await screen.findByText('Сервер доступен, версия 1.2.3')).toBeInTheDocument()
  })

  it('сообщает, что сервер недоступен', async () => {
    respondWith(503)

    renderWithProviders(<HomePage />)

    expect(await screen.findByText('Сервер недоступен')).toBeInTheDocument()
  })

  it('переключает язык и запоминает выбор', async () => {
    respondWith(200, { status: 'ok', version: '1.2.3' })
    renderWithProviders(<HomePage />)

    await userEvent.click(screen.getByRole('button', { name: 'English' }))

    expect(await screen.findByText('Server is up, version 1.2.3')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'true')
    expect(document.documentElement.lang).toBe('en')
    expect(localStorage.getItem('life.language')).toBe('en')
  })
})
