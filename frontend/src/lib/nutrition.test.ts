import { describe, expect, it } from 'vitest'

import { ageOn, formatGrams, formatKcal, share, suggestTargets } from './nutrition'

describe('запись чисел', () => {
  it('калории — целыми, граммы — до десятой, в записи языка', () => {
    expect(formatKcal(1240.6, 'ru')).toBe('1\u00a0241')
    expect(formatKcal(1240.6, 'en')).toBe('1,241')
    expect(formatGrams(67.58, 'ru')).toBe('67,6')
    expect(formatGrams(70, 'en')).toBe('70')
  })
})

describe('share', () => {
  it('доля цели не выходит за шкалу', () => {
    expect(share(1050, 2100)).toBe(0.5)
    expect(share(2500, 2100)).toBe(1)
    expect(share(100, 0)).toBe(0)
  })
})

describe('ageOn', () => {
  it('считает полные годы', () => {
    expect(ageOn('1990-05-17', '2026-05-16')).toBe(35)
    expect(ageOn('1990-05-17', '2026-05-17')).toBe(36)
    expect(ageOn('1990-05-17', '2026-10-11')).toBe(36)
  })
})

describe('suggestTargets', () => {
  const man = { sex: 'male', age: 36, heightCm: 180, weightKg: 80 } as const
  const woman = { sex: 'female', age: 30, heightCm: 165, weightKg: 60 } as const

  it('основной обмен — по формуле Миффлина — Сан-Жеора, с поправкой на образ жизни', () => {
    // 10·80 + 6,25·180 − 5·36 + 5 = 1750; × 1,2 = 2100.
    expect(suggestTargets(man, 'sedentary', 'maintain').kcal).toBe(2100)
    // 10·60 + 6,25·165 − 5·30 − 161 = 1320,25; × 1,55 ≈ 2046 → до десятков.
    expect(suggestTargets(woman, 'moderate', 'maintain').kcal).toBe(2050)
  })

  it('снижение веса — дефицит 15 %, набор — профицит 10 %', () => {
    expect(suggestTargets(man, 'sedentary', 'lose').kcal).toBe(1790)
    expect(suggestTargets(man, 'sedentary', 'gain').kcal).toBe(2310)
  })

  it('делит калории на белки, жиры и углеводы как 20 / 30 / 50', () => {
    const targets = suggestTargets(man, 'sedentary', 'maintain')

    expect(targets).toEqual({ kcal: 2100, protein_g: 105, fat_g: 70, carbs_g: 263 })
    // Углеводы — остаток, так что сумма сходится с калориями до округления грамма.
    const kcal = targets.protein_g * 4 + targets.fat_g * 9 + targets.carbs_g * 4
    expect(Math.abs(kcal - targets.kcal)).toBeLessThanOrEqual(2)
  })
})
