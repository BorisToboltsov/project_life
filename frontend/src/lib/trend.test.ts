import { describe, expect, it } from 'vitest'

import { movingAverage } from './trend'

describe('линия тренда', () => {
  it('усредняет точки за семь дней, заканчивающихся в день точки', () => {
    const points = [
      { date: '2026-10-01', value: 73 },
      { date: '2026-10-02', value: 72 },
      { date: '2026-10-03', value: 74 },
    ]

    expect(movingAverage(points)).toEqual([
      { date: '2026-10-01', value: 73 },
      { date: '2026-10-02', value: 72.5 },
      { date: '2026-10-03', value: 73 },
    ])
  })

  it('точки старше окна в среднее не входят', () => {
    const points = [
      { date: '2026-09-01', value: 80 },
      { date: '2026-10-01', value: 72 },
      { date: '2026-10-07', value: 70 },
      { date: '2026-10-08', value: 71 },
    ]

    expect(movingAverage(points).map((point) => point.value)).toEqual([80, 72, 71, 70.5])
  })

  it('окно задаётся в днях', () => {
    const points = [
      { date: '2026-10-01', value: 70 },
      { date: '2026-10-02', value: 72 },
      { date: '2026-10-03', value: 74 },
    ]

    expect(movingAverage(points, 2).map((point) => point.value)).toEqual([70, 71, 73])
  })

  it('пустой ряд остаётся пустым', () => {
    expect(movingAverage([])).toEqual([])
  })
})
