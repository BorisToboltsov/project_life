import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { callsTo, json, mockApi, sequence } from '@/test/api'
import { renderApp } from '@/test/app'
import { anna, dumbbellRow, exerciseList, listedExercise } from '@/test/fixtures'

const NEW = '/workouts/exercises/new'
const LIST = 'GET /api/exercises'
const SAVE = 'PUT /api/exercises/*'
const idOf = (path: string) => path.split('/').at(-1)!
const name = () => screen.findByLabelText('Название')

describe('форма своего упражнения', () => {
  it('создаёт упражнение с ключом от клиента и открывает его карточку', async () => {
    const calls = mockApi({
      [LIST]: (call) => {
        const saved = callsTo(calls, SAVE)[0]
        const list = saved ? [{ ...dumbbellRow, id: idOf(saved.path) }] : []
        return json(200, exerciseList(list))(call)
      },
      [SAVE]: json(201, dumbbellRow),
    })
    await renderApp(NEW, anna)

    await userEvent.type(await name(), '  Тяга гантели к поясу ')
    await userEvent.click(screen.getByRole('checkbox', { name: 'Широчайшие' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Бицепс' }))
    await userEvent.click(screen.getByRole('button', { name: 'Добавить' }))

    expect(await screen.findByRole('heading', { name: 'Тяга гантели к поясу' })).toBeInTheDocument()
    const [saved] = callsTo(calls, SAVE)
    expect(idOf(saved.path)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/)
    expect(saved.body).toEqual({
      name: 'Тяга гантели к поясу',
      kind: 'weight_reps',
      muscles: ['biceps', 'lats'],
    })
  })

  it('вид подхода выбирается одним из четырёх', async () => {
    const calls = mockApi({ [LIST]: json(200, exerciseList()), [SAVE]: json(201, dumbbellRow) })
    await renderApp(NEW, anna)

    await userEvent.type(await name(), 'Лыжный тренажёр')
    expect(screen.getAllByRole('radio').map((radio) => radio.parentElement?.textContent)).toEqual([
      'Вес × повторы',
      'Повторы',
      'Время',
      'Кардио',
    ])
    await userEvent.click(screen.getByRole('radio', { name: 'Кардио' }))
    await userEvent.click(screen.getByRole('button', { name: 'Добавить' }))

    await waitFor(() => expect(callsTo(calls, SAVE)).toHaveLength(1))
    expect(callsTo(calls, SAVE)[0].body).toEqual({
      name: 'Лыжный тренажёр',
      kind: 'cardio',
      muscles: [],
    })
  })

  it('без названия и с названием длиннее 60 символов не отправляется', async () => {
    const calls = mockApi({ [LIST]: json(200, exerciseList()) })
    await renderApp(NEW, anna)

    await userEvent.click(await screen.findByRole('button', { name: 'Добавить' }))
    expect(await screen.findByText('Заполните поле')).toBeInTheDocument()

    await userEvent.type(await name(), 'я'.repeat(61))
    await userEvent.click(screen.getByRole('button', { name: 'Добавить' }))

    expect(await screen.findByText('Название — до 60 символов')).toBeInTheDocument()
    expect(callsTo(calls, SAVE)).toHaveLength(0)
  })

  it('после сбоя повторная отправка идёт с тем же ключом', async () => {
    const calls = mockApi({
      [LIST]: json(200, exerciseList()),
      [SAVE]: sequence(json(500, { detail: 'boom' }), json(201, dumbbellRow)),
    })
    await renderApp(NEW, anna)

    await userEvent.type(await name(), 'Тяга')
    await userEvent.click(screen.getByRole('button', { name: 'Добавить' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Что-то пошло не так.')
    await userEvent.click(screen.getByRole('button', { name: 'Добавить' }))

    await waitFor(() => expect(callsTo(calls, SAVE)).toHaveLength(2))
    const [first, second] = callsTo(calls, SAVE)
    expect(first.path).toBe(second.path)
  })
})

describe('правка своего упражнения', () => {
  const EDIT = `/workouts/exercises/${dumbbellRow.id}/edit`

  it('меняет название и мышцы; вид подхода заблокирован', async () => {
    const calls = mockApi({
      [LIST]: json(200, exerciseList([dumbbellRow])),
      [SAVE]: json(200, dumbbellRow),
    })
    await renderApp(EDIT, anna)

    expect(await screen.findByRole('heading', { name: 'Изменить упражнение' })).toBeInTheDocument()
    expect(await name()).toHaveValue('Тяга гантели к поясу')
    expect(screen.getByRole('radio', { name: 'Вес × повторы' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Время' })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: 'Широчайшие' })).toBeChecked()

    await userEvent.clear(await name())
    await userEvent.type(await name(), 'Тяга гантели в наклоне')
    await userEvent.click(screen.getByRole('checkbox', { name: 'Бицепс' }))
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() => expect(callsTo(calls, SAVE)).toHaveLength(1))
    expect(callsTo(calls, SAVE)[0]).toMatchObject({
      path: `/api/exercises/${dumbbellRow.id}`,
      body: { name: 'Тяга гантели в наклоне', kind: 'weight_reps', muscles: ['lats'] },
    })
  })

  it('штатное упражнение не правится', async () => {
    const squat = listedExercise('barbell_squat', 1)
    mockApi({ [LIST]: json(200, exerciseList([squat])) })
    await renderApp(`/workouts/exercises/${squat.id}/edit`, anna)

    expect(await screen.findByText('Такого упражнения нет.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Название')).not.toBeInTheDocument()
  })
})
