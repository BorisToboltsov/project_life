import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import type { Schemas } from '@/api/client'
import { today } from '@/lib/dates'
import { callsTo, json, mockApi, sequence } from '@/test/api'
import { renderApp } from '@/test/app'
import { anna, dailyGoal, diaryDay, metricList, summaryOf, waterIntake } from '@/test/fixtures'

const DAY = 'GET /api/diary'
const SAVE = 'PUT /api/diary/water/*'
const REMOVE = 'DELETE /api/diary/water/*'
const PAST = '2026-10-09'

/** Что ещё спрашивает главная, кроме дня дневника. */
const HOME = {
  'GET /api/metrics': json(200, metricList()),
  'GET /api/measurements/summary': json(200, summaryOf({})),
}

/** День, в котором выпиты такие порции; `goal: null` — цели нет вовсе. */
function dayWith(
  drunk: Schemas['WaterIntakeOut'][],
  goal: Schemas['NutritionGoalOut'] | null = dailyGoal,
  date = today(),
) {
  return diaryDay(date, [], goal, undefined, drunk)
}

/** Карточка воды — по её заголовку. */
async function card(title = 'Вода сегодня') {
  const heading = await screen.findByText(title, { selector: '[data-slot="card-title"]' })
  return within(heading.closest<HTMLElement>('[data-slot="card"]')!)
}

function portions(water: ReturnType<typeof within>) {
  return within(water.getByRole('list', { name: 'Порции за день' }))
    .getAllByRole('listitem')
    .map((item) => item.textContent)
}

describe('вода на главной', () => {
  it('показывает выпитое против цели, стакан и порции дня', async () => {
    const drunk = [waterIntake(250), waterIntake(500), waterIntake(150)]
    mockApi({ ...HOME, [DAY]: json(200, dayWith(drunk)) })
    await renderApp('/', anna)

    const water = await card()
    expect(await water.findByText('900 из 2 000 мл')).toBeInTheDocument()
    expect(water.getByText('Осталось 1 100 мл')).toBeInTheDocument()
    expect(water.getByRole('progressbar', { name: 'Выпито из цели' })).toHaveAttribute(
      'aria-valuenow',
      '45',
    )
    expect(portions(water)).toEqual(['250 мл', '500 мл', '150 мл'])
    expect(water.getByRole('link', { name: 'Изменить цель' })).toHaveAttribute(
      'href',
      '/diary/goal',
    )
  })

  it('день дневника главная спрашивает один раз — на питание и на воду', async () => {
    const calls = mockApi({ ...HOME, [DAY]: json(200, dayWith([])) })
    await renderApp('/', anna)

    await (await card()).findByText('0 из 2 000 мл')
    expect(callsTo(calls, DAY)).toHaveLength(1)
  })

  it('вносит порцию одним касанием', async () => {
    const calls = mockApi({
      ...HOME,
      [DAY]: sequence(json(200, dayWith([])), json(200, dayWith([waterIntake(250)]))),
      [SAVE]: json(201, waterIntake(250)),
    })
    await renderApp('/', anna)

    const water = await card()
    await userEvent.click(await water.findByRole('button', { name: 'Добавить 250 мл' }))

    expect(await water.findByText('250 из 2 000 мл')).toBeInTheDocument()
    expect(portions(water)).toEqual(['250 мл'])
    const [saved] = callsTo(calls, SAVE)
    expect(saved.body).toEqual({ local_date: today(), amount_ml: 250 })
    // Ключ порции выбирает устройство: это UUID версии 7.
    expect(saved.path).toMatch(/\/api\/diary\/water\/[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/)
  })

  it.each([
    ['Добавить 150 мл', 150],
    ['Добавить 500 мл', 500],
  ])('кнопка «%s» вносит свою порцию', async (name, amount) => {
    const calls = mockApi({
      ...HOME,
      [DAY]: json(200, dayWith([])),
      [SAVE]: json(201, waterIntake(amount)),
    })
    await renderApp('/', anna)

    await userEvent.click(await (await card()).findByRole('button', { name }))

    await waitFor(() => expect(callsTo(calls, SAVE)).toHaveLength(1))
    expect(callsTo(calls, SAVE)[0].body).toEqual({ local_date: today(), amount_ml: amount })
  })

  it('после сбоя повторяет ту же порцию под тем же ключом, а следующую — под новым', async () => {
    const calls = mockApi({
      ...HOME,
      [DAY]: json(200, dayWith([])),
      [SAVE]: sequence(json(500), json(201, waterIntake(250))),
    })
    await renderApp('/', anna)

    const water = await card()
    const glass = await water.findByRole('button', { name: 'Добавить 250 мл' })
    await userEvent.click(glass)
    expect(await water.findByRole('alert')).toHaveTextContent('Что-то пошло не так')
    await userEvent.click(glass)
    await waitFor(() => expect(water.queryByRole('alert')).not.toBeInTheDocument())
    // Ошибка исчезает в начале запроса; следующая порция доступна после его окончания.
    await waitFor(() => expect(glass).toBeEnabled())
    await userEvent.click(glass)

    await waitFor(() => expect(callsTo(calls, SAVE)).toHaveLength(3))
    const [failed, retried, next] = callsTo(calls, SAVE).map((call) => call.path)
    expect(retried).toBe(failed)
    expect(next).not.toBe(failed)
  })

  it('убирает порцию крестиком на её метке', async () => {
    const mistaken = waterIntake(500)
    const calls = mockApi({
      ...HOME,
      [DAY]: sequence(
        json(200, dayWith([waterIntake(250), mistaken])),
        json(200, dayWith([waterIntake(250)])),
      ),
      [REMOVE]: json(204),
    })
    await renderApp('/', anna)

    const water = await card()
    await userEvent.click(await water.findByRole('button', { name: 'Убрать 500 мл' }))

    expect(await water.findByText('250 из 2 000 мл')).toBeInTheDocument()
    expect(portions(water)).toEqual(['250 мл'])
    expect(callsTo(calls, `DELETE /api/diary/water/${mistaken.id}`)).toHaveLength(1)
  })

  it('показывает отказ сервера при удалении порции', async () => {
    mockApi({
      ...HOME,
      [DAY]: json(200, dayWith([waterIntake(250)])),
      [REMOVE]: json(404, { detail: 'not_found' }),
    })
    await renderApp('/', anna)

    const water = await card()
    await userEvent.click(await water.findByRole('button', { name: 'Убрать 250 мл' }))

    expect(await water.findByRole('alert')).toHaveTextContent('Не найдено.')
  })

  it('своё количество вносится через «Другое»', async () => {
    const calls = mockApi({
      ...HOME,
      [DAY]: sequence(json(200, dayWith([])), json(200, dayWith([waterIntake(330)]))),
      [SAVE]: json(201, waterIntake(330)),
    })
    await renderApp('/', anna)

    const water = await card()
    const other = await water.findByRole('button', { name: 'Другое' })
    expect(other).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(other)
    expect(other).toHaveAttribute('aria-expanded', 'true')

    // Ноль и текст — не порция.
    await userEvent.type(water.getByLabelText('Сколько, мл'), '0')
    await userEvent.click(water.getByRole('button', { name: 'Добавить' }))
    expect(await water.findByText('От 1 до 5000 мл')).toBeInTheDocument()
    expect(callsTo(calls, SAVE)).toEqual([])

    await userEvent.clear(water.getByLabelText('Сколько, мл'))
    await userEvent.type(water.getByLabelText('Сколько, мл'), '330')
    await userEvent.click(water.getByRole('button', { name: 'Добавить' }))

    expect(await water.findByText('330 из 2 000 мл')).toBeInTheDocument()
    expect(callsTo(calls, SAVE)[0].body).toEqual({ local_date: today(), amount_ml: 330 })
    // Поле закрылось: порция внесена.
    expect(water.queryByLabelText('Сколько, мл')).not.toBeInTheDocument()
    expect(other).toHaveAttribute('aria-expanded', 'false')
  })

  it('поле своего количества остаётся открытым, пока сервер отказывает', async () => {
    mockApi({
      ...HOME,
      [DAY]: json(200, dayWith([])),
      [SAVE]: json(500),
    })
    await renderApp('/', anna)

    const water = await card()
    await userEvent.click(await water.findByRole('button', { name: 'Другое' }))
    await userEvent.type(water.getByLabelText('Сколько, мл'), '330')
    await userEvent.click(water.getByRole('button', { name: 'Добавить' }))

    expect(await water.findByRole('alert')).toBeInTheDocument()
    expect(water.getByLabelText('Сколько, мл')).toHaveValue('330')
  })

  it('без цели показывает только выпитое, пустой стакан и предлагает задать цель', async () => {
    const noWaterGoal = { ...dailyGoal, water_ml: null }
    mockApi({ ...HOME, [DAY]: json(200, dayWith([waterIntake(250)], noWaterGoal)) })
    await renderApp('/', anna)

    const water = await card()
    expect(await water.findByText('250 мл', { selector: '.text-xl' })).toBeInTheDocument()
    expect(water.getByRole('link', { name: 'Задать цель' })).toHaveAttribute('href', '/diary/goal')
    expect(water.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(water.queryByRole('link', { name: 'Изменить цель' })).not.toBeInTheDocument()
    expect(water.queryByText(/Осталось/)).not.toBeInTheDocument()
  })

  it('выполненная цель: стакан полон, перебор — не ошибка', async () => {
    mockApi({
      ...HOME,
      [DAY]: json(200, dayWith([waterIntake(1500), waterIntake(1000)])),
    })
    await renderApp('/', anna)

    const water = await card()
    expect(await water.findByText('2 500 из 2 000 мл')).toBeInTheDocument()
    expect(water.getByText('Цель выполнена')).toBeInTheDocument()
    expect(water.getByRole('progressbar', { name: 'Выпито из цели' })).toHaveAttribute(
      'aria-valuenow',
      '100',
    )
  })

  it('пока день грузится, у карточки только заголовок', async () => {
    mockApi(HOME)
    await renderApp('/', anna)

    const water = await card()
    expect(water.queryByRole('button', { name: 'Добавить 250 мл' })).not.toBeInTheDocument()
  })
})

describe('вода в дне дневника', () => {
  it('вносит воду в открытый день, а не в сегодняшний', async () => {
    const calls = mockApi({
      [DAY]: sequence(
        json(200, dayWith([], dailyGoal, PAST)),
        json(200, dayWith([waterIntake(500)], dailyGoal, PAST)),
      ),
      [SAVE]: json(201, waterIntake(500)),
    })
    await renderApp(`/diary/${PAST}`, anna)

    const water = await card('Вода')
    await userEvent.click(await water.findByRole('button', { name: 'Добавить 500 мл' }))

    expect(await water.findByText('500 из 2 000 мл')).toBeInTheDocument()
    expect(callsTo(calls, SAVE)[0].body).toEqual({ local_date: PAST, amount_ml: 500 })
    // Цель меняют из «Итога дня» — у воды своей кнопки здесь нет.
    expect(water.queryByRole('link', { name: 'Изменить цель' })).not.toBeInTheDocument()
  })
})
