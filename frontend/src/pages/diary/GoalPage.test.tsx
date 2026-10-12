import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { today } from '@/lib/dates'
import { callsTo, json, mockApi } from '@/test/api'
import { renderApp } from '@/test/app'
import {
  anna,
  dailyGoal,
  diaryDay,
  measurement,
  metricList,
  metrics,
  summaryOf,
} from '@/test/fixtures'

const GOAL = 'GET /api/diary/goal'
const SAVE = 'PUT /api/diary/goal'
const SUMMARY = 'GET /api/measurements/summary'
const METRICS = 'GET /api/metrics'

// 36 лет на 11.10.2026, 180 см, 80 кг: основной обмен 1750 ккал.
const boris = { ...anna, sex: 'male', birth_date: '1990-05-17', height_cm: 180 } as const
const weight = summaryOf({ [metrics.weight.id]: [measurement('2026-10-10', 80)] })

function fields() {
  return {
    kcal: screen.getByLabelText('Калории, ккал'),
    protein: screen.getByLabelText('Белки, г'),
    fat: screen.getByLabelText('Жиры, г'),
    carbs: screen.getByLabelText('Углеводы, г'),
    water: screen.getByLabelText('Вода, мл'),
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
    const { kcal, protein, water } = fields()
    expect(kcal).toHaveValue('2100')
    expect(protein).toHaveValue('130')
    expect(water).toHaveValue('2000')
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
      water_ml: 2000,
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
      water_ml: null,
      local_date: today(),
    })
  })

  it('пустая цель сохраняется: так её снимают', async () => {
    const calls = mockApi({
      [GOAL]: json(200, { ...dailyGoal, fat_g: null, carbs_g: null, water_ml: null }),
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
      water_ml: null,
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

  it('берёт последний вес и тогда, когда вес убран из списка замеров', async () => {
    const removed = { ...metrics.weight, archived: true }
    mockApi({
      [GOAL]: json(200, null),
      [SUMMARY]: json(200, weight),
      [METRICS]: json(200, metricList([removed, metrics.neck, metrics.waist, metrics.hips])),
    })
    await renderApp('/diary/goal', boris)

    expect(
      await screen.findByText('2 410 ккал · белки 121 г · жиры 80 г · углеводы 301 г'),
    ).toBeInTheDocument()
    expect(fields().water).toHaveValue('2400')
  })

  it('предлагает расчёт по профилю и последнему весу и подставляет его в форму', async () => {
    const calls = mockApi({
      [GOAL]: json(200, null),
      [SUMMARY]: json(200, weight),
      [METRICS]: json(200, metricList()),
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
    // Расчёт по профилю воды не касается: в поле остаётся её расчёт по весу.
    expect(fields().water).toHaveValue('2400')
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
      water_ml: 2400,
    })
  })

  it('пока цели по воде нет, сразу подставляет расчёт по последнему весу', async () => {
    const calls = mockApi({
      [GOAL]: json(200, { ...dailyGoal, water_ml: null }),
      [SUMMARY]: json(200, weight),
      [METRICS]: json(200, metricList()),
      [SAVE]: json(200, dailyGoal),
    })
    await renderApp('/diary/goal', anna)

    const { water } = await waitFor(fields)
    // 80 кг × 30 мл.
    expect(water).toHaveValue('2400')
    expect(
      screen.getByText('По весу 80 кг — около 2 400 мл: 30 мл на килограмм.'),
    ).toBeInTheDocument()
    // В поле уже стоит расчёт — подставлять нечего.
    expect(screen.queryByRole('button', { name: /^Подставить 2\s400 мл$/ })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() => expect(callsTo(calls, SAVE)).toHaveLength(1))
    expect(callsTo(calls, SAVE)[0].body).toMatchObject({ kcal: 2100, water_ml: 2400 })
  })

  it('заданную цель по воде не затирает и возвращает расчёт кнопкой', async () => {
    const calls = mockApi({
      [GOAL]: json(200, dailyGoal),
      [SUMMARY]: json(200, weight),
      [METRICS]: json(200, metricList()),
      [SAVE]: json(200, dailyGoal),
    })
    await renderApp('/diary/goal', anna)

    const { water } = await waitFor(fields)
    expect(water).toHaveValue('2000')
    await userEvent.click(screen.getByRole('button', { name: /^Подставить 2\s400 мл$/ }))
    expect(water).toHaveValue('2400')
    expect(screen.queryByRole('button', { name: /^Подставить 2\s400 мл$/ })).not.toBeInTheDocument()

    // Своё число остаётся своим, а расчёт снова под рукой.
    await userEvent.clear(water)
    await userEvent.type(water, '1800')
    expect(screen.getByRole('button', { name: /^Подставить 2\s400 мл$/ })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() => expect(callsTo(calls, SAVE)).toHaveLength(1))
    expect(callsTo(calls, SAVE)[0].body).toMatchObject({ water_ml: 1800 })
  })

  it('без веса оставляет поле воды пустым и говорит, что внести', async () => {
    mockApi({ [GOAL]: json(200, null), [SUMMARY]: json(200, summaryOf({})) })
    await renderApp('/diary/goal', anna)

    const { water } = await waitFor(fields)
    expect(water).toHaveValue('')
    expect(
      screen.getByText('Внесите вес — приложение предложит цель по воде: 30 мл на килограмм.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Подставить .* мл$/ })).not.toBeInTheDocument()
  })

  it('вес в подсказке воды — в единицах профиля', async () => {
    mockApi({
      [GOAL]: json(200, null),
      [SUMMARY]: json(200, weight),
      [METRICS]: json(200, metricList()),
    })
    await renderApp('/diary/goal', { ...anna, unit_system: 'imperial' })

    expect(
      await screen.findByText('По весу 176,4 фунт — около 2 400 мл: 30 мл на килограмм.'),
    ).toBeInTheDocument()
  })

  it('не принимает цель по воде вне разумных границ', async () => {
    const calls = mockApi({
      [GOAL]: json(200, dailyGoal),
      [SUMMARY]: json(200, summaryOf({})),
      [SAVE]: json(200, dailyGoal),
    })
    await renderApp('/diary/goal', anna)

    const { water } = await waitFor(fields)
    await userEvent.clear(water)
    await userEvent.type(water, '50')
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    expect(await screen.findByText('Вода — от 100 до 10 000 мл')).toBeInTheDocument()
    expect(callsTo(calls, SAVE)).toEqual([])
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
