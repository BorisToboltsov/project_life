import { describe, expect, it } from 'vitest'

import { headline, rate, vo2max } from './fitness'

const man = { sex: 'male' as const, birth_date: '1990-05-17' }
const woman = { sex: 'female' as const, birth_date: '1990-05-17' }

function cooper(distance: number, date = '2026-10-18') {
  return {
    test: 'cooper' as const,
    local_date: date,
    distance_m: distance,
    reps: null,
    variant: null,
  }
}

function pushUps(reps: number, variant: 'classic' | 'knee', date = '2026-10-18') {
  return { test: 'push_ups' as const, local_date: date, distance_m: null, reps, variant }
}

describe('vo2max', () => {
  it('считается по формуле Купера', () => {
    expect(vo2max(2650)).toBeCloseTo(47.96, 2)
    expect(vo2max(504.9)).toBe(0)
  })
})

describe('оценка теста Купера', () => {
  it.each([
    [1400, 'poor', 0],
    [1500, 'below_average', 1],
    [1900, 'average', 2],
    [2300, 'above_average', 3],
    [2700, 'above_average', 3],
    [2701, 'excellent', 4],
  ])('мужчина 36 лет, %d м — %s', (distance, level, index) => {
    expect(rate(cooper(distance), man)).toEqual({
      rating: { scale: 'cooper', level, index, sex: 'male', ages: { from: 30, to: 39 } },
    })
  })

  it('берёт возраст на день теста, а не на сегодня', () => {
    // 17 мая 2020 года ему исполнилось 30: днём раньше — ещё строка 20–29.
    const before = rate(cooper(2300, '2020-05-16'), man)
    const after = rate(cooper(2300, '2020-05-17'), man)

    expect(before).toMatchObject({ rating: { level: 'average', ages: { from: 20, to: 29 } } })
    expect(after).toMatchObject({ rating: { level: 'above_average', ages: { from: 30 } } })
  })

  it('у женщин своя таблица', () => {
    expect(rate(cooper(2300), woman)).toMatchObject({ rating: { level: 'above_average' } })
    expect(rate(cooper(2300), man)).toMatchObject({ rating: { level: 'above_average' } })
    expect(rate(cooper(1950), woman)).toMatchObject({ rating: { level: 'average' } })
    expect(rate(cooper(1950), man)).toMatchObject({ rating: { level: 'average' } })
    expect(rate(cooper(1600), woman)).toMatchObject({ rating: { level: 'below_average' } })
  })

  it('с 50 лет — одна строка без верхней границы', () => {
    const old = { sex: 'male' as const, birth_date: '1940-01-01' }

    expect(rate(cooper(2000), old)).toMatchObject({ rating: { ages: { from: 50, to: null } } })
  })

  it('младше 20 лет — норм нет: строки для подростков в источниках расходятся', () => {
    const teen = { sex: 'female' as const, birth_date: '2008-01-01' }

    expect(rate(cooper(2000), teen)).toEqual({ missing: 'age' })
    expect(rate(pushUps(20, 'knee'), teen)).toEqual({ missing: 'age' })
  })
})

describe('оценка отжиманий', () => {
  it('у мужчин — по нормам для классических', () => {
    expect(rate(pushUps(36, 'classic'), { ...man, birth_date: '2000-01-01' })).toMatchObject({
      rating: { scale: 'cpafla', level: 'excellent', ages: { from: 20, to: 29 } },
    })
    expect(rate(pushUps(16, 'classic'), { ...man, birth_date: '2000-01-01' })).toMatchObject({
      rating: { level: 'needs_improvement', index: 0 },
    })
  })

  it('у женщин — по нормам для отжиманий с колен', () => {
    expect(rate(pushUps(20, 'knee'), woman)).toMatchObject({
      rating: { level: 'very_good', ages: { from: 30, to: 39 } },
    })
  })

  it.each([
    ['knee', man],
    ['classic', woman],
  ] as const)('вариант %s без своих норм — без оценки', (variant, profile) => {
    expect(rate(pushUps(20, variant), profile)).toEqual({ missing: 'variant' })
  })

  it('старше 69 лет — норм нет', () => {
    expect(rate(pushUps(10, 'classic'), { ...man, birth_date: '1950-01-01' })).toEqual({
      missing: 'age',
    })
  })
})

describe('без оценки', () => {
  it('подтягивания норм не имеют', () => {
    const pullUps = {
      test: 'pull_ups' as const,
      local_date: '2026-10-18',
      distance_m: null,
      reps: 11,
      variant: null,
    }

    expect(rate(pullUps, man)).toEqual({ missing: 'none' })
  })

  it.each([
    { sex: null, birth_date: '1990-05-17' },
    { sex: 'male' as const, birth_date: null },
  ])('профиль без пола или даты рождения — %o', (profile) => {
    expect(rate(cooper(2650), profile)).toEqual({ missing: 'profile' })
  })
})

describe('главное число', () => {
  it('у Купера — VO2max, у остальных — повторы', () => {
    expect(headline(cooper(2650))).toBeCloseTo(47.96, 2)
    expect(headline(pushUps(38, 'classic'))).toBe(38)
  })
})
