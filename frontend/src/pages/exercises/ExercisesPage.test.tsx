import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { callsTo, json, mockApi, sequence } from '@/test/api'
import { renderApp } from '@/test/app'
import { anna, dumbbellRow, exerciseList, listedExercise } from '@/test/fixtures'

const PAGE = '/workouts/exercises'
const LIST = 'GET /api/exercises'
const PRESET = 'POST /api/exercises/presets'
const SAVE = 'PUT /api/exercises/*'
const squat = listedExercise('barbell_squat', 1)

/** Названия упражнений в секции, сверху вниз. */
const rows = async (section: string) =>
  within(await screen.findByRole('list', { name: section }))
    .getAllByRole('listitem')
    .map((row) => within(row).getByRole('link').textContent)
const group = (name: string) => screen.getByRole('button', { name })

describe('список упражнений', () => {
  it('раздел «Тренировки» открывает журнал и ведёт к упражнениям', async () => {
    mockApi({ 'GET /api/workouts': json(200, { workouts: [] }) })
    await renderApp('/workouts', anna)

    expect(await screen.findByRole('heading', { name: 'Тренировки' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Мои упражнения' })).toHaveAttribute('href', PAGE)
    expect(screen.getByRole('link', { name: 'Тренировки' })).toHaveAttribute('aria-current', 'page')
  })

  it('пока список пуст, весь справочник стоит ниже с мышцами под названием', async () => {
    mockApi({ [LIST]: json(200, exerciseList()) })
    await renderApp(PAGE, anna)

    expect(await rows('Справочник')).toEqual([
      'Ходьба на беговой дорожкеКвадрицепс, ягодицы',
      'Становая тягаБицепс бедра, ягодицы, поясница',
      'ПланкаПресс',
      'Настольный теннис',
      'Приседания со штангойКвадрицепс, ягодицы',
      'Жим штанги лёжаГрудь',
      'ПодтягиванияШирочайшие',
    ])
    expect(screen.getByText(/В списке пока пусто/)).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Мой список' })).not.toBeInTheDocument()
  })

  it('своё и добавленное стоит сверху, из справочника оно уходит', async () => {
    mockApi({ [LIST]: json(200, exerciseList([squat, dumbbellRow])) })
    await renderApp(PAGE, anna)

    expect(await rows('Мой список')).toEqual([
      'Приседания со штангойКвадрицепс, ягодицы',
      'Тяга гантели к поясуСвоё · широчайшие, бицепс',
    ])
    expect(await rows('Справочник')).not.toContain('Приседания со штангойКвадрицепс, ягодицы')
  })

  it('строка ведёт на карточку: штатное — по коду, своё — по ключу', async () => {
    mockApi({ [LIST]: json(200, exerciseList([dumbbellRow])) })
    await renderApp(PAGE, anna)

    const link = (name: RegExp) => screen.findByRole('link', { name })
    expect(await link(/Планка/)).toHaveAttribute('href', '/workouts/exercises/plank')
    expect(await link(/Тяга гантели/)).toHaveAttribute(
      'href',
      `/workouts/exercises/${dumbbellRow.id}`,
    )
  })

  it('добавляет упражнение из справочника одним касанием и остаётся на экране', async () => {
    const calls = mockApi({
      [LIST]: sequence(json(200, exerciseList()), json(200, exerciseList([squat]))),
      [PRESET]: json(200, squat),
    })
    await renderApp(PAGE, anna)

    await userEvent.click(
      await screen.findByRole('button', { name: 'Добавить в список: Приседания со штангой' }),
    )

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Добавлено в список: Приседания со штангой.',
    )
    expect(await rows('Мой список')).toEqual(['Приседания со штангойКвадрицепс, ягодицы'])
    expect(callsTo(calls, PRESET).map((call) => call.body)).toEqual([{ preset: 'barbell_squat' }])
  })

  it('показывает отказ сервера и не сообщает о добавлении', async () => {
    mockApi({ [LIST]: json(200, exerciseList()), [PRESET]: json(500, { detail: 'boom' }) })
    await renderApp(PAGE, anna)

    await userEvent.click(await screen.findByRole('button', { name: 'Добавить в список: Планка' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Что-то пошло не так.')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('метка группы оставляет упражнения, где эти мышцы делают основную работу', async () => {
    mockApi({ [LIST]: json(200, exerciseList([squat, dumbbellRow])) })
    await renderApp(PAGE, anna)
    await rows('Мой список')

    await userEvent.click(group('Спина'))

    expect(group('Спина')).toHaveAttribute('aria-pressed', 'true')
    expect(await rows('Мой список')).toEqual(['Тяга гантели к поясуСвоё · широчайшие, бицепс'])
    expect(await rows('Справочник')).toEqual([
      'Становая тягаБицепс бедра, ягодицы, поясница',
      'ПодтягиванияШирочайшие',
    ])
  })

  it('кардио стоит под своей меткой, а не в «Ногах»', async () => {
    mockApi({ [LIST]: json(200, exerciseList()) })
    await renderApp(PAGE, anna)
    await rows('Справочник')

    await userEvent.click(group('Кардио'))
    expect(await rows('Справочник')).toEqual(['Ходьба на беговой дорожкеКвадрицепс, ягодицы'])

    await userEvent.click(group('Ноги'))
    expect(await rows('Справочник')).toEqual([
      'Становая тягаБицепс бедра, ягодицы, поясница',
      'Приседания со штангойКвадрицепс, ягодицы',
    ])
  })

  it('поиск идёт по названию без учёта регистра', async () => {
    mockApi({ [LIST]: json(200, exerciseList([squat])) })
    await renderApp(PAGE, anna)
    await rows('Мой список')

    await userEvent.type(screen.getByRole('searchbox', { name: 'Найти упражнение' }), 'ТЯГ')

    expect(await rows('Справочник')).toEqual([
      'Становая тягаБицепс бедра, ягодицы, поясница',
      'ПодтягиванияШирочайшие',
    ])
    expect(screen.getByText('Ничего не нашлось.')).toBeInTheDocument()
  })

  it('убранное своё упражнение возвращается отсюда же', async () => {
    const removed = { ...dumbbellRow, archived: true }
    const calls = mockApi({
      [LIST]: sequence(json(200, exerciseList([removed])), json(200, exerciseList([dumbbellRow]))),
      [SAVE]: json(200, dumbbellRow),
    })
    await renderApp(PAGE, anna)

    expect(await rows('Убранные')).toEqual(['Тяга гантели к поясуШирочайшие, бицепс'])
    await userEvent.click(screen.getByRole('button', { name: 'Вернуть: Тяга гантели к поясу' }))

    await waitFor(() => expect(callsTo(calls, SAVE)).toHaveLength(1))
    expect(callsTo(calls, SAVE)[0]).toMatchObject({
      path: `/api/exercises/${dumbbellRow.id}`,
      body: { name: 'Тяга гантели к поясу', kind: 'weight_reps', muscles: ['lats', 'biceps'] },
    })
    expect(await rows('Мой список')).toEqual(['Тяга гантели к поясуСвоё · широчайшие, бицепс'])
  })

  it('убранное штатное упражнение снова стоит в справочнике', async () => {
    mockApi({ [LIST]: json(200, exerciseList([{ ...squat, archived: true }])) })
    await renderApp(PAGE, anna)

    expect(await rows('Справочник')).toContain('Приседания со штангойКвадрицепс, ягодицы')
    expect(screen.queryByRole('list', { name: 'Убранные' })).not.toBeInTheDocument()
  })

  it('своё упражнение заводится по пунктирной ссылке', async () => {
    mockApi({ [LIST]: json(200, exerciseList()) })
    await renderApp(PAGE, anna)

    await userEvent.click(await screen.findByRole('link', { name: 'Своё упражнение' }))

    expect(await screen.findByRole('heading', { name: 'Своё упражнение' })).toBeInTheDocument()
  })
})
