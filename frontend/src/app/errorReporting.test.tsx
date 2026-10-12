import { screen, waitFor } from '@testing-library/react'
import { describe, expect, it, onTestFinished, vi } from 'vitest'

import { callsTo, json, mockApi } from '@/test/api'
import { renderApp } from '@/test/app'
import { anna, metricList, metrics } from '@/test/fixtures'

import { installErrorReporting } from './errorReporting'

const REPORT = 'POST /api/errors'
const ORIGIN = window.location.origin

/** Исключение со стеком, какой даёт собранное приложение в Chrome. */
function crash(name: string, message: string): Error {
  const error = new Error(message)
  error.name = name
  error.stack = [
    `${name}: ${message}`,
    `    at save (${ORIGIN}/assets/index-B3x9.js:45:12345)`,
    `    at ${ORIGIN}/assets/index-B3x9.js:45:999`,
  ].join('\n')
  return error
}

function raise(error: unknown): void {
  window.dispatchEvent(new ErrorEvent('error', { error }))
}

function reject(reason: unknown): void {
  window.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason }))
}

/** Даёт уйти отправленным запросам, чтобы убедиться, что лишних среди них нет. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 20))
}

async function openHome() {
  const calls = mockApi({ [REPORT]: json(204) })
  await renderApp('/', anna)
  await screen.findByRole('heading', { name: 'Здравствуйте, Анна!' })
  return calls
}

describe('сбор ошибок', () => {
  it('сбой при отрисовке экрана уходит отчётом с шаблоном маршрута', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const calls = mockApi({
      'GET /api/metrics': json(200, metricList()),
      // Сервер ответил не списком — экран истории на этом падает.
      'GET /api/measurements': json(200, { unexpected: 'weight 72.4' }),
      [REPORT]: json(204),
    })

    await renderApp(`/measurements/${metrics.weight.id}`, anna)

    await waitFor(() => expect(callsTo(calls, REPORT)).toHaveLength(1))
    const [report] = callsTo(calls, REPORT)
    expect(report.body).toEqual({
      kind: 'TypeError',
      route: '/measurements/$metric',
      frames: [],
      version: expect.stringMatching(/^\d+\.\d+\.\d+$/),
    })
    expect(report.authorization).toBe('Bearer access-1')
  })

  it('сбой в обработчике события уходит без текста ошибки; повтор не отправляется', async () => {
    const calls = await openHome()
    const error = crash('RangeError', 'weight 72.4 of anna@example.com is out of range')

    raise(error)
    raise(error)

    await waitFor(() => expect(callsTo(calls, REPORT)).toHaveLength(1))
    await settle()
    expect(callsTo(calls, REPORT)).toHaveLength(1)
    expect(callsTo(calls, REPORT)[0].body).toEqual({
      kind: 'RangeError',
      route: '/',
      frames: [
        { file: 'assets/index-B3x9.js', line: 45, column: 12345, function: 'save' },
        { file: 'assets/index-B3x9.js', line: 45, column: 999, function: '' },
      ],
      version: expect.any(String),
    })
  })

  it('отклонённый промис уходит отчётом, даже если отклонён не исключением', async () => {
    const calls = await openHome()

    reject('weight 72.4 was not saved')

    await waitFor(() => expect(callsTo(calls, REPORT)).toHaveLength(1))
    expect(callsTo(calls, REPORT)[0].body).toMatchObject({ kind: 'NonError', frames: [] })
  })

  it('имя исключения, не похожее на имя типа, заменяется общим', async () => {
    const calls = await openHome()

    raise(crash('weight 72.4 is wrong', 'boom'))

    await waitFor(() => expect(callsTo(calls, REPORT)).toHaveLength(1))
    expect(callsTo(calls, REPORT)[0].body).toMatchObject({ kind: 'Error' })
  })

  it('от гостя отчёты не уходят', async () => {
    const calls = mockApi({ [REPORT]: json(204) })
    await renderApp('/login')
    await screen.findByRole('heading', { name: 'Вход' })

    raise(crash('TypeError', 'boom'))
    await settle()

    expect(calls).toEqual([])
  })

  it('сбой чужого скрипта, о котором браузер ничего не сообщает, пропускается', async () => {
    const calls = await openHome()

    raise(null)
    await settle()

    expect(callsTo(calls, REPORT)).toEqual([])
  })

  it('за одно открытие приложения уходит не больше десяти разных ошибок', async () => {
    const calls = await openHome()

    for (let index = 0; index < 12; index++) raise(crash(`Error${index}`, 'boom'))

    await waitFor(() => expect(callsTo(calls, REPORT)).toHaveLength(10))
    await settle()
    expect(callsTo(calls, REPORT)).toHaveLength(10)
  })

  it('неудачная отправка отчёта не порождает новых ошибок', async () => {
    const calls = mockApi({
      [REPORT]: () => {
        throw new TypeError('Failed to fetch')
      },
    })
    await renderApp('/', anna)
    await screen.findByRole('heading', { name: 'Здравствуйте, Анна!' })

    raise(crash('TypeError', 'boom'))
    await settle()

    expect(callsTo(calls, REPORT)).toHaveLength(1)
  })

  it('адрес, не похожий на шаблон маршрута, в отчёт не попадает', async () => {
    const calls = await openHome()
    // Второй сборщик смотрит на роутер, у которого вместо шаблона — адрес с числом.
    onTestFinished(
      installErrorReporting({ state: { matches: [{ fullPath: '/measurements/2026' }] } }),
    )

    raise(crash('TypeError', 'boom'))

    await waitFor(() => expect(callsTo(calls, REPORT)).toHaveLength(2))
    expect(callsTo(calls, REPORT).map((call) => (call.body as { route: unknown }).route)).toEqual([
      '/',
      null,
    ])
  })

  it('после отключения сбои не собираются', async () => {
    const calls = await openHome()
    const uninstall = installErrorReporting({ state: { matches: [] } })
    uninstall()

    raise(crash('TypeError', 'boom'))
    await settle()

    // Отчёт один — от самого приложения; отключённый сборщик промолчал.
    expect(callsTo(calls, REPORT)).toHaveLength(1)
  })
})
