import { describe, expect, it, vi } from 'vitest'

import { api } from '@/api/client'
import i18n from '@/i18n'
import { callsTo, json, mockApi } from '@/test/api'
import { anna, sessionOf } from '@/test/fixtures'

import { session } from './session'

const REFRESH = 'POST /api/auth/refresh'

describe('старт приложения', () => {
  it('гостя не беспокоит запросами', async () => {
    const calls = mockApi({})

    await session.bootstrap()

    expect(session.getState().status).toBe('anonymous')
    expect(calls).toEqual([])
  })

  it('восстанавливает сессию по cookie, если на устройстве входили', async () => {
    localStorage.setItem('life.session', '1')
    mockApi({ [REFRESH]: json(200, sessionOf({ ...anna, language: 'en' })) })

    await session.bootstrap()

    expect(session.getState()).toEqual({
      status: 'authenticated',
      user: { ...anna, language: 'en' },
    })
    expect(i18n.language).toBe('en')
  })

  it('истёкшая сессия — гость, отметка о входе снимается', async () => {
    localStorage.setItem('life.session', '1')
    mockApi({ [REFRESH]: json(401, { detail: 'not_authenticated' }) })

    await session.bootstrap()

    expect(session.getState().status).toBe('anonymous')
    expect(localStorage.getItem('life.session')).toBeNull()
  })

  it.each([
    ['сеть недоступна', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['сервер отвечает ошибкой', () => Promise.resolve(new Response(null, { status: 502 }))],
  ])('%s — экран «нет связи», отметка о входе остаётся', async (_name, respond) => {
    localStorage.setItem('life.session', '1')
    vi.stubGlobal('fetch', vi.fn(respond))

    await session.bootstrap()

    expect(session.getState().status).toBe('offline')
    expect(localStorage.getItem('life.session')).toBe('1')
  })
})

describe('выход', () => {
  it('закрывает сессию, даже если сервер не ответил', async () => {
    session.open(sessionOf(anna))
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    )

    await expect(session.logout()).rejects.toThrow('Failed to fetch')

    expect(session.getState().status).toBe('anonymous')
    expect(localStorage.getItem('life.session')).toBeNull()
  })

  it('«выйти везде» обращается к своему эндпоинту с токеном', async () => {
    session.open(sessionOf(anna, 'token-42'))
    const calls = mockApi({ 'POST /api/auth/logout-all': json(204) })

    await session.logoutEverywhere()

    expect(calls[0].authorization).toBe('Bearer token-42')
    expect(session.getState().status).toBe('anonymous')
  })

  it('выход в другой вкладке закрывает сессию и здесь', () => {
    session.open(sessionOf(anna))

    window.dispatchEvent(new StorageEvent('storage', { key: 'life.session', newValue: null }))

    expect(session.getState().status).toBe('anonymous')
  })
})

describe('запросы с истёкшим access-токеном', () => {
  it('обновляют токен и повторяются сами', async () => {
    session.open(sessionOf(anna, 'expired'))
    const calls = mockApi({
      'GET /api/me': (call) =>
        call.authorization === 'Bearer fresh'
          ? json(200, anna)(call)
          : json(401, { detail: 'not_authenticated' })(call),
      [REFRESH]: json(200, sessionOf(anna, 'fresh')),
    })

    const { data } = await api.GET('/api/me')

    expect(data).toEqual(anna)
    expect(calls.map((call) => `${call.method} ${call.path} ${call.authorization}`)).toEqual([
      'GET /api/me Bearer expired',
      'POST /api/auth/refresh Bearer expired',
      'GET /api/me Bearer fresh',
    ])
  })

  it('повторяют запрос с тем же телом', async () => {
    session.open(sessionOf(anna, 'expired'))
    const calls = mockApi({
      'PATCH /api/me': (call) =>
        call.authorization === 'Bearer fresh'
          ? json(200, anna)(call)
          : json(401, { detail: 'not_authenticated' })(call),
      [REFRESH]: json(200, sessionOf(anna, 'fresh')),
    })

    await api.PATCH('/api/me', { body: { display_name: 'Аня' } })

    expect(callsTo(calls, 'PATCH /api/me').map((call) => call.body)).toEqual([
      { display_name: 'Аня' },
      { display_name: 'Аня' },
    ])
  })

  it('параллельные запросы ждут одно общее обновление', async () => {
    session.open(sessionOf(anna, 'expired'))
    const calls = mockApi({
      'GET /api/me': (call) =>
        call.authorization === 'Bearer fresh'
          ? json(200, anna)(call)
          : json(401, { detail: 'not_authenticated' })(call),
      [REFRESH]: json(200, sessionOf(anna, 'fresh')),
    })

    const results = await Promise.all([api.GET('/api/me'), api.GET('/api/me'), api.GET('/api/me')])

    expect(results.every((result) => result.data)).toBe(true)
    expect(callsTo(calls, REFRESH)).toHaveLength(1)
  })

  it('если обновить не удалось — отдают исходный отказ и закрывают сессию', async () => {
    session.open(sessionOf(anna, 'expired'))
    mockApi({
      'GET /api/me': json(401, { detail: 'not_authenticated' }),
      [REFRESH]: json(401, { detail: 'not_authenticated' }),
    })

    const { error, response } = await api.GET('/api/me')

    expect(response.status).toBe(401)
    expect(error).toEqual({ detail: 'not_authenticated' })
    expect(session.getState().status).toBe('anonymous')
  })

  it('отказ эндпоинта авторизации не запускает обновление', async () => {
    const calls = mockApi({ 'POST /api/auth/login': json(401, { detail: 'invalid_credentials' }) })

    await api.POST('/api/auth/login', { body: { email: 'a@b.c', password: 'x' } })

    expect(callsTo(calls, REFRESH)).toEqual([])
  })
})
