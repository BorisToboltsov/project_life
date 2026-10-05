import { describe, expect, it } from 'vitest'

import { attempt, errorKey } from './errors'

describe('errorKey', () => {
  it('переводит код бэкенда в ключ словаря', () => {
    expect(errorKey({ detail: 'invalid_credentials' })).toBe('errors.invalid_credentials')
  })

  it('незнакомый ответ — общая ошибка', () => {
    expect(errorKey({ detail: 'brand_new_code' })).toBe('errors.unknown')
    expect(errorKey({ detail: [{ loc: ['body', 'email'], msg: 'invalid' }] })).toBe(
      'errors.unknown',
    )
    expect(errorKey(null)).toBe('errors.unknown')
  })

  it('запрос не дошёл — ошибка сети', () => {
    expect(errorKey(undefined)).toBe('errors.network')
  })
})

describe('attempt', () => {
  it('отдаёт данные успешного вызова', async () => {
    expect(await attempt(() => Promise.resolve({ data: { id: 1 } }))).toEqual({ data: { id: 1 } })
  })

  it('отказ сервера и сбой сети приводит к одному виду', async () => {
    const refused = await attempt(() => Promise.resolve({ error: { detail: 'forbidden' } }))
    const broken = await attempt(() => Promise.reject(new TypeError('Failed to fetch')))

    expect(refused).toEqual({ failure: 'errors.forbidden' })
    expect(broken).toEqual({ failure: 'errors.network' })
  })
})
