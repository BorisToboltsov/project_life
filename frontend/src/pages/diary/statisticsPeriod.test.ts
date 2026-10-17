import { describe, expect, it } from 'vitest'

import { periodStart, shiftPeriod } from './statisticsPeriod'

describe('календарные периоды статистики', () => {
  it('неделя начинается в понедельник, включая переход года', () => {
    expect(periodStart('2025-01-01', 'week')).toBe('2024-12-30')
    expect(periodStart('2024-02-11', 'week')).toBe('2024-02-05')
    expect(shiftPeriod('2025-01-01', 'week', 1)).toBe('2025-01-06')
  })
  it('листание месяца с 31 числа не пропускает февраль', () => {
    expect(shiftPeriod('2024-01-31', 'month', 1)).toBe('2024-02-01')
    expect(shiftPeriod('2024-03-31', 'month', -1)).toBe('2024-02-01')
    expect(shiftPeriod('2024-12-31', 'month', 1)).toBe('2025-01-01')
  })
})
