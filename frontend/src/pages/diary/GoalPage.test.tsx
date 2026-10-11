import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { today } from '@/lib/dates'
import { callsTo, json, mockApi } from '@/test/api'
import { renderApp } from '@/test/app'
import { anna, dailyGoal, diaryDay, measurement, summaryOf } from '@/test/fixtures'

const GOAL = 'GET /api/diary/goal'
const SAVE = 'PUT /api/diary/goal'
const SUMMARY = 'GET /api/measurements/summary'

// 36 лет на 11.10.2026, 180 см, 80 кг: основной обмен 1750 ккал.
const boris = { ...anna, sex: 'male', birth_date: '1990-05-17', height_cm: 180 } as const
const weight = summaryOf({ weight: [measurement('2026-10-10', 80)] })

function fields() {
  return {
    kcal: screen.getByLabelText('Калории, ккал'),
    protein: screen.getByLabelText('Белки, г'),
    fat: screen.getByLabelText('Жиры, г'),
    carbs: screen.getByLabelText('Углеводы, г'),
  }
}

describe('цель на день', () => {
  it('показывает действующую цель и сохраняет новую с сегодняшнего дня', async () => {
    const calls = mockApi({
      [GOAL]: json(200, dailyGoal),
      [SUMMARY]: json(200, summaryOf({})),
      [SAVE]: json(200, dailyGoal),
      'GET /api/diary': json(200, diaryDay(today())),
    })
    const { router } = await renderApp('/diary/goal', anna)

    expect(await screen.findByRole('heading', { name: 'Цель на день' })).toBeInTheDocument()
    expect(screen.getByText(/Действует с 01\/10\/2026\./)).toBeInTheDocument()
    const { kcal, protein } = fields()
    expect(kcal).toHaveValue('2100')
    expect(protein).toHaveValue('130')
    // 130 × 4 + 70 × 9 + 230 × 4 = 2070 из 2100.
    expect(screen.getByText('На БЖУ уходит 2 070 из 2 100 ккал, осталось 30.')).toBeInTheDocument()
    await userEvent.clear(kcal)
    await userEvent.type(kcal, '2200')
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() => expect(router.state.location.pathname).toBe(`/diary/${today()}`))
    expect(callsTo(calls, SAVE)[0].body).toEqual({
      kcal: 2200,
      protein_g: 130,
      fat_g: 70,
      carbs_g: 230,
      local_date: today(),
    })
  })

  it('принимает цель по любому набору показателей', async () => {
    const calls = mockApi({
      [GOAL]: json(200, null),
      [SUMMARY]: json(200, summaryOf({})),
      [SAVE]: json(200, null),
      'GET /api/diary': json(200, diaryDay(today())),
    })
    await renderApp('/diary/goal', anna)

    const { kcal, protein } = await waitFor(fields)
    await userEvent.type(protein, '150')
    // Одних белков мало, чтобы посчитать калории: поле остаётся пустым.
    expect(kcal).toHaveValue('')
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() => expect(callsTo(calls, SAVE)).toHaveLength(1))
    expect(callsTo(calls, SAVE)[0].body).toEqual({
      kcal: null,
      protein_g: 150,
      fat_g: null,
      carbs_g: null,
      local_date: today(),
    })
  })

  it('пустая цель сохраняется: так её снимают', async () => {
    const calls = mockApi({
      [GOAL]: json(200, { ...dailyGoal, fat_g: null, carbs_g: null }),
      [SUMMARY]: json(200, summaryOf({})),
      [SAVE]: json(200, null),
      'GET /api/diary': json(200, diaryDay(today())),
    })
    await renderApp('/diary/goal', anna)

    const { kcal, protein, fat } = await waitFor(fields)
    // Цель была задана не по всем показателям: пустые так и открываются пустыми.
    expect(fat).toHaveValue('')
    await userEvent.clear(kcal)
    await userEvent.clear(protein)
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() => expect(callsTo(calls, SAVE)).toHaveLength(1))
    expect(callsTo(calls, SAVE)[0].body).toEqual({
      kcal: null,
      protein_g: null,
      fat_g: null,
      carbs_g: null,
      local_date: today(),
    })
  })

  it('считает калории по БЖУ, пока их не ввели сами', async () => {
    const calls = mockApi({
      [GOAL]: json(200, null),
      [SUMMARY]: json(200, summaryOf({})),
      [SAVE]: json(200, dailyGoal),
      'GET /api/diary': json(200, diaryDay(today())),
    })
    await renderApp('/diary/goal', anna)

    const { kcal, protein, fat, carbs } = await waitFor(fields)
    await userEvent.type(protein, '130')
    await userEvent.type(fat, '70')
    expect(kcal).toHaveValue('')
    await userEvent.type(carbs, '230')
    expect(kcal).toHaveValue('2070')
    // Калории следуют за БЖУ: предел не превысить, остаток — ноль.
    await userEvent.clear(carbs)
    await userEvent.type(carbs, '250')
    expect(kcal).toHaveValue('2150')
    expect(screen.getByText('На БЖУ уходит 2 150 из 2 150 ккал, осталось 0.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() => expect(callsTo(calls, SAVE)).toHaveLength(1))
    expect(callsTo(calls, SAVE)[0].body).toMatchObject({ kcal: 2150, carbs_g: 250 })
  })

  it('введённые калории — предел для БЖУ', async () => {
    const calls = mockApi({
      [GOAL]: json(200, null),
      [SUMMARY]: json(200, summaryOf({})),
      [SAVE]: json(200, dailyGoal),
      'GET /api/diary': json(200, diaryDay(today())),
    })
    await renderApp('/diary/goal', anna)

    const { kcal, protein, fat, carbs } = await waitFor(fields)
    await userEvent.type(kcal, '2000')
    await userEvent.type(protein, '130')
    await userEvent.type(fat, '70')
    expect(screen.getByText('На БЖУ уходит 1 150 из 2 000 ккал, осталось 850.')).toBeInTheDocument()
    await userEvent.type(carbs, '230')
    // Введённые калории расчётом не затираются — превышение видно сразу.
    expect(kcal).toHaveValue('2000')
    expect(
      screen.getByText('БЖУ дают 2 070 ккал — на 70 больше цели по калориям.'),
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(
      await screen.findByText('Белки, жиры и углеводы не помещаются в эти калории'),
    ).toBeInTheDocument()
    expect(callsTo(calls, SAVE)).toEqual([])

    // БЖУ уменьшили — ошибка уходит без повторной отправки.
    await userEvent.clear(carbs)
    await userEvent.type(carbs, '200')
    await waitFor(() =>
      expect(
        screen.queryByText('Белки, жиры и углеводы не помещаются в эти калории'),
      ).not.toBeInTheDocument(),
    )
    expect(screen.getByText('На БЖУ уходит 1 950 из 2 000 ккал, осталось 50.')).toBeInTheDocument()

    // Стёртые калории снова считаются по БЖУ — когда из поля вышли.
    await userEvent.clear(kcal)
    await userEvent.tab()
    expect(kcal).toHaveValue('1950')
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() => expect(callsTo(calls, SAVE)).toHaveLength(1))
    expect(callsTo(calls, SAVE)[0].body).toMatchObject({ kcal: 1950, carbs_g: 200 })
  })

  it('без профиля и веса объясняет, чего не хватает для расчёта', async () => {
    mockApi({ [GOAL]: json(200, null), [SUMMARY]: json(200, summaryOf({})) })
    await renderApp('/diary/goal', anna)

    expect(
      await screen.findByText(/укажите в профиле пол, дату рождения и рост и внесите вес/),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Подставить' })).not.toBeInTheDocument()
    expect(fields().kcal).toHaveValue('')
    expect(screen.queryByText(/Действует с/)).not.toBeInTheDocument()
  })

  it('предлагает расчёт по профилю и последнему весу и подставляет его в форму', async () => {
    const calls = mockApi({
      [GOAL]: json(200, null),
      [SUMMARY]: json(200, weight),
      [SAVE]: json(200, dailyGoal),
    })
    await renderApp('/diary/goal', boris)

    // Лёгкая активность, удержание веса: 1750 × 1,375 ≈ 2406 → 2410.
    expect(
      await screen.findByText('2 410 ккал · белки 121 г · жиры 80 г · углеводы 301 г'),
    ).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText('Образ жизни'), 'sedentary')
    await userEvent.selectOptions(screen.getByLabelText('Чего хотите'), 'lose')
    expect(
      screen.getByText('1 790 ккал · белки 90 г · жиры 60 г · углеводы 222 г'),
    ).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Подставить' }))
    expect(fields().kcal).toHaveValue('1790')
    expect(fields().carbs).toHaveValue('222')
    // Подставленные калории — круглое число из расчёта, а не сумма БЖУ: они остаются
    // пределом и после правки БЖУ.
    expect(screen.getByText('На БЖУ уходит 1 788 из 1 790 ккал, осталось 2.')).toBeInTheDocument()
    await userEvent.clear(fields().carbs)
    await userEvent.type(fields().carbs, '220')
    expect(fields().kcal).toHaveValue('1790')
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() => expect(callsTo(calls, SAVE)).toHaveLength(1))
    expect(callsTo(calls, SAVE)[0].body).toMatchObject({
      kcal: 1790,
      protein_g: 90,
      fat_g: 60,
      carbs_g: 220,
    })
  })

  it('не принимает цель вне разумных границ и показывает отказ сервера', async () => {
    const calls = mockApi({
      [GOAL]: json(200, dailyGoal),
      [SUMMARY]: json(200, summaryOf({})),
      [SAVE]: json(401, { detail: 'not_authenticated' }),
    })
    await renderApp('/diary/goal', anna)

    const { kcal, fat } = await waitFor(fields)
    await userEvent.clear(kcal)
    await userEvent.type(kcal, '300')
    await userEvent.clear(fat)
    await userEvent.type(fat, '1001')
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(await screen.findByText('Калории — от 500 до 10 000')).toBeInTheDocument()
    expect(screen.getByText('От 0 до 1000 г')).toBeInTheDocument()
    expect(callsTo(calls, SAVE)).toEqual([])

    await userEvent.type(kcal, '0')
    await userEvent.clear(fat)
    await userEvent.type(fat, '70')
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Сеанс истёк. Войдите снова.')
  })
})
