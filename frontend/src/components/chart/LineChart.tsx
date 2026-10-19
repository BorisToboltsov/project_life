import { useEffect, useRef } from 'react'

import { isoToDayMonth, isoToDisplay, isoToLocalDate, localDateToIso } from '@/lib/dates'
import type { Point } from '@/lib/trend'

import { echarts } from './echarts'

/** Точка графика; отмеченная — вне референса — рисуется цветом предупреждения. */
export type ChartPoint = Point & { marked?: boolean }

export interface LineChartProps {
  /** Отдельные замеры — точки, соединённые тонкой линией. */
  values: { name: string; points: ChartPoint[] }
  /** Сглаженная линия поверх; не рисуется, если точек слишком мало. */
  trend?: { name: string; points: Point[] }
  /** Вторая линия тех же замеров — нижнее давление под верхним. */
  second?: { name: string; points: ChartPoint[] }
  /** Референс: полоса между границами, а при одной границе — линия по ней. */
  band?: { low: number | null; high: number | null }
  formatValue: (value: number) => string
  label: string
}

function toSeriesData(points: Point[]): [number, number][] {
  return points.flatMap((point) => {
    const date = isoToLocalDate(point.date)
    return date ? [[date.getTime(), point.value] as [number, number]] : []
  })
}

/** Данные серии, где отмеченные точки окрашены отдельно. */
function toMarkedData(points: ChartPoint[], color: string) {
  return points.flatMap((point) => {
    const date = isoToLocalDate(point.date)
    if (!date) return []
    const value: [number, number] = [date.getTime(), point.value]
    return [point.marked ? { value, itemStyle: { color }, symbolSize: 10 } : { value }]
  })
}

/** Полоса или линия референса поверх серии значений. */
function referenceMarks(band: LineChartProps['band'], color: string) {
  if (!band || (band.low === null && band.high === null)) return {}
  if (band.low !== null && band.high !== null) {
    return {
      markArea: {
        silent: true,
        itemStyle: { color, opacity: 0.12 },
        data: [[{ yAxis: band.low }, { yAxis: band.high }]],
      },
    }
  }
  return {
    markLine: {
      silent: true,
      symbol: 'none',
      label: { show: false },
      lineStyle: { color, type: 'dashed', width: 1 },
      data: [{ yAxis: band.low ?? band.high }],
    },
  }
}

const dayOf = (timestamp: number) => localDateToIso(new Date(timestamp))

/**
 * Линейный график по датам. Подгружается отдельным куском сборки (см. Chart.tsx), чтобы
 * ECharts не утяжелял первую загрузку приложения.
 */
export default function LineChart({
  values,
  trend,
  second,
  band,
  formatValue,
  label,
}: LineChartProps) {
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
    const warning = styles.getPropertyValue('--warning-foreground').trim() || '#92400e'
    // Шкала захватывает и референс: полоса вне видимой области ничего бы не сообщила.
    const bounds = [band?.low, band?.high].filter((bound) => typeof bound === 'number')

    chart.current.setOption(
      {
        animationDuration: 400,
        grid: { left: 8, right: 16, top: 16, bottom: 36, containLabel: true },
        legend: { bottom: 0, textStyle: { color: ink } },
        tooltip: {
          trigger: 'axis',
          // Своя единица может содержать угловые скобки: выводим текст, а не HTML.
          renderMode: 'richText',
          // Дата — «день/месяц/год» (инвариант I7), значения — в записи языка интерфейса.
          formatter: (params: unknown) => {
            const items = params as { value: [number, number]; seriesName: string }[]
            const lines = items.map((item) => `${item.seriesName}: ${formatValue(item.value[1])}`)
            return [isoToDisplay(dayOf(items[0].value[0])), ...lines].join('\n')
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
          ...(bounds.length > 0 && {
            min: (extent: { min: number }) => Math.min(extent.min, ...bounds),
            max: (extent: { max: number }) => Math.max(extent.max, ...bounds),
          }),
          axisLabel: { color: ink, formatter: (value: number) => formatValue(value) },
          splitLine: { lineStyle: { color: rule } },
        },
        series: [
          {
            name: values.name,
            type: 'line',
            data: toMarkedData(values.points, warning),
            symbol: 'circle',
            symbolSize: 7,
            itemStyle: { color: brand },
            lineStyle: { color: brand, width: 1.5, opacity: 0.35 },
            ...referenceMarks(band, brand),
          },
          ...(second
            ? [
                {
                  name: second.name,
                  type: 'line',
                  data: toMarkedData(second.points, warning),
                  symbol: 'circle',
                  symbolSize: 7,
                  itemStyle: { color: ink },
                  lineStyle: { color: ink, width: 1.5, type: 'dashed', opacity: 0.6 },
                },
              ]
            : []),
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
  }, [values, trend, second, band, formatValue])

  return <div ref={container} role="img" aria-label={label} className="h-64 w-full" />
}
