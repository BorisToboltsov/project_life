import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { session } from '@/auth/session'
import { callsTo, json, mockApi } from '@/test/api'
import { renderApp } from '@/test/app'
import { anna, boris, sessionOf } from '@/test/fixtures'

describe('защита маршрутов', () => {
  it('гостя с любого адреса отправляет на вход', async () => {
    await renderApp('/profile')

    expect(await screen.findByRole('heading', { name: 'Вход' })).toBeInTheDocument()
  })

  it('вошедшего уводит с экрана входа на главную', async () => {
    await renderApp('/login', anna)

    expect(await screen.findByRole('heading', { name: 'Здравствуйте, Анна!' })).toBeInTheDocument()
  })

  it('обычного пользователя не пускает в управление и не показывает его в меню', async () => {
    await renderApp('/admin', anna)

    expect(await screen.findByRole('heading', { name: 'Здравствуйте, Анна!' })).toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: 'Разделы' })
    expect(
      within(nav)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Главная', 'Профиль'])
  })

  it('администратору показывает управление', async () => {
    mockApi({ 'GET /api/admin/invites': json(200, []), 'GET /api/admin/users': json(200, []) })

    await renderApp('/admin', boris)

    expect(await screen.findByRole('heading', { name: 'Управление' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Управление' })).toHaveAttribute('aria-current', 'page')
  })

  it('с несуществующего адреса возвращает на главную', async () => {
    await renderApp('/no/such/page', anna)

    expect(await screen.findByRole('heading', { name: 'Здравствуйте, Анна!' })).toBeInTheDocument()
  })

  it('переходит между разделами по меню', async () => {
    mockApi({ 'GET /api/health': json(200, { status: 'ok', version: '0.1.0' }) })
    await renderApp('/', anna)

    await userEvent.click(await screen.findByRole('link', { name: 'Профиль' }))

    expect(await screen.findByRole('heading', { name: 'Профиль' })).toBeInTheDocument()
    expect(await screen.findByText('Версия 0.1.0')).toBeInTheDocument()
  })
})

describe('кэш запросов', () => {
  it('очищается при выходе: следующий пользователь устройства не увидит чужих данных', async () => {
    const calls = mockApi({
      'GET /api/admin/invites': json(200, []),
      'GET /api/admin/users': json(200, [{ ...boris, created_at: '2026-10-01T10:00:00Z' }]),
      'POST /api/auth/logout': json(204),
    })
    const { queryClient } = await renderApp('/admin', boris)
    await screen.findByText(/Администратор/)
    expect(queryClient.getQueryData(['admin', 'users'])).toBeDefined()

    await session.logout()

    expect(await screen.findByRole('heading', { name: 'Вход' })).toBeInTheDocument()
    await waitFor(() => expect(queryClient.getQueryCache().getAll()).toEqual([]))
    // Экраны прежнего пользователя не успели перезапросить данные уже без прав.
    expect(callsTo(calls, 'GET /api/admin/users')).toHaveLength(1)
  })

  it('вход гостя не сбрасывает запросы экрана, с которого он входит', async () => {
    window.location.hash = '#invite-token'
    const calls = mockApi({
      'POST /api/auth/invite/check': json(200, {
        role: 'user',
        expires_at: '2026-10-12T10:00:00Z',
      }),
    })
    await renderApp('/invite')
    await screen.findByRole('heading', { name: 'Регистрация по приглашению' })

    session.open(sessionOf(anna))

    expect(await screen.findByRole('heading', { name: 'Здравствуйте, Анна!' })).toBeInTheDocument()
    expect(callsTo(calls, 'POST /api/auth/invite/check')).toHaveLength(1)
  })

  it('переживает обновление профиля того же пользователя', async () => {
    mockApi({ 'GET /api/health': json(200, { status: 'ok', version: '0.1.0' }) })
    const { queryClient } = await renderApp('/profile', anna)
    await screen.findByText('Версия 0.1.0')

    session.updateUser({ ...anna, display_name: 'Аня' })

    expect(queryClient.getQueryData(['health'])).toBeDefined()
  })
})

describe('нет связи с сервером', () => {
  it('показывает экран с повтором и восстанавливает сессию, когда сервер вернулся', async () => {
    localStorage.setItem('life.session', '1')
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    )
    await renderApp('/')
    expect(await screen.findByRole('heading', { name: 'Нет связи с сервером' })).toBeInTheDocument()

    mockApi({ 'POST /api/auth/refresh': json(200, sessionOf(anna)) })
    await userEvent.click(screen.getByRole('button', { name: 'Повторить' }))

    expect(await screen.findByRole('heading', { name: 'Здравствуйте, Анна!' })).toBeInTheDocument()
  })
})
