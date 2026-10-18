import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import type { Schemas } from '@/api/client'
import { json, mockApi } from '@/test/api'
import { renderApp, textOf } from '@/test/app'
import { anna, exerciseList, listedExercise } from '@/test/fixtures'

const treadmill = listedExercise('treadmill_walk', 1)
const deadlift = listedExercise('deadlift', 2)

function progressOf(
  fields: Partial<Schemas['ExerciseProgressOut']>,
): Schemas['ExerciseProgressOut'] {
  return {
    exercise_id: treadmill.id,
    kind: 'cardio',
    metric: 'duration_seconds',
    points: [],
    max_weight_kg: null,
    max_reps: null,
    max_duration_seconds: null,
    max_distance_km: null,
    pace_unit: null,
    best_pace_seconds_per_km: null,
    cardio: [],
    ...fields,
  }
}

const cardio = progressOf({
  pace_unit: 'per_km',
  max_distance_km: 8.4,
  max_duration_seconds: 3000,
  best_pace_seconds_per_km: 312,
  cardio: [
    {
      workout_id: '0199b7a0-0000-7000-8000-0000000000b1',
      local_date: '2026-10-01',
      distance_km: 5,
      duration_seconds: 1800,
      pace_seconds_per_km: 360,
    },
    {
      workout_id: '0199b7a0-0000-7000-8000-0000000000b2',
      local_date: '2026-10-15',
      distance_km: 8.4,
      duration_seconds: 3000,
      pace_seconds_per_km: 312,
    },
  ],
})

function serve(progress: Schemas['ExerciseProgressOut'], list = [treadmill, deadlift]) {
  mockApi({
    'GET /api/exercises': json(200, exerciseList(list)),
    'GET /api/exercises/*': json(200, progress),
    'GET /api/fitness-results': json(200, []),
  })
}

const records = () =>
  Object.fromEntries(
    [
      ...screen
        .getByRole('heading', { name: 'Прогресс' })
        .closest('[data-slot="card"]')!
        .querySelectorAll('dl > div'),
    ].map((item) => [item.querySelector('dt')!.textContent, textOf(item.querySelector('dd')!)]),
  )

describe('прогресс кардио', () => {
  it('рекорды — дистанция, время и лучший темп; график переключается', async () => {
    serve(cardio)
    await renderApp('/workouts/exercises/treadmill_walk', anna)

    const views = await screen.findByRole('radiogroup', { name: 'График лучших подходов' })
    expect(within(views).getByRole('radio', { name: 'Дистанция' })).toBeChecked()
    expect(records()).toEqual({
      'Максимальная дистанция': '8,4 км',
      'Максимальное время': '50 мин',
      'Лучший темп': '5:12 /км',
    })
    expect(screen.getByText('Темп — по подходам от 1 км')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '15/10/2026: 8,4 км' })).toBeInTheDocument()

    await userEvent.click(within(views).getByRole('radio', { name: 'Темп' }))

    expect(screen.getByRole('img', { name: 'Темп, /км · быстрее — выше' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '01/10/2026: 6:00 /км' })).toBeInTheDocument()

    await userEvent.click(within(views).getByRole('radio', { name: 'Время' }))
    expect(screen.getByRole('link', { name: '01/10/2026: 30 мин' })).toBeInTheDocument()
  })

  it('в имперской системе — мили и темп на милю, у велотренажёра — скорость', async () => {
    serve(cardio)
    const { unmount } = await renderApp('/workouts/exercises/treadmill_walk', {
      ...anna,
      unit_system: 'imperial',
    })

    await screen.findByRole('radiogroup')
    expect(records()['Лучший темп']).toBe('8:22 /миля')
    expect(records()['Максимальная дистанция']).toBe('5,2 миль')
    unmount()

    serve({ ...cardio, pace_unit: 'speed', best_pace_seconds_per_km: 150 })
    await renderApp('/workouts/exercises/treadmill_walk', anna)
    await screen.findByRole('radiogroup')
    expect(records()['Лучший темп']).toBe('24 км/ч')
  })

  it('у силового упражнения — прежний график по лучшему весу', async () => {
    serve(
      progressOf({
        exercise_id: deadlift.id,
        kind: 'weight_reps',
        metric: 'weight_kg',
        max_weight_kg: 80,
        max_reps: 6,
        points: [
          {
            workout_id: '0199b7a0-0000-7000-8000-0000000000b3',
            local_date: '2026-10-15',
            value: 80,
          },
        ],
      }),
    )
    await renderApp('/workouts/exercises/deadlift', anna)

    expect(
      await screen.findByRole('img', { name: 'График лучших подходов: кг' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('radiogroup')).toBeNull()
    expect(records()).toEqual({ 'Максимальный вес': '80 кг', 'Максимум повторов': '6' })
  })
})
