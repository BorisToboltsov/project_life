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
    await userEvent.clear(kcal)
    await userEvent.type(kcal, '1900')
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() => expect(router.state.location.pathname).toBe(`/diary/${today()}`))
    expect(callsTo(calls, SAVE)[0].body).toEqual({
      kcal: 1900,
      protein_g: 130,
      fat_g: 70,
      carbs_g: 230,
      local_date: today(),
    })
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
      await screen.findByText('2 410 ккал · белки 121 г · жиры 80 г · углеводы 302 г'),
    ).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText('Образ жизни'), 'sedentary')
    await userEvent.selectOptions(screen.getByLabelText('Чего хотите'), 'lose')
    expect(
      screen.getByText('1 790 ккал · белки 90 г · жиры 60 г · углеводы 223 г'),
    ).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Подставить' }))
    expect(fields().kcal).toHaveValue('1790')
    expect(fields().carbs).toHaveValue('223')
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() => expect(callsTo(calls, SAVE)).toHaveLength(1))
    expect(callsTo(calls, SAVE)[0].body).toMatchObject({
      kcal: 1790,
      protein_g: 90,
      fat_g: 60,
      carbs_g: 223,
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
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(await screen.findByText('Калории — от 500 до 10 000')).toBeInTheDocument()
    expect(screen.getByText('От 0 до 1000 г')).toBeInTheDocument()
    expect(callsTo(calls, SAVE)).toEqual([])

    await userEvent.type(kcal, '0')
    await userEvent.type(fat, '70')
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Сеанс истёк. Войдите снова.')
  })
})
