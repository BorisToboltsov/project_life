import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import type { StatisticsDay } from '@/api/diaryStatistics'
import { isoToDayMonth, isoToDisplay } from '@/lib/dates'
import { formatKcal } from '@/lib/nutrition'

import { echarts } from './echarts'

export default function CaloriesChart({
  days,
  onSelect,
}: {
  days: StatisticsDay[]
  onSelect: (date: string) => void
}) {
  const container = useRef<HTMLDivElement>(null)
  const { t, i18n } = useTranslation()
  useEffect(() => {
    const element = container.current
    if (!element) return
    const chart = echarts.init(element)
    const styles = getComputedStyle(element)
    const brand = styles.getPropertyValue('--brand').trim()
    const ink = styles.getPropertyValue('--muted-foreground').trim()
    const rule = styles.getPropertyValue('--border').trim()
    chart.setOption({
      animation: !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      grid: { left: 8, right: 12, top: 28, bottom: 40, containLabel: true },
      legend: { bottom: 0, textStyle: { color: ink } },
      tooltip: {
        trigger: 'axis',
        formatter: (params: unknown) => {
          const items = params as { dataIndex: number }[]
          const day = days[items[0].dataIndex]
          const value = day.future
            ? t('statistics.future')
            : day.totals
              ? t('diary.kcal', { value: formatKcal(day.totals.kcal, i18n.language) })
              : t('statistics.noEntries')
          return `${isoToDisplay(day.local_date)}<br>${value}`
        },
      },
      xAxis: {
        type: 'category',
        data: days.map((d) => d.local_date),
        axisLine: { lineStyle: { color: rule } },
        axisTick: { show: false },
        axisLabel: { color: ink, hideOverlap: true, formatter: isoToDayMonth },
      },
      yAxis: {
        type: 'value',
        min: 0,
        name: t('statistics.kcalUnit'),
        axisLabel: { color: ink },
        nameTextStyle: { color: ink },
        splitLine: { lineStyle: { color: rule } },
      },
      series: [
        {
          name: t('statistics.eaten'),
          type: 'bar',
          barMaxWidth: 36,
          itemStyle: { color: brand, borderRadius: [3, 3, 0, 0] },
          data: days.map((d) => (d.future ? null : (d.totals?.kcal ?? null))),
        },
        {
          name: t('statistics.goal'),
          type: 'line',
          step: 'end',
          showSymbol: true,
          symbolSize: 4,
          connectNulls: false,
          lineStyle: { color: ink, type: 'dashed', width: 1.5 },
          itemStyle: { color: ink },
          data: days.map((d) => (d.future ? null : (d.goal?.kcal ?? null))),
        },
      ],
    })
    chart.on('click', (params) => {
      if (typeof params.dataIndex === 'number') onSelect(days[params.dataIndex].local_date)
    })
    const observer = new ResizeObserver(() => chart.resize())
    observer.observe(element)
    return () => {
      observer.disconnect()
      chart.dispose()
    }
  }, [days, onSelect, t, i18n.language])
  return (
    <div
      ref={container}
      className="h-64 w-full"
      role="img"
      aria-label={t('statistics.chartLabel')}
    />
  )
}
