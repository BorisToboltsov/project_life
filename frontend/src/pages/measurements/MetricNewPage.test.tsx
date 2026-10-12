import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { callsTo, json, mockApi, sequence } from '@/test/api'
import { renderApp } from '@/test/app'
import { anna, biceps, bodyFat, metricList, metrics, wrist } from '@/test/fixtures'

const PAGE = '/measurements/metrics/new'
const METRICS = 'GET /api/metrics'
const PRESET = 'POST /api/metrics/presets'
const SAVE = 'PUT /api/metrics/*'
const starting = Object.values(metrics)
const idOf = (path: string) => path.split('/').at(-1)!

const recommended = async () =>
  within(await screen.findByRole('list', { name: 'Рекомендуемые' }))
    .getAllByRole('button')
    .map((button) => button.textContent)
const create = () => userEvent.click(screen.getByRole('button', { name: 'Добавить' }))

describe('экран «+»: рекомендуемые замеры', () => {
  it('предлагает штатные виды, которых нет в списке', async () => {
    mockApi({ [METRICS]: json(200, metricList()) })
    await renderApp(PAGE, anna)

    expect(await screen.findByRole('heading', { name: 'Свой замер' })).toBeInTheDocument()
    expect(await recommended()).toEqual([
      'Грудь',
      'Плечи',
      'Бицепс',
      'Предплечье',
      'Бедро',
      'Голень',
      'Процент жира',
    ])
    expect(screen.queryByRole('list', { name: 'Убранные' })).not.toBeInTheDocument()
  })

  it('добавляет вид одним касанием и остаётся на экране', async () => {
    const calls = mockApi({
      [METRICS]: sequence(json(200, metricList()), json(200, metricList([...starting, biceps]))),
      [PRESET]: json(200, biceps),
    })
    await renderApp(PAGE, anna)

    await userEvent.click(await screen.findByRole('button', { name: 'Добавить: Бицепс' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Добавлено в список: Бицепс.')
    await waitFor(async () => expect(await recommended()).not.toContain('Бицепс'))
    expect(callsTo(calls, PRESET).map((call) => call.body)).toEqual([{ preset: 'biceps' }])
    expect(screen.getByRole('heading', { name: 'Свой замер' })).toBeInTheDocument()
  })

  it('убранный штатный вид снова стоит среди рекомендуемых', async () => {
    const calls = mockApi({
      [METRICS]: json(200, metricList([{ ...metrics.weight, archived: true }, metrics.neck])),
      [PRESET]: json(200, metrics.weight),
    })
    await renderApp(PAGE, anna)

    expect((await recommended()).slice(0, 3)).toEqual(['Вес', 'Талия', 'Бёдра'])
    expect(screen.queryByRole('list', { name: 'Убранные' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Добавить: Вес' }))

    await waitFor(() => expect(callsTo(calls, PRESET)).toHaveLength(1))
    expect(callsTo(calls, PRESET)[0].body).toEqual({ preset: 'weight' })
  })

  it('показывает отказ сервера и не сообщает о добавлении', async () => {
    mockApi({ [METRICS]: json(200, metricList()), [PRESET]: json(500, { detail: 'boom' }) })
    await renderApp(PAGE, anna)

    await userEvent.click(await screen.findByRole('button', { name: 'Добавить: Грудь' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Что-то пошло не так.')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('когда в списке все штатные виды, блока «Рекомендуемые» нет', async () => {
    const everything = { ...metricList(), available: [] }
    mockApi({ [METRICS]: json(200, everything) })
    await renderApp(PAGE, anna)

    await screen.findByLabelText('Название')
    expect(screen.queryByRole('list', { name: 'Рекомендуемые' })).not.toBeInTheDocument()
  })
})

describe('экран «+»: свой замер', () => {
  it('название и величина уходят под ключом клиента, дальше — форма замера', async () => {
    const created = { ...wrist, name: 'Мышечная масса', quantity: 'mass', unit: 'kg' } as const
    const calls = mockApi({
      [METRICS]: sequence(json(200, metricList()), json(200, metricList([...starting, created]))),
      [SAVE]: json(201, created),
    })
    await renderApp(PAGE, anna)

    await userEvent.type(await screen.findByLabelText('Название'), '  Мышечная масса ')
    await userEvent.click(screen.getByRole('radio', { name: 'Вес, кг' }))
    await create()

    expect(await screen.findByRole('heading', { name: 'Новый замер' })).toBeInTheDocument()
    expect(await screen.findByLabelText('Мышечная масса')).toBeInTheDocument()
    const [call] = callsTo(calls, SAVE)
    expect(call.body).toEqual({ name: 'Мышечная масса', quantity: 'mass' })
    expect(idOf(call.path)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab]/)
  })

  it('по умолчанию измеряется обхват; единицы — как в профиле', async () => {
    mockApi({ [METRICS]: json(200, metricList()) })
    await renderApp(PAGE, { ...anna, unit_system: 'imperial' })

    const choice = await screen.findByRole('group', { name: 'Что измеряем' })
    expect(
      within(choice)
        .getAllByRole('radio')
        .map((radio) => radio.parentElement?.textContent),
    ).toEqual(['Обхват, дюйм', 'Вес, фунт', 'Процент, %'])
    expect(within(choice).getByRole('radio', { name: 'Обхват, дюйм' })).toBeChecked()
  })

  it('проценты выбираются так же', async () => {
    const calls = mockApi({ [METRICS]: json(200, metricList()), [SAVE]: json(201, bodyFat) })
    await renderApp(PAGE, anna)

    await userEvent.type(await screen.findByLabelText('Название'), 'Вода в теле')
    await userEvent.click(screen.getByRole('radio', { name: 'Процент, %' }))
    await create()

    await screen.findByRole('heading', { name: 'Новый замер' })
    expect(callsTo(calls, SAVE)[0].body).toEqual({ name: 'Вода в теле', quantity: 'percent' })
  })

  it.each([
    ['', 'Заполните поле'],
    ['я'.repeat(41), 'Название — до 40 символов'],
  ])('название «%s» не отправляет', async (name, message) => {
    const calls = mockApi({ [METRICS]: json(200, metricList()) })
    await renderApp(PAGE, anna)

    const field = await screen.findByLabelText('Название')
    if (name) await userEvent.type(field, name)
    await create()

    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(callsTo(calls, SAVE)).toEqual([])
  })

  it('после сбоя повторная отправка идёт с тем же ключом', async () => {
    const calls = mockApi({
      [METRICS]: json(200, metricList()),
      [SAVE]: sequence(json(500, { detail: 'boom' }), json(201, wrist)),
    })
    await renderApp(PAGE, anna)

    await userEvent.type(await screen.findByLabelText('Название'), 'Запястье')
    await create()
    expect(await screen.findByRole('alert')).toHaveTextContent('Что-то пошло не так.')
    await create()

    await screen.findByRole('heading', { name: 'Новый замер' })
    const [first, second] = callsTo(calls, SAVE)
    expect(idOf(second.path)).toBe(idOf(first.path))
  })

  it('убранный свой вид возвращается кнопкой «Вернуть»', async () => {
    const removed = { ...wrist, archived: true }
    const calls = mockApi({
      [METRICS]: sequence(
        json(200, metricList([...starting, removed])),
        json(200, metricList([...starting, wrist])),
      ),
      [SAVE]: json(200, wrist),
    })
    await renderApp(PAGE, anna)

    const list = await screen.findByRole('list', { name: 'Убранные' })
    expect(within(list).getByText('Запястье')).toBeInTheDocument()
    await userEvent.click(within(list).getByRole('button', { name: 'Вернуть: Запястье' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Добавлено в список: Запястье.')
    await waitFor(() =>
      expect(screen.queryByRole('list', { name: 'Убранные' })).not.toBeInTheDocument(),
    )
    const [call] = callsTo(calls, SAVE)
    expect(call.path).toBe(`/api/metrics/${wrist.id}`)
    expect(call.body).toEqual({ name: 'Запястье', quantity: 'length' })
  })

  it('«Внести замер» ведёт к форме замера', async () => {
    mockApi({ [METRICS]: json(200, metricList()) })
    await renderApp(PAGE, anna)

    await userEvent.click(await screen.findByRole('link', { name: 'Внести замер' }))

    expect(await screen.findByRole('heading', { name: 'Новый замер' })).toBeInTheDocument()
  })
})
