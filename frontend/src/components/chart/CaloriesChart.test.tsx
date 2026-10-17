import { render } from '@testing-library/react'
import { expect, it, vi } from 'vitest'

import type { StatisticsDay } from '@/api/diaryStatistics'
import { dailyGoal } from '@/test/fixtures'

import CaloriesChart from './CaloriesChart'

const chart = vi.hoisted(() => ({
  setOption:
    vi.fn<
      (option: {
        series: { data: (number | null)[]; connectNulls?: boolean }[]
        yAxis: { min: number }
        animation: boolean
        tooltip: { formatter: (items: { dataIndex: number }[]) => string }
      }) => void
    >(),
  on: vi.fn<(name: string, listener: (event: { dataIndex: number }) => void) => void>(),
  dispose: vi.fn<() => void>(),
  resize: vi.fn<() => void>(),
}))
vi.mock('./echarts', () => ({ echarts: { init: () => chart } }))

it('сохраняет пропуски и нули, исключает будущее, показывает историческую цель и выбирает день', () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  const days: StatisticsDay[] = [
    {
      local_date: '2024-02-05',
      future: false,
      totals: { kcal: 0, protein_g: 0, fat_g: 0, carbs_g: 0 },
      water_ml: null,
      goal: dailyGoal,
    },
    { local_date: '2024-02-06', future: false, totals: null, water_ml: null, goal: null },
    { local_date: '2024-02-07', future: true, totals: null, water_ml: null, goal: dailyGoal },
  ]
  const selected = vi.fn<(date: string) => void>()
  const { unmount } = render(<CaloriesChart days={days} onSelect={selected} />)
  const option = chart.setOption.mock.calls.at(-1)![0]
  expect(option.series[0].data).toEqual([0, null, null])
  expect(option.series[1].data).toEqual([dailyGoal.kcal, null, null])
  expect(option.series[1].connectNulls).toBe(false)
  expect(option.yAxis.min).toBe(0)
  expect(option.animation).toBe(false)
  expect(option.tooltip.formatter([{ dataIndex: 0 }])).toContain('0 ккал')
  expect(option.tooltip.formatter([{ dataIndex: 1 }])).toContain('Нет записей')
  expect(option.tooltip.formatter([{ dataIndex: 2 }])).toContain('Этот день ещё не наступил')
  chart.on.mock.calls.at(-1)![1]({ dataIndex: 0 })
  expect(selected).toHaveBeenCalledWith('2024-02-05')
  unmount()
  expect(chart.dispose).toHaveBeenCalled()
})
