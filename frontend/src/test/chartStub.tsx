import type { LineChartProps } from '@/components/chart/LineChart'

/**
 * В jsdom нет canvas, поэтому в тестах вместо ECharts стоит заглушка: она печатает данные,
 * которые получил бы график, — по ним тесты и проверяют, что на него уходит.
 */
export function ChartStub({ values, trend, formatValue, label }: LineChartProps) {
  return (
    <div role="img" aria-label={label}>
      <p data-testid="values">
        {values.points.map((point) => `${point.date}=${point.value}`).join(' ')}
      </p>
      <p data-testid="trend">{trend?.points.map((point) => point.value).join(' ') ?? 'нет'}</p>
      <p data-testid="sample">{formatValue(72.4)}</p>
    </div>
  )
}
