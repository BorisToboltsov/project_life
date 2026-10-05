import { isoToLocalDate } from './dates'

export interface Point {
  /** Местная дата измерения, `ГГГГ-ММ-ДД`. */
  date: string
  value: number
}

const DAY_MS = 24 * 60 * 60 * 1000

function dayNumber(iso: string): number {
  const date = isoToLocalDate(iso)
  return date ? Math.round(date.getTime() / DAY_MS) : Number.NaN
}

/**
 * Линия тренда: скользящее среднее за `windowDays` дней, заканчивающихся в день точки.
 * Сглаживает суточные колебания веса. `points` — по возрастанию даты.
 */
export function movingAverage(points: Point[], windowDays = 7): Point[] {
  return points.map((point, index) => {
    const end = dayNumber(point.date)
    let sum = 0
    let count = 0
    for (let cursor = index; cursor >= 0; cursor--) {
      if (end - dayNumber(points[cursor].date) >= windowDays) break
      sum += points[cursor].value
      count += 1
    }
    return { date: point.date, value: Math.round((sum / count) * 100) / 100 }
  })
}
