import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { today } from '@/lib/dates'
import { copy } from '@/offline/copy'
import { db } from '@/offline/db'
import { offlineState } from '@/offline/store'
import { WORKOUT_COPY } from '@/offline/workouts'
import { callsTo, json, mockApi } from '@/test/api'
import { renderApp } from '@/test/app'
import { anna, exerciseList, listedExercise } from '@/test/fixtures'

const id = '0199b7a0-0000-7000-8000-0000000000a1'
const itemId = '0199b7a0-0000-7000-8000-0000000000a2'
const deadlift = listedExercise('deadlift', 1)
const previous = {
  id: '0199b7a0-0000-7000-8000-0000000000a3',
  kind: 'weight_reps' as const,
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

/** Копия, какой её оставил прошлый сеанс со связью. */
async function seedCopy() {
  await copy.put(WORKOUT_COPY.detail(id), detail)
  await copy.put(WORKOUT_COPY.list, { workouts: [summary] })
  await copy.put(WORKOUT_COPY.exercises, exerciseList([deadlift]))
}

function cutNetwork() {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
  )
  offlineState.setOnline(false)
}

describe('тренировка без сети', () => {
  it('подход встаёт в очередь, виден с отметкой и уходит, когда связь вернулась', async () => {
    await seedCopy()
    cutNetwork()
    await renderApp(`/workouts/${id}`, anna)

    expect(await screen.findByRole('heading', { name: 'Становая тяга' })).toBeInTheDocument()
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent(
      'Нет сети · записи сохраняются на телефоне',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить подход' }))

    const row = (await screen.findByRole('button', { name: 'Изменить подход' })).parentElement!
    expect(row).toHaveTextContent('1. 60 кг × 8')
    expect(within(row).getByRole('img', { name: 'Ещё не отправлено' })).toBeInTheDocument()
    expect(screen.getByText('Нет сети · ждут отправки: 1')).toBeInTheDocument()

    const saved = { ...detail.exercises[0]!, sets: [{ ...previous, id: 'x' }] }
    const calls = mockApi({
      'GET /api/health': json(200, { status: 'ok', version: '0.10.0' }),
      'PUT /api/workouts/*': json(201, previous),
      [`GET /api/workouts/${id}`]: json(200, { ...detail, set_count: 1, exercises: [saved] }),
      'GET /api/exercises': json(200, exerciseList([deadlift])),
    })
    act(() => {
      window.dispatchEvent(new Event('online'))
    })

    await waitFor(() => expect(callsTo(calls, 'PUT /api/workouts/*')).toHaveLength(1))
    const sent = callsTo(calls, 'PUT /api/workouts/*')[0]!
    expect(sent.path).toMatch(new RegExp(`^/api/workouts/${id}/exercises/${itemId}/sets/`))
    expect(sent.body).toEqual({ weight_value: 60, weight_unit: 'kg', reps: 8 })
    // Связь вернулась: сначала «Отправляем…», затем полоса и отметка исчезают.
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
    await waitFor(() =>
      expect(screen.queryByRole('img', { name: 'Ещё не отправлено' })).not.toBeInTheDocument(),
    )
    expect(await db.queue.count()).toBe(0)
  })

  it('новая тренировка начинается без сети, упражнение берётся из копии', async () => {
    await copy.put(WORKOUT_COPY.list, { workouts: [] })
    await copy.put(WORKOUT_COPY.exercises, exerciseList([deadlift]))
    cutNetwork()
    await renderApp('/workouts', anna)

    await userEvent.click(await screen.findByRole('button', { name: 'Начать тренировку' }))
    expect(
      await screen.findByText('Добавьте упражнение, чтобы записать первый подход.'),
    ).toBeInTheDocument()
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Выберите упражнение' }),
      deadlift.id,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Добавить упражнение' }))

    expect(await screen.findByRole('heading', { name: 'Становая тяга' })).toBeInTheDocument()
    const queued = await db.queue.orderBy('seq').toArray()
    expect(queued.map((change) => change.path)).toEqual([
      '/api/workouts/{workout_id}',
      '/api/workouts/{workout_id}/exercises/{item_id}',
    ])
  })
})

describe('не отправлено', () => {
  const setId = '0199b7a0-0000-7000-8000-0000000000c1'
  const rejected = {
    seq: 7,
    method: 'PUT' as const,
    path: '/api/workouts/{workout_id}/exercises/{item_id}/sets/{set_id}',
    params: { workout_id: id, item_id: itemId, set_id: setId },
    body: { reps: 8, weight_value: 60, weight_unit: 'kg' },
    context: {
      kind: 'set' as const,
      workoutId: id,
      startedAt: '2026-10-17T15:40:00Z',
      localDate: '2026-10-17',
      exerciseId: deadlift.id,
    },
    failure: 'errors.workout_finished' as const,
  }

  it('переносит отклонённые подходы в новую тренировку', async () => {
    await db.rejected.put(rejected)
    await offlineState.reload()
    const calls = mockApi({
      'PUT /api/workouts/*': json(201, summary),
      'GET /api/workouts/*': json(200, detail),
      'GET /api/exercises': json(200, exerciseList([deadlift])),
    })
    await renderApp('/unsent', anna)

    const row = await screen.findByRole('region', { name: 'Тренировка · 17 окт. 2026 г., 18:40' })
    expect(within(row).getByText('Подходы: 1')).toBeInTheDocument()
    expect(
      within(row).getByText('Тренировка уже завершена или время указано неверно.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Сервер не принял изменения: 1')
    await userEvent.click(within(row).getByRole('button', { name: 'В новую тренировку' }))

    await waitFor(() => expect(callsTo(calls, 'PUT /api/workouts/*')).toHaveLength(3))
    const [workout, exercise, set] = callsTo(calls, 'PUT /api/workouts/*')
    expect(workout!.body).toEqual({ started_at: '2026-10-17T15:40:00Z', local_date: '2026-10-17' })
    expect(exercise!.body).toEqual({ exercise_id: deadlift.id })
    expect(set!.body).toEqual(rejected.body)
    expect(set!.path.startsWith(`${exercise!.path}/sets/`)).toBe(true)
    // Отклонённое убирается после ответа на последний запрос — ждём его, а не проверяем сразу.
    await waitFor(async () => expect(await db.rejected.count()).toBe(0))
  })

  it('убирает отклонённое по просьбе', async () => {
    await db.rejected.put(rejected)
    await offlineState.reload()
    mockApi({})
    await renderApp('/unsent', anna)

    await userEvent.click(await screen.findByRole('button', { name: 'Убрать' }))

    expect(
      await screen.findByText('Всё, что внесено на этом телефоне, дошло до сервера.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('выход с неотправленным сначала спрашивает', async () => {
    await db.rejected.put(rejected)
    await offlineState.reload()
    const calls = mockApi({ 'POST /api/auth/logout': json(204) })
    await renderApp('/profile', anna)

    await userEvent.click(await screen.findByRole('button', { name: 'Выйти' }))
    expect(screen.getByText('Не отправлено изменений: 1. Выйти и стереть их?')).toBeInTheDocument()
    expect(callsTo(calls, 'POST /api/auth/logout')).toHaveLength(0)
    await userEvent.click(screen.getByRole('button', { name: 'Да, выйти' }))

    await waitFor(() => expect(callsTo(calls, 'POST /api/auth/logout')).toHaveLength(1))
    expect(await db.rejected.count()).toBe(0)
  })
})
