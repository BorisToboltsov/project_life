import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { callsTo, json, mockApi, sequence } from '@/test/api'
import { renderApp } from '@/test/app'
import { anna, exerciseList, listedExercise } from '@/test/fixtures'

const deadlift = listedExercise('deadlift', 1)
const group = {
  id: '0199b7a0-0000-7000-8000-0000000000b1',
  name: 'Спина',
  exercise_ids: [deadlift.id],
  weekdays: [0, 3],
  start_date: '2026-10-19',
  end_date: null,
  dates: ['2026-10-18'],
  scheduled: true,
}
const routes = {
  'GET /api/workout-groups': json(200, { date: '2026-10-18', groups: [group] }),
  'GET /api/workouts': json(200, { workouts: [] }),
  'GET /api/exercises': json(200, exerciseList([deadlift])),
}

describe('группы тренировок', () => {
  it('показывает план на сегодня и повторяет запуск с теми же ключами после ошибки', async () => {
    const calls = mockApi({
      ...routes,
      'POST /api/workout-groups/*': sequence(
        json(409, { detail: 'workout_active' }),
        json(409, { detail: 'workout_active' }),
      ),
    })
    await renderApp('/workouts', anna)
    expect(
      await screen.findByRole('heading', { name: 'На сегодня · 18/10/2026' }),
    ).toBeInTheDocument()
    const start = (await screen.findAllByRole('button', { name: 'Начать из группы' }))[0]!
    // Кнопка ждёт списка тренировок: при уже начатой тренировке запускать нечего.
    await waitFor(() => expect(start).toBeEnabled())
    await userEvent.click(start)
    await waitFor(() => expect(callsTo(calls, 'POST /api/workout-groups/*')).toHaveLength(1))
    await userEvent.click(start)
    await waitFor(() => expect(callsTo(calls, 'POST /api/workout-groups/*')).toHaveLength(2))
    const bodies = callsTo(calls, 'POST /api/workout-groups/*').map(
      (call) => call.body as { id: string; item_ids: string[] },
    )
    expect(bodies[0]!.id).toBe(bodies[1]!.id)
    expect(bodies[0]!.item_ids).toEqual(bodies[1]!.item_ids)
  })

  it('сохраняет выбранные упражнения, дни недели и дополнительную дату', async () => {
    const calls = mockApi({
      ...routes,
      'GET /api/workout-groups': json(200, { date: '2026-10-18', groups: [] }),
      'PUT /api/workout-groups/*': json(201, group),
    })
    await renderApp('/workouts', anna)
    await userEvent.click(await screen.findByRole('button', { name: 'Создать группу' }))
    await userEvent.type(screen.getByLabelText('Название группы'), 'Спина')
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Выберите упражнение' }),
      deadlift.id,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Добавить упражнение' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Пн' }))
    const start = screen.getByLabelText('Дата начала')
    await userEvent.clear(start)
    await userEvent.type(start, '19102026')
    await userEvent.type(screen.getByLabelText('Добавить на дату'), '18102026')
    await userEvent.click(screen.getByRole('button', { name: 'Добавить дату' }))
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить группу' }))
    await waitFor(() => expect(callsTo(calls, 'PUT /api/workout-groups/*')).toHaveLength(1))
    expect(callsTo(calls, 'PUT /api/workout-groups/*')[0]!.body).toEqual({
      name: 'Спина',
      exercise_ids: [deadlift.id],
      weekdays: [0],
      start_date: '2026-10-19',
      end_date: null,
      dates: ['2026-10-18'],
    })
  })

  it('не запускает группу с убранным упражнением', async () => {
    mockApi({
      ...routes,
      'GET /api/exercises': json(200, exerciseList([{ ...deadlift, archived: true }])),
    })
    await renderApp('/workouts', anna)
    const section = await screen.findByRole('region', { name: 'Мои группы' })
    await waitFor(() =>
      expect(within(section).getAllByText(/В группе есть убранное упражнение/)).toHaveLength(2),
    )
    for (const button of within(section).getAllByRole('button', { name: 'Начать из группы' }))
      expect(button).toBeDisabled()
  })
})
