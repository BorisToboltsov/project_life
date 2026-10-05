import { afterEach, describe, expect, it, vi } from 'vitest'

import { detectLanguage } from './index'

describe('detectLanguage', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('берёт сохранённый выбор', () => {
    localStorage.setItem('life.language', 'en')
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('ru-RU')

    expect(detectLanguage()).toBe('en')
  })

  it('игнорирует неизвестный сохранённый язык', () => {
    localStorage.setItem('life.language', 'de')
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('ru-RU')

    expect(detectLanguage()).toBe('ru')
  })

  it('для нерусского браузера выбирает английский', () => {
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('de-DE')

    expect(detectLanguage()).toBe('en')
  })

  it('работает, когда хранилище недоступно', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('ru')

    expect(detectLanguage()).toBe('ru')
  })
})
