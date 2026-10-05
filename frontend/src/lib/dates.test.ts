import { describe, expect, it } from 'vitest'

import {
  displayToIso,
  formatDateInput,
  formatDateTime,
  isoToDayMonth,
  isoToDisplay,
  isoToLocalDate,
  isRealDate,
  localDateToIso,
  shiftDays,
  today,
} from './dates'

describe('formatDateTime', () => {
  it.each([
    ['ru', '12 окт. 2026 г., 13:00'],
    ['en', '12 Oct 2026, 13:00'],
  ])('%s: день перед месяцем, время в поясе пользователя', (language, expected) => {
    expect(formatDateTime('2026-10-12T10:00:00Z', language, 'Europe/Moscow')).toBe(expected)
  })

  it('учитывает часовой пояс: в Токио уже следующий день', () => {
    expect(formatDateTime('2026-10-12T20:00:00Z', 'ru', 'Asia/Tokyo')).toBe(
      '13 окт. 2026 г., 05:00',
    )
  })
})

describe('дата в поле ввода', () => {
  it('показывается как день/месяц/год', () => {
    expect(isoToDisplay('1990-05-07')).toBe('07/05/1990')
    expect(isoToDisplay('')).toBe('')
  })

  it('читается обратно в ГГГГ-ММ-ДД, в том числе без ведущих нулей', () => {
    expect(displayToIso('07/05/1990')).toBe('1990-05-07')
    expect(displayToIso('7/5/1990')).toBe('1990-05-07')
    expect(displayToIso('  ')).toBe('')
  })

  it.each(['17/0', '17/05', '17/05/90'])(
    'недописанная «%s» остаётся текстом и не выглядит датой',
    (text) => {
      expect(displayToIso(text)).toBe(text)
      expect(isRealDate(displayToIso(text))).toBe(false)
    },
  )
})

describe('formatDateInput', () => {
  it.each([
    ['1', '1'],
    ['17', '17'],
    ['170', '17/0'],
    ['1705', '17/05'],
    ['17051', '17/05/1'],
    ['17051990', '17/05/1990'],
    ['170519901', '17/05/1990'],
  ])('цифры подряд «%s» → «%s»', (typed, expected) => {
    expect(formatDateInput(typed)).toBe(expected)
  })

  it.each([
    ['17/', '17/'],
    ['17/05/', '17/05/'],
    ['1/5/1990', '1/5/1990'],
    ['17.05.1990', '17/05/1990'],
    ['17-05-1990', '17/05/1990'],
    ['17/051', '17/05/1'],
    ['17/05/1990/', '17/05/1990'],
    ['17/05/1990 г.', '17/05/1990'],
  ])('с разделителями «%s» → «%s»', (typed, expected) => {
    expect(formatDateInput(typed)).toBe(expected)
  })

  it('стирание по символу возвращает к пустому полю', () => {
    const steps = ['17/05/1', '17/05/', '17/05', '17/0', '17/', '17', '1', '']
    expect(steps.map(formatDateInput)).toEqual(steps)
  })

  it('буквы отбрасываются', () => {
    expect(formatDateInput('ab')).toBe('')
    expect(formatDateInput('1a7')).toBe('1/7')
    expect(formatDateInput('/5')).toBe('5')
  })
})

describe('isRealDate', () => {
  it.each(['1990-05-17', '2024-02-29', '2000-12-31', '0099-01-01'])('%s существует', (iso) => {
    expect(isRealDate(iso)).toBe(true)
  })

  it.each(['1990-02-31', '2023-02-29', '1990-13-01', '1990-00-10', '1990-05-00', '17/05/1990', ''])(
    '«%s» не существует',
    (iso) => {
      expect(isRealDate(iso)).toBe(false)
    },
  )
})

describe('дата для календаря', () => {
  it('переводится в местную полночь и обратно без сдвига на часовой пояс', () => {
    const date = isoToLocalDate('1990-05-17')

    expect(date).toEqual(new Date(1990, 4, 17))
    expect(localDateToIso(date!)).toBe('1990-05-17')
  })

  it('непонятная строка — нет даты', () => {
    expect(isoToLocalDate('17/05/1990')).toBeUndefined()
  })
})

describe('вспомогательные даты', () => {
  it('сегодня — местная дата устройства', () => {
    expect(today()).toBe(localDateToIso(new Date()))
  })

  it('подпись оси — день/месяц', () => {
    expect(isoToDayMonth('2026-10-05')).toBe('05/10')
  })

  it('сдвиг на дни переходит через границы месяца и года', () => {
    expect(shiftDays('2026-10-05', -30)).toBe('2026-09-05')
    expect(shiftDays('2026-01-01', -1)).toBe('2025-12-31')
    expect(shiftDays('2024-02-28', 2)).toBe('2024-03-01')
    expect(shiftDays('не дата', 5)).toBe('не дата')
  })
})
