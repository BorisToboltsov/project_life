import { render } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import LineChart from './LineChart'

vi.unmock('@/components/chart/LineChart')
interface ChartOption {
  series: {
    data: { symbolSize?: number }[]
    markArea?: { data: unknown }
    markLine?: { data: unknown }
  }[]
  yAxis: { min: (extent: { min: number }) => number; max: (extent: { max: number }) => number }
  tooltip: {
    renderMode: string
    formatter: (items: { seriesName: string; value: [number, number] }[]) => string
  }
}
const chart = vi.hoisted(() => ({
  setOption: vi.fn<(option: ChartOption) => void>(),
  resize: vi.fn<() => void>(),
  dispose: vi.fn<() => void>(),
}))
vi.mock('./echarts', () => ({ echarts: { init: () => chart } }))
it('рисует две линии, выделение точек и полосу; односторонний референс — линия, tooltip без HTML', () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
  const props = {
    values: {
      name: 'Значения',
      points: [
        { date: '2026-01-01', value: 100, marked: true },
        { date: '2026-02-01', value: 140 },
      ],
    },
    second: { name: 'Нижнее', points: [{ date: '2026-01-01', value: 80 }] },
    formatValue: (v: number) => `${v} <единица>`,
    label: 'График',
  }
  const view = render(<LineChart {...props} band={{ low: 120, high: 160 }} />)
  const option = chart.setOption.mock.calls.at(-1)![0]
  expect(option.series).toHaveLength(2)
  expect(option.series[0].data[0].symbolSize).toBe(10)
  expect(option.series[0].markArea?.data).toEqual([[{ yAxis: 120 }, { yAxis: 160 }]])
  expect(option.yAxis.min({ min: 130 })).toBe(120)
  expect(option.yAxis.max({ max: 150 })).toBe(160)
  expect(option.tooltip.renderMode).toBe('richText')
  expect(
    option.tooltip.formatter([
      { seriesName: 'Значения', value: [new Date(2026, 0, 1).getTime(), 100] },
    ]),
  ).toContain('\nЗначения: 100 <единица>')
  view.rerender(<LineChart {...props} band={{ low: null, high: 160 }} />)
  expect(chart.setOption.mock.calls.at(-1)![0].series[0].markLine?.data).toEqual([{ yAxis: 160 }])
  view.unmount()
  expect(chart.dispose).toHaveBeenCalled()
})
