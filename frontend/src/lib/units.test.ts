import { describe, expect, it } from 'vitest'

import { cmToFeetInches, feetInchesToCm } from './units'

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
