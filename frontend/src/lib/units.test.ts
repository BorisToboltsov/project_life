import { describe, expect, it } from 'vitest'

import { measurement } from '@/test/fixtures'

import {
  cmToFeetInches,
  displayUnit,
  feetInchesToCm,
  fromCanonical,
  measuredIn,
  toCanonical,
} from './units'

describe('единицы профиля', () => {
  it('метрическая система — килограммы и сантиметры, имперская — фунты и дюймы', () => {
    expect([displayUnit('mass', 'metric'), displayUnit('length', 'metric')]).toEqual(['kg', 'cm'])
    expect([displayUnit('mass', 'imperial'), displayUnit('length', 'imperial')]).toEqual([
      'lb',
      'in',
    ])
  })
})

describe('пересчёт', () => {
  it.each([
    [165.4, 'lb', 75.024],
    [34.5, 'in', 87.63],
    [72.4, 'kg', 72.4],
  ] as const)('%s %s → %s в канонической единице', (value, unit, canonical) => {
    expect(toCanonical(value, unit)).toBe(canonical)
  })

  it.each([
    [75.024, 'lb', 165.4],
    [87.63, 'in', 34.5],
    [72.4, 'kg', 72.4],
  ] as const)('%s → %s: %s с точностью до десятой', (canonical, unit, value) => {
    expect(fromCanonical(canonical, unit)).toBe(value)
  })
})

describe('measuredIn', () => {
  const inPounds = measurement('2026-10-05', 75.024, { original_value: 165.4, original_unit: 'lb' })

  it('в единице ввода возвращает ровно введённое число', () => {
    expect(measuredIn(inPounds, 'lb')).toBe(165.4)
  })

  it('в другой единице пересчитывает каноническое значение', () => {
    expect(measuredIn(inPounds, 'kg')).toBe(75)
  })
})

describe('пересчёт роста', () => {
  it.each([
    [152.4, { feet: 5, inches: 0 }],
    [168.5, { feet: 5, inches: 6 }],
    [180, { feet: 5, inches: 11 }],
    [182, { feet: 6, inches: 0 }],
  ])('%s см → футы и дюймы', (cm, expected) => {
    expect(cmToFeetInches(cm)).toEqual(expected)
  })

  it('не выдаёт 12 дюймов: округление переносится в футы', () => {
    expect(cmToFeetInches(182.6)).toEqual({ feet: 6, inches: 0 })
  })

  it.each([
    [{ feet: 5, inches: 0 }, 152.4],
    [{ feet: 5, inches: 6 }, 167.6],
    [{ feet: 6, inches: 2 }, 188],
  ])('%o → сантиметры с точностью до миллиметра', (height, cm) => {
    expect(feetInchesToCm(height)).toBe(cm)
  })
})
