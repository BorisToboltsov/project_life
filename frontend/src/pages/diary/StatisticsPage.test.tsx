import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { DiaryStatistics, StatisticsAverage } from '@/api/diaryStatistics'
import i18n from '@/i18n'
import { shiftDays } from '@/lib/dates'
import { callsTo, json, mockApi, sequence } from '@/test/api'
import { renderApp } from '@/test/app'
import { anna, dailyGoal, measurement } from '@/test/fixtures'

vi.mock('@/components/chart/CaloriesChart', () => ({
  default: () => <div data-testid="calories-chart" />,
}))
const API = 'GET /api/diary/stats'
const PATH = '/diary/stats?period=week&date=2024-02-05'
const average = (
  value: number | null,
  goal: number | null = null,
  days = 2,
  goal_days = 0,
): StatisticsAverage => ({ value, goal, days, goal_days })
function stats(): DiaryStatistics {
  return {
    period: 'week',
    start: '2024-02-05',
    end: '2024-02-11',
    today: '2024-02-07',
    days: Array.from({ length: 7 }, (_, i) => ({
      local_date: shiftDays('2024-02-05', i),
      future: i > 2,
      totals:
        i === 0 || i === 2
          ? { kcal: i === 0 ? 0 : 400, protein_g: 20, fat_g: 10, carbs_g: 30 }
          : null,
      water_ml: i === 1 ? 500 : null,
      goal: i === 2 ? dailyGoal : null,
    })),
    kcal: average(200, null, 2, 1),
    protein_g: average(20, 120, 2, 2),
    fat_g: average(10),
    carbs_g: average(30),
    water_ml: average(500, 2000, 1, 1),
    first_weight: measurement('2024-02-05', 80),
    last_weight: measurement('2024-02-07', 79),
  }
}

describe('статистика питания', () => {
  it('показывает средние, частичные цели, воду и первый/последний вес', async () => {
    mockApi({ [API]: json(200, stats()) })
    await renderApp(PATH, anna)
    expect(await screen.findByText('Дней с записями: 2 из 3')).toBeInTheDocument()
    expect(screen.getByText('200 ккал')).toBeInTheDocument()
    expect(screen.getByText('Дней с целью: 1 из 2')).toBeInTheDocument()
    expect(screen.queryByText('Дней с целью: 0 из 2')).not.toBeInTheDocument()
    expect(screen.getByText('20 из 120 г')).toBeInTheDocument()
    expect(screen.getByText('500 из 2 000 мл')).toBeInTheDocument()
    expect(screen.getByText('Изменение: -1 кг')).toBeInTheDocument()
    expect(await screen.findByTestId('calories-chart')).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText('День'), '2024-02-06')
    expect(screen.getByText('Нет записей')).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText('День'), '2024-02-09')
    expect(screen.getByText('Этот день ещё не наступил')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Открыть день' })).not.toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText('День'), '2024-02-05')
    expect(screen.getByText('0 ккал')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Открыть день' })).toHaveAttribute(
      'href',
      '/diary/2024-02-05',
    )
  })

  it('переключает календарные периоды и сохраняет их в адресе', async () => {
    const calls = mockApi({ [API]: json(200, stats()) })
    const { router } = await renderApp(PATH, anna)
    await screen.findByText('Дней с записями: 2 из 3')
    await userEvent.click(screen.getByRole('link', { name: 'Месяц' }))
    await waitFor(() =>
      expect(callsTo(calls, API).at(-1)?.query).toEqual({ date: '2024-02-05', period: 'month' }),
    )
    await userEvent.click(screen.getByRole('link', { name: 'Предыдущий период' }))
    await waitFor(() =>
      expect(router.state.location.search).toEqual({ date: '2024-01-01', period: 'month' }),
    )
    await userEvent.click(screen.getByRole('link', { name: 'Следующий период' }))
    await waitFor(() =>
      expect(callsTo(calls, API).at(-1)?.query).toEqual({ date: '2024-02-01', period: 'month' }),
    )
  })

  it('ведёт к текущему периоду, только если сегодня вне показанного', async () => {
    mockApi({ [API]: sequence(json(200, stats()), json(200, { ...stats(), today: '2024-03-01' })) })
    const { queryClient } = await renderApp(PATH, anna)
    await screen.findByText('Дней с записями: 2 из 3')
    expect(screen.queryByRole('link', { name: 'К текущему периоду' })).not.toBeInTheDocument()
    await queryClient.refetchQueries()
    expect(await screen.findByRole('link', { name: 'К текущему периоду' })).toHaveAttribute(
      'href',
      '/diary/stats?date=2024-03-01&period=week',
    )
  })

  it('ошибка предлагает повторить запрос; пустые периоды не показывают нулевые средние', async () => {
    const data = stats()
    for (const key of ['kcal', 'protein_g', 'fat_g', 'carbs_g', 'water_ml'] as const)
      data[key] = average(null, null, 0)
    data.days = data.days.map((d) => ({ ...d, totals: null, water_ml: null }))
    data.first_weight = data.last_weight = null
    mockApi({ [API]: sequence(json(500, { detail: 'unknown' }), json(200, data)) })
    await renderApp(PATH, anna)
    await userEvent.click(await screen.findByRole('button', { name: 'Повторить' }))
    expect(await screen.findByText('За этот период нет записей питания.')).toBeInTheDocument()
    expect(screen.getByText('За этот период нет записей воды.')).toBeInTheDocument()
    expect(screen.getByText('В этом периоде нет замеров веса.')).toBeInTheDocument()
    expect(screen.queryByText('В среднем за день')).not.toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('один замер без дельты, фунты и английский перевод', async () => {
    await i18n.changeLanguage('en')
    mockApi({ [API]: json(200, { ...stats(), last_weight: null }) })
    await renderApp(PATH, { ...anna, unit_system: 'imperial', language: 'en' })
    expect(await screen.findByText('Only one measurement in this period.')).toBeInTheDocument()
    expect(screen.getByText('176.4 lb')).toBeInTheDocument()
    expect(screen.queryByText(/Change:/)).not.toBeInTheDocument()
    const weight = screen
      .getByText('Weight · first and last measurement')
      .closest('[data-slot="card"]')!
    expect(within(weight as HTMLElement).getByText('05/02/2024')).toBeInTheDocument()
  })
})
