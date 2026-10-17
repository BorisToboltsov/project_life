import { useQuery } from '@tanstack/react-query'

import { attempt } from '@/lib/errors'

import { api, type Schemas } from './client'
import { DIARY_KEY } from './nutrition'

export type DiaryStatistics = Schemas['DiaryStatisticsOut']
export type StatisticsDay = Schemas['StatisticsDay']
export type StatisticsAverage = Schemas['StatisticsAverage']

export function useDiaryStatistics(date: string, period: 'week' | 'month') {
  return useQuery({
    queryKey: [...DIARY_KEY, 'stats', period, date],
    queryFn: () =>
      attempt(() => api.GET('/api/diary/stats', { params: { query: { date, period } } })),
  })
}
