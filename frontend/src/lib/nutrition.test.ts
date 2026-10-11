import { describe, expect, it } from 'vitest'

import {
  ACTIVITIES,
  ageOn,
  AIMS,
  formatGrams,
  formatKcal,
  kcalFromMacros,
  kcalIsTyped,
  macrosEnergy,
  share,
  suggestTargets,
} from './nutrition'

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

describe('калории по БЖУ', () => {
  const cheese = { protein: '17,2', fat: '5', carbs: '1.8' }

  it('грамм белков и углеводов — 4 ккал, жиров — 9', () => {
    expect(macrosEnergy({ protein: '130', fat: '70', carbs: '230' })).toBe(2070)
    expect(macrosEnergy({ protein: '1', fat: '', carbs: '' })).toBe(4)
    expect(macrosEnergy({ protein: '', fat: '1', carbs: 'много' })).toBe(9)
    expect(macrosEnergy({ protein: '', fat: '', carbs: '' })).toBe(0)
  })

  it('поле калорий заполняется, когда набраны все три, с нужной точностью', () => {
    expect(kcalFromMacros(cheese, 1)).toBe('121')
    expect(kcalFromMacros({ protein: '12,3', fat: '6,2', carbs: '61,8' }, 1)).toBe('352.2')
    expect(kcalFromMacros({ protein: '12,3', fat: '6,2', carbs: '61,8' }, 0)).toBe('352')
    expect(kcalFromMacros({ protein: '0', fat: '0', carbs: '0' }, 1)).toBe('0')
  })

  it.each([
    [{ ...cheese, carbs: '' }],
    [{ ...cheese, fat: 'пять' }],
    [{ ...cheese, protein: ',' }],
    [{ protein: '', fat: '', carbs: '' }],
  ])('пока БЖУ не набраны, считать не из чего: %o', (texts) => {
    expect(kcalFromMacros(texts, 1)).toBe('')
  })

  it('число, у которого ещё набирают дробную часть, уже считается', () => {
    expect(kcalFromMacros({ ...cheese, fat: '5,' }, 1)).toBe('121')
    expect(kcalFromMacros({ ...cheese, fat: '5.' }, 1)).toBe('121')
    expect(macrosEnergy({ protein: '17,', fat: '', carbs: '' })).toBe(68)
  })

  it('калории введены руками, если расходятся с расчётом', () => {
    expect(kcalIsTyped({ ...cheese, kcal: '121' }, 1)).toBe(false)
    expect(kcalIsTyped({ ...cheese, kcal: '' }, 1)).toBe(false)
    expect(kcalIsTyped({ ...cheese, kcal: '145,5' }, 1)).toBe(true)
    // Калории без БЖУ считать было не из чего — значит, их ввели.
    expect(kcalIsTyped({ protein: '', fat: '', carbs: '', kcal: '2000' }, 0)).toBe(true)
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

    // Углеводы — остаток, округлённый вниз: 1050 ккал — это 262,5 г.
    expect(targets).toEqual({ kcal: 2100, protein_g: 105, fat_g: 70, carbs_g: 262 })
  })

  it('белки, жиры и углеводы подсказки всегда помещаются в её калории', () => {
    for (let weightKg = 40; weightKg <= 150; weightKg += 1) {
      for (const activity of ACTIVITIES) {
        for (const aim of AIMS) {
          const targets = suggestTargets({ ...man, weightKg }, activity, aim)
          const kcal = targets.protein_g * 4 + targets.fat_g * 9 + targets.carbs_g * 4

          expect(kcal, `${weightKg} кг, ${activity}, ${aim}`).toBeLessThanOrEqual(targets.kcal)
          expect(targets.kcal - kcal).toBeLessThan(4)
        }
      }
    }
  })
})
