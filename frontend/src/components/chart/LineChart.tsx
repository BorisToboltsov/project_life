import { useEffect, useRef } from 'react'

import { isoToDayMonth, isoToDisplay, isoToLocalDate, localDateToIso } from '@/lib/dates'
import type { Point } from '@/lib/trend'

import { echarts } from './echarts'

export interface LineChartProps {
  /** Отдельные замеры — точки, соединённые тонкой линией. */
  values: { name: string; points: Point[] }
  /** Сглаженная линия поверх; не рисуется, если точек слишком мало. */
  trend?: { name: string; points: Point[] }
  formatValue: (value: number) => string
  label: string
}

function toSeriesData(points: Point[]): [number, number][] {
  return points.flatMap((point) => {
    const date = isoToLocalDate(point.date)
    return date ? [[date.getTime(), point.value] as [number, number]] : []
  })
}

const dayOf = (timestamp: number) => localDateToIso(new Date(timestamp))

/**
 * Линейный график по датам. Подгружается отдельным куском сборки (см. Chart.tsx), чтобы
 * ECharts не утяжелял первую загрузку приложения.
 */
export default function LineChart({ values, trend, formatValue, label }: LineChartProps) {
  const container = useRef<HTMLDivElement>(null)
  const chart = useRef<ReturnType<typeof echarts.init>>(null)

  useEffect(() => {
    const element = container.current
    if (!element) return
    const instance = echarts.init(element)
    chart.current = instance
    const observer = new ResizeObserver(() => instance.resize())
    observer.observe(element)
    return () => {
      observer.disconnect()
      instance.dispose()
      chart.current = null
    }
  }, [])

  useEffect(() => {
    const element = container.current
    if (!element || !chart.current) return
    const styles = getComputedStyle(element)
    const brand = styles.getPropertyValue('--brand').trim() || '#0f766e'
    const ink = styles.getPropertyValue('--muted-foreground').trim() || '#737373'
    const rule = styles.getPropertyValue('--border').trim() || '#e5e5e5'

    chart.current.setOption(
      {
        animationDuration: 400,
        grid: { left: 8, right: 16, top: 16, bottom: 36, containLabel: true },
        legend: { bottom: 0, textStyle: { color: ink } },
        tooltip: {
          trigger: 'axis',
          // Дата — «день/месяц/год» (инвариант I7), значения — в записи языка интерфейса.
          formatter: (params: unknown) => {
            const items = params as { value: [number, number]; seriesName: string }[]
            const lines = items.map((item) => `${item.seriesName}: ${formatValue(item.value[1])}`)
            return [isoToDisplay(dayOf(items[0].value[0])), ...lines].join('<br>')
          },
        },
        xAxis: {
          type: 'time',
          axisLine: { lineStyle: { color: rule } },
          axisLabel: {
            color: ink,
            hideOverlap: true,
            formatter: (timestamp: number) => isoToDayMonth(dayOf(timestamp)),
          },
          splitLine: { show: false },
        },
        yAxis: {
          type: 'value',
          // Шкала от окрестности данных, а не от нуля: иначе изменения веса не разглядеть.
          scale: true,
          axisLabel: { color: ink, formatter: (value: number) => formatValue(value) },
          splitLine: { lineStyle: { color: rule } },
        },
        series: [
          {
            name: values.name,
            type: 'line',
            data: toSeriesData(values.points),
            symbol: 'circle',
            symbolSize: 7,
            itemStyle: { color: brand },
            lineStyle: { color: brand, width: 1.5, opacity: 0.35 },
          },
          ...(trend
            ? [
                {
                  name: trend.name,
                  type: 'line',
                  data: toSeriesData(trend.points),
                  smooth: true,
                  showSymbol: false,
                  itemStyle: { color: brand },
                  lineStyle: { color: brand, width: 3 },
                },
              ]
            : []),
        ],
      },
      { notMerge: true },
    )
  }, [values, trend, formatValue])

  return <div ref={container} role="img" aria-label={label} className="h-64 w-full" />
}
