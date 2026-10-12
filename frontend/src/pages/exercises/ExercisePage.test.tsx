import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { callsTo, json, mockApi, sequence } from '@/test/api'
import { renderApp, textOf } from '@/test/app'
import { anna, dumbbellRow, exerciseList, listedExercise } from '@/test/fixtures'

const LIST = 'GET /api/exercises'
const PRESET = 'POST /api/exercises/presets'
const ONE = '/api/exercises/*'
const squat = listedExercise('barbell_squat', 1)
const card = (key: string) => `/workouts/exercises/${key}`

describe('карточка штатного упражнения', () => {
  it('показывает вид, рисунок техники, карту мышц и шаги', async () => {
    mockApi({ [LIST]: json(200, exerciseList()) })
    const { container } = await renderApp(card('barbell_squat'), anna)

    expect(
      await screen.findByRole('heading', { name: 'Приседания со штангой' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Вес × повторы')).toBeInTheDocument()
    expect(container.querySelectorAll('svg.illus')).toHaveLength(2)
    expect(textOf(screen.getByText('Работают:').parentElement!)).toBe(
      'Работают: квадрицепс, ягодицы',
    )
    expect(textOf(screen.getByText('Помогают:').parentElement!)).toBe(
      'Помогают: бицепс бедра, пресс',
    )
    const steps = within(screen.getByRole('list', { name: 'Техника' })).getAllByRole('listitem')
    expect(steps.map((step) => step.textContent)).toEqual([
      'Штанга на плечах, стопы на ширине плеч.',
      'Таз назад и вниз, колени по линии носков.',
      'Бёдра до параллели — и вверх через пятки.',
    ])
  })

  it('которого нет в списке, добавляется кнопкой', async () => {
    const calls = mockApi({
      [LIST]: sequence(json(200, exerciseList()), json(200, exerciseList([squat]))),
      [PRESET]: json(200, squat),
    })
    await renderApp(card('barbell_squat'), anna)

    await userEvent.click(await screen.findByRole('button', { name: 'Добавить в мой список' }))

    expect(await screen.findByRole('button', { name: 'Убрать из списка' })).toBeInTheDocument()
    expect(callsTo(calls, PRESET).map((call) => call.body)).toEqual([{ preset: 'barbell_squat' }])
  })

  it('из списка убирается после подтверждения', async () => {
    const calls = mockApi({
      [LIST]: sequence(
        json(200, exerciseList([squat])),
        json(200, exerciseList([{ ...squat, archived: true }])),
      ),
      [`DELETE ${ONE}`]: json(204),
    })
    await renderApp(card('barbell_squat'), anna)

    await userEvent.click(await screen.findByRole('button', { name: 'Убрать из списка' }))
    expect(
      screen.getByText('Убрать «Приседания со штангой» из списка? Записанное по нему сохранится.'),
    ).toBeInTheDocument()
    expect(callsTo(calls, `DELETE ${ONE}`)).toHaveLength(0)
    await userEvent.click(screen.getByRole('button', { name: 'Да, убрать' }))

    expect(await screen.findByRole('button', { name: 'Добавить в мой список' })).toBeInTheDocument()
    expect(callsTo(calls, `DELETE ${ONE}`)[0].path).toBe(`/api/exercises/${squat.id}`)
    expect(screen.getByRole('status')).toHaveTextContent('Убрано из списка.')
  })

  it('«Отмена» оставляет упражнение в списке', async () => {
    const calls = mockApi({ [LIST]: json(200, exerciseList([squat])) })
    await renderApp(card('barbell_squat'), anna)

    await userEvent.click(await screen.findByRole('button', { name: 'Убрать из списка' }))
    await userEvent.click(screen.getByRole('button', { name: 'Отмена' }))

    expect(screen.getByRole('button', { name: 'Убрать из списка' })).toBeInTheDocument()
    expect(callsTo(calls, `DELETE ${ONE}`)).toHaveLength(0)
  })

  it('кардио говорит, что записывает подход', async () => {
    mockApi({ [LIST]: json(200, exerciseList()) })
    await renderApp(card('treadmill_walk'), anna)

    expect(await screen.findByText('Кардио')).toBeInTheDocument()
    expect(textOf(screen.getByText('Записывается:').parentElement!)).toBe(
      'Записывается: время, дистанция, наклон',
    )
  })

  it('у занятия без мышц карты мышц нет', async () => {
    mockApi({ [LIST]: json(200, exerciseList()) })
    const { container } = await renderApp(card('table_tennis'), anna)

    expect(await screen.findByRole('heading', { name: 'Настольный теннис' })).toBeInTheDocument()
    expect(container.querySelectorAll('svg.illus')).toHaveLength(1)
    expect(screen.queryByText('Работают:')).not.toBeInTheDocument()
  })

  it('показывает отказ сервера', async () => {
    mockApi({ [LIST]: json(200, exerciseList()), [PRESET]: json(500, { detail: 'boom' }) })
    await renderApp(card('plank'), anna)

    await userEvent.click(await screen.findByRole('button', { name: 'Добавить в мой список' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Что-то пошло не так.')
  })
})

describe('карточка своего упражнения', () => {
  it('показывает метку «Своё», мышцы и ссылку на правку; шагов техники нет', async () => {
    mockApi({ [LIST]: json(200, exerciseList([dumbbellRow])) })
    await renderApp(card(dumbbellRow.id), anna)

    expect(await screen.findByRole('heading', { name: 'Тяга гантели к поясу' })).toBeInTheDocument()
    expect(screen.getByText('Своё')).toBeInTheDocument()
    expect(textOf(screen.getByText('Работают:').parentElement!)).toBe(
      'Работают: широчайшие, бицепс',
    )
    expect(screen.queryByText('Помогают:')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Техника' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Изменить' })).toHaveAttribute(
      'href',
      `/workouts/exercises/${dumbbellRow.id}/edit`,
    )
  })

  it('убранное возвращается кнопкой под тем же ключом', async () => {
    const calls = mockApi({
      [LIST]: sequence(
        json(200, exerciseList([{ ...dumbbellRow, archived: true }])),
        json(200, exerciseList([dumbbellRow])),
      ),
      [`PUT ${ONE}`]: json(200, dumbbellRow),
    })
    await renderApp(card(dumbbellRow.id), anna)

    expect(await screen.findByRole('status')).toHaveTextContent('Убрано из списка.')
    await userEvent.click(screen.getByRole('button', { name: 'Добавить в мой список' }))

    await waitFor(() => expect(callsTo(calls, `PUT ${ONE}`)).toHaveLength(1))
    expect(callsTo(calls, `PUT ${ONE}`)[0]).toMatchObject({
      path: `/api/exercises/${dumbbellRow.id}`,
      body: { name: 'Тяга гантели к поясу', kind: 'weight_reps', muscles: ['lats', 'biceps'] },
    })
    expect(await screen.findByRole('button', { name: 'Убрать из списка' })).toBeInTheDocument()
  })
})

describe('карточка упражнения, которого нет', () => {
  it('говорит об этом и ведёт к списку', async () => {
    mockApi({ [LIST]: json(200, exerciseList()) })
    await renderApp(card('no-such-exercise'), anna)

    expect(await screen.findByText('Такого упражнения нет.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('link', { name: 'К списку упражнений' }))

    expect(await screen.findByRole('heading', { name: 'Упражнения' })).toBeInTheDocument()
  })
})
