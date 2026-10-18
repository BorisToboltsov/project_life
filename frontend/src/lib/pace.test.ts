import { describe, expect, it } from 'vitest'

import { clockText, lowerIsFaster, paceLabel, paceValue } from './pace'

describe('темп', () => {
  it('на дорожке — время на километр или милю', () => {
    expect(paceValue(312, 'per_km', false)).toBe(312)
    expect(paceValue(312, 'per_km', true)).toBeCloseTo(502.1, 1)
    expect(paceLabel('per_km', false)).toBe('per_km')
    expect(paceLabel('per_km', true)).toBe('per_mi')
  })

  it('на велотренажёре и эллипсе — скорость', () => {
    expect(paceValue(150, 'speed', false)).toBe(24)
    expect(paceValue(150, 'speed', true)).toBeCloseTo(14.91, 2)
    expect(paceLabel('speed', true)).toBe('speed_mi')
    expect(lowerIsFaster('speed')).toBe(false)
  })

  it('на гребле — время на 500 м при любой системе единиц', () => {
    expect(paceValue(250, 'per_500m', true)).toBe(125)
    expect(paceLabel('per_500m', true)).toBe('per_500m')
    expect(lowerIsFaster('per_500m')).toBe(true)
  })

  it('секунды показываются часами', () => {
    expect(clockText(312)).toBe('5:12')
    expect(clockText(59.6)).toBe('1:00')
    expect(clockText(3725)).toBe('1:02:05')
  })
})
