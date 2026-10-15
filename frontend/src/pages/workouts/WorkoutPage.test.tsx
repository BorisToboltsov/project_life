import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { callsTo, json, mockApi } from '@/test/api'
import { renderApp } from '@/test/app'
import { anna, exerciseList, listedExercise } from '@/test/fixtures'
import { today } from '@/lib/dates'

const id = '0199b7a0-0000-7000-8000-0000000000a1'
const itemId = '0199b7a0-0000-7000-8000-0000000000a2'
const previousId = '0199b7a0-0000-7000-8000-0000000000a3'
const deadlift = listedExercise('deadlift', 1)
const previous = {
  id: previousId,
  kind: 'weight_reps',
  reps: 8,
  weight_kg: 60,
  weight_value: 60,
  weight_unit: 'kg',
  duration_seconds: null,
  distance_km: null,
  distance_value: null,
  distance_unit: null,
  incline_percent: null,
  level: null,
}
const summary = {
  id,
  started_at: new Date(Date.now() - 60_000).toISOString(),
  local_date: today(),
  finished_at: null,
  exercise_count: 1,
  set_count: 0,
}
const detail = {
  ...summary,
  exercises: [{ id: itemId, exercise: deadlift, position: 1, sets: [], previous: [previous] }],
}

describe('журнал тренировок', () => {
  it('показывает незавершённую тренировку и историю', async () => {
    mockApi({
      'GET /api/workouts': json(200, {
        workouts: [summary, { ...summary, id: previousId, finished_at: summary.started_at }],
      }),
    })
    await renderApp('/workouts', anna)
    expect(await screen.findByRole('link', { name: 'Продолжить' })).toHaveAttribute(
      'href',
      `/workouts/${id}`,
    )
    expect(screen.getByRole('heading', { name: 'История тренировок' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Мои упражнения' })).toHaveAttribute(
      'href',
      '/workouts/exercises',
    )
  })

  it('подставляет прошлый подход и сохраняет вес с повторами', async () => {
    const calls = mockApi({
      [`GET /api/workouts/${id}`]: json(200, detail),
      'GET /api/exercises': json(200, exerciseList([deadlift])),
      'PUT /api/workouts/*': json(201, { ...previous, id: previousId }),
    })
    await renderApp(`/workouts/${id}`, anna)
    expect(await screen.findByRole('heading', { name: 'Становая тяга' })).toBeInTheDocument()
    expect(screen.getByText('В прошлый раз')).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: 'Вес, кг' })).toHaveValue(60)
    expect(screen.getByRole('spinbutton', { name: 'Повторы' })).toHaveValue(8)
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить подход' }))
    await waitFor(() => expect(callsTo(calls, 'PUT /api/workouts/*')).toHaveLength(1))
    expect(callsTo(calls, 'PUT /api/workouts/*')[0]?.body).toEqual({
      reps: 8,
      weight_value: 60,
      weight_unit: 'kg',
    })
  })
})
