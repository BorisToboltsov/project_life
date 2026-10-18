import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { FitnessResult } from '@/api/fitness'
import { shiftDays, today } from '@/lib/dates'
import { copy } from '@/offline/copy'
import { db } from '@/offline/db'
import { FITNESS_COPY } from '@/offline/fitness'
import { forget } from '@/offline/queue'
import { offlineState } from '@/offline/store'
import { callsTo, json, mockApi } from '@/test/api'
import { renderApp, textOf } from '@/test/app'
import { anna, exerciseList } from '@/test/fixtures'

const LIST = 'GET /api/fitness-results'
const SAVE = 'PUT /api/fitness-results/*'
const date = today()

/** Мужчина 36 лет с полом и датой рождения — для него есть нормы. */
const boris = { ...anna, display_name: 'Борис', sex: 'male' as const, birth_date: '1990-05-17' }

let serial = 0
function result(fields: Partial<FitnessResult> & Pick<FitnessResult, 'test'>): FitnessResult {
  serial += 1
  const day = fields.local_date ?? date
  return {
    id: `0199b7a0-0000-7000-8000-${String(serial).padStart(12, '0')}`,
    tested_at: `${day}T09:00:00.000Z`,
    local_date: day,
    reps: null,
    distance_m: null,
    distance_value: null,
    distance_unit: null,
    variant: null,
    ...fields,
  }
}

const cooper = (distance: number, local_date = date) =>
  result({
    test: 'cooper',
    distance_m: distance,
    distance_value: distance,
    distance_unit: 'm',
    local_date,
  })

const save = () => userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

describe('карточка «Тесты»', () => {
  it('показывает последний результат каждого теста с оценкой', async () => {
    mockApi({
      [LIST]: json(200, [
        cooper(2600),
        result({ test: 'push_ups', reps: 38, variant: 'classic', local_date: shiftDays(date, -3) }),
        cooper(2400, shiftDays(date, -40)),
      ]),
      'GET /api/workouts': json(200, { workouts: [] }),
    })
    await renderApp('/workouts', boris)

    const list = await screen.findByRole('list', { name: 'Тесты' })
    await waitFor(() => expect(within(list).getAllByRole('link')[0]).toHaveTextContent('VO2max'))
    const [cooperRow, pushUps, pullUps] = within(list).getAllByRole('link')
    expect(textOf(cooperRow!)).toContain('Тест Купера')
    expect(textOf(cooperRow!)).toContain('2 600 м')
    expect(textOf(cooperRow!)).toContain('VO2max 46,8')
    expect(textOf(cooperRow!)).toContain('выше среднего')
    expect(textOf(pushUps!)).toContain('38 раз')
    expect(textOf(pushUps!)).toContain('Классические')
    expect(textOf(pushUps!)).toContain('отлично')
    expect(textOf(pullUps!)).toContain('Ещё не проходили')
  })
})

describe('экран теста', () => {
  it('сверху последний результат с VO2max, оценкой и изменением к прошлому разу', async () => {
    mockApi({ [LIST]: json(200, [cooper(2600), cooper(2400, shiftDays(date, -40))]) })
    await renderApp('/workouts/tests/cooper', boris)

    expect(await screen.findByRole('heading', { name: 'Тест Купера' })).toBeInTheDocument()
    expect(await screen.findByText('46,8')).toBeInTheDocument()
    expect(screen.getByText(/2 600 м за 12 минут/)).toBeInTheDocument()
    expect(screen.getByText('+4,5 к прошлому разу')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Оценка: выше среднего' })).toBeInTheDocument()
    expect(screen.getByText('По таблице Купера для мужчин 30–39 лет')).toBeInTheDocument()
    const history = within(screen.getByRole('list', { name: 'История' }))
    expect(history.getAllByRole('listitem')).toHaveLength(2)
  })

  it('без пола и даты рождения в профиле — число без оценки и ссылка на профиль', async () => {
    mockApi({ [LIST]: json(200, [cooper(2600)]) })
    await renderApp('/workouts/tests/cooper', anna)

    expect(await screen.findByText('46,8')).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: /^Оценка/ })).toBeNull()
    expect(screen.getByText(/Укажите в профиле пол и дату рождения/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Открыть профиль' })).toHaveAttribute(
      'href',
      '/profile',
    )
  })

  it('у отжиманий с колен у мужчины оценки нет — норм для этого варианта нет', async () => {
    mockApi({ [LIST]: json(200, [result({ test: 'push_ups', reps: 30, variant: 'knee' })]) })
    await renderApp('/workouts/tests/push_ups', boris)

    expect(
      await screen.findByText(/Нормы есть для классических отжиманий у мужчин/),
    ).toBeInTheDocument()
  })

  it('«Как проводить тест»: шаги, предупреждение и рисунок техники', async () => {
    mockApi({ [LIST]: json(200, []) })
    const { container } = await renderApp('/workouts/tests/pull_ups', boris)

    await userEvent.click(await screen.findByText('Как проводить тест'))

    expect(screen.getByText(/Возьмитесь за перекладину прямым хватом/)).toBeVisible()
    expect(screen.getByText(/Тест — максимальная нагрузка/)).toBeVisible()
    expect(container.querySelectorAll('details svg.illus')).toHaveLength(1)
    expect(
      screen.getByText('Результатов пока нет — пройдите тест и внесите его.'),
    ).toBeInTheDocument()
  })

  it('незнакомый тест — сообщение, а не пустой экран', async () => {
    mockApi({ [LIST]: json(200, []) })
    await renderApp('/workouts/tests/plank', boris)

    expect(await screen.findByText('Такого теста нет.')).toBeInTheDocument()
  })

  it('результат удаляется из истории после подтверждения', async () => {
    const item = result({ test: 'pull_ups', reps: 11 })
    const calls = mockApi({
      [LIST]: json(200, [item]),
      'DELETE /api/fitness-results/*': json(204),
    })
    await renderApp('/workouts/tests/pull_ups', boris)

    await userEvent.click(await screen.findByRole('button', { name: 'Удалить результат' }))
    await userEvent.click(screen.getByRole('button', { name: 'Да, удалить' }))

    await waitFor(() =>
      expect(callsTo(calls, 'DELETE /api/fitness-results/*').map((call) => call.path)).toEqual([
        `/api/fitness-results/${item.id}`,
      ]),
    )
  })
})

describe('таймер Купера', () => {
  it('идущий отсчёт открывает протокол, а кончившийся — вибрирует и зовёт внести дистанцию', async () => {
    const vibrate = vi.fn<(pattern: VibratePattern) => boolean>()
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true })
    sessionStorage.setItem('cooper-timer', String(Date.now() + 5 * 60_000))
    mockApi({ [LIST]: json(200, []) })
    const { unmount } = await renderApp('/workouts/tests/cooper', boris)

    expect(await screen.findByRole('timer')).toHaveTextContent(/^0[45]:\d\d$/)
    expect(screen.getByRole('button', { name: 'Остановить' })).toBeVisible()
    unmount()

    sessionStorage.setItem('cooper-timer', String(Date.now() - 1000))
    await renderApp('/workouts/tests/cooper', boris)
    await userEvent.click(await screen.findByText('Как проводить тест'))

    expect(await screen.findByText('Время вышло — запишите дистанцию.')).toBeVisible()
    expect(vibrate).toHaveBeenCalled()
    expect(screen.getByRole('timer')).toHaveTextContent('12:00')
    expect(sessionStorage.getItem('cooper-timer')).toBeNull()
  })

  it('«Старт» запускает 12 минут, «Остановить» сбрасывает', async () => {
    mockApi({ [LIST]: json(200, []) })
    await renderApp('/workouts/tests/cooper', boris)
    await userEvent.click(await screen.findByText('Как проводить тест'))

    await userEvent.click(screen.getByRole('button', { name: 'Старт' }))
    expect(screen.getByRole('timer')).toHaveTextContent(/^1[12]:\d\d$/)
    expect(sessionStorage.getItem('cooper-timer')).not.toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Остановить' }))
    expect(screen.getByRole('timer')).toHaveTextContent('12:00')
    expect(sessionStorage.getItem('cooper-timer')).toBeNull()
  })
})

describe('новый результат', () => {
  it('дистанция Купера уходит в метрах, экран возвращается к тесту', async () => {
    const calls = mockApi({ [LIST]: json(200, []), [SAVE]: json(201, cooper(2650)) })
    const { router } = await renderApp('/workouts/tests/cooper/new', boris)

    expect(
      await screen.findByRole('heading', { name: 'Тест Купера: новый результат' }),
    ).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Дистанция за 12 минут'), '2650')
    await save()

    await waitFor(() => expect(router.state.location.pathname).toBe('/workouts/tests/cooper'))
    const [call] = callsTo(calls, SAVE)
    expect(call!.path).toMatch(/\/api\/fitness-results\/[0-9a-f]{8}-[0-9a-f]{4}-7/)
    expect(call!.body).toEqual({
      test: 'cooper',
      tested_at: expect.any(String),
      local_date: date,
      distance_value: 2650,
      distance_unit: 'm',
    })
  })

  it('в имперской системе дистанция — в милях, вне пределов — подсказка', async () => {
    const calls = mockApi({ [LIST]: json(200, []), [SAVE]: json(201, cooper(2655)) })
    await renderApp('/workouts/tests/cooper/new', { ...boris, unit_system: 'imperial' })

    const field = await screen.findByLabelText('Дистанция за 12 минут')
    await userEvent.type(field, '5')
    await save()
    expect(await screen.findByText('Дистанция — от 0,37 до 3,73 мили')).toBeInTheDocument()

    await userEvent.clear(field)
    await userEvent.type(field, '1.65')
    await save()
    await waitFor(() => expect(callsTo(calls, SAVE)).toHaveLength(1))
    expect(callsTo(calls, SAVE)[0]!.body).toMatchObject({
      distance_value: 1.65,
      distance_unit: 'mi',
    })
  })

  it('отжимания: вариант по умолчанию — по полу, повторы — целым числом', async () => {
    const calls = mockApi({
      [LIST]: json(200, []),
      [SAVE]: json(201, result({ test: 'push_ups', reps: 24, variant: 'knee' })),
    })
    await renderApp('/workouts/tests/push_ups/new', { ...boris, sex: 'female' })

    expect(await screen.findByRole('radio', { name: 'С колен' })).toBeChecked()
    await userEvent.type(screen.getByLabelText('Повторы'), '24,5')
    await save()
    expect(await screen.findByText('Целое число от 1 до 1000')).toBeInTheDocument()

    await userEvent.clear(screen.getByLabelText('Повторы'))
    await userEvent.type(screen.getByLabelText('Повторы'), '24')
    await save()
    await waitFor(() => expect(callsTo(calls, SAVE)).toHaveLength(1))
    expect(callsTo(calls, SAVE)[0]!.body).toMatchObject({
      test: 'push_ups',
      reps: 24,
      variant: 'knee',
    })
  })

  it('без сети результат ложится в очередь и виден с отметкой', async () => {
    await copy.put(FITNESS_COPY, { etag: '"1"', items: [] })
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    )
    offlineState.setOnline(false)
    const { router } = await renderApp('/workouts/tests/pull_ups/new', boris)

    await userEvent.type(await screen.findByLabelText('Повторы'), '11')
    await save()

    await waitFor(() => expect(router.state.location.pathname).toBe('/workouts/tests/pull_ups'))
    const history = await screen.findByRole('list', { name: 'История' })
    await waitFor(() => expect(history).toHaveTextContent('11 раз'))
    expect(within(history).getByRole('img', { name: 'Ещё не отправлено' })).toBeInTheDocument()
    expect(await db.queue.count()).toBe(1)
  })
})

describe('правка результата', () => {
  it('вариант отжиманий не меняется и уходит прежним', async () => {
    const item = result({
      test: 'push_ups',
      reps: 30,
      variant: 'classic',
      local_date: shiftDays(date, -2),
    })
    const calls = mockApi({ [LIST]: json(200, [item]), [SAVE]: json(200, { ...item, reps: 32 }) })
    await renderApp(`/workouts/tests/push_ups/${item.id}`, boris)

    expect(await screen.findByRole('radio', { name: 'Классические' })).toBeDisabled()
    expect(screen.getByRole('radio', { name: 'С колен' })).toBeDisabled()
    expect(screen.getByText(/Вариант у результата не меняется/)).toBeInTheDocument()
    await userEvent.clear(screen.getByLabelText('Повторы'))
    await userEvent.type(screen.getByLabelText('Повторы'), '32')
    await save()

    await waitFor(() => expect(callsTo(calls, SAVE)).toHaveLength(1))
    const [call] = callsTo(calls, SAVE)
    expect(call!.path).toBe(`/api/fitness-results/${item.id}`)
    expect(call!.body).toEqual({
      test: 'push_ups',
      tested_at: item.tested_at,
      local_date: item.local_date,
      reps: 32,
      variant: 'classic',
    })
  })

  it('чужой или удалённый результат — «не найден»', async () => {
    mockApi({ [LIST]: json(200, []) })
    await renderApp('/workouts/tests/pull_ups/0199b7a0-0000-7000-8000-00000000ffff', boris)

    expect(await screen.findByText('Результат не найден.')).toBeInTheDocument()
  })
})

describe('связь с журналом', () => {
  it('на карточке подтягиваний — ссылка на тест с последним результатом', async () => {
    mockApi({
      'GET /api/exercises': json(200, exerciseList()),
      [LIST]: json(200, [result({ test: 'pull_ups', reps: 11, local_date: '2026-10-03' })]),
    })
    await renderApp('/workouts/exercises/pull_up', boris)

    const link = await screen.findByRole('link', { name: /^Тест:/ })
    await waitFor(() => expect(link).toHaveTextContent('Тест: 11 раз · 03/10/2026'))
    expect(link).toHaveAttribute('href', '/workouts/tests/pull_ups')
  })

  it('отклонённый результат ждёт на экране «Не отправлено» с тестом и значением', async () => {
    mockApi({})
    await db.rejected.put({
      seq: 1,
      method: 'PUT',
      path: '/api/fitness-results/{result_id}',
      params: { result_id: '0199b7a0-0000-7000-8000-0000000000f1' },
      body: {},
      context: {
        kind: 'fitness',
        localDate: '2026-10-12',
        fitness: { test: 'cooper', reps: null, distance: { value: 2650, unit: 'm' } },
      },
      failure: 'errors.unknown',
    })
    await offlineState.reload()
    await renderApp('/unsent', boris)

    const row = await screen.findByRole('region', { name: /^Тест Купера · 2\s650\sм$/ })
    expect(row).toHaveTextContent('12/10/2026')
    await forget([1])
  })
})
