import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { localDateToIso, today } from '@/lib/dates'
import { callsTo, json, mockApi, sequence } from '@/test/api'
import { renderApp } from '@/test/app'
import { anna, measurement, metricTypes, summaryOf } from '@/test/fixtures'

const SAVE = 'PUT /api/measurements/*'
const base = {
  'GET /api/metric-types': json(200, metricTypes),
  'GET /api/measurements/summary': json(200, summaryOf({})),
}
const save = () => userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
const idOf = (path: string) => path.split('/').at(-1)!

describe('новый замер', () => {
  it('сохраняет только заполненные показатели и возвращает на главную', async () => {
    const calls = mockApi({ ...base, [SAVE]: json(201, measurement(today(), 72.4)) })
    await renderApp('/measurements/new', anna)

    await userEvent.type(await screen.findByLabelText('Вес'), '72,4')
    await userEvent.type(screen.getByLabelText('Талия'), '86')
    await save()

    expect(await screen.findByRole('heading', { name: 'Здравствуйте, Анна!' })).toBeInTheDocument()
    const saved = callsTo(calls, SAVE)
    expect(saved.map((call) => call.body)).toEqual([
      expect.objectContaining({ metric: 'weight', value: 72.4, unit: 'kg', local_date: today() }),
      expect.objectContaining({ metric: 'waist', value: 86, unit: 'cm', local_date: today() }),
    ])
    for (const call of saved) {
      expect(idOf(call.path)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab]/)
      const { measured_at } = call.body as { measured_at: string }
      expect(Math.abs(Date.now() - Date.parse(measured_at))).toBeLessThan(60_000)
    }
    expect(new Set(saved.map((call) => idOf(call.path))).size).toBe(2)
  })

  it('у каждого показателя — анимированная подсказка и пояснение, как мерить', async () => {
    mockApi(base)
    const { container } = await renderApp('/measurements/new', anna)

    await screen.findByLabelText('Вес')
    expect(container.querySelectorAll('svg.illus')).toHaveLength(4)
    expect(
      screen.getByText('Ноги вместе. Лента горизонтально, чуть ниже ягодиц.'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Лента на уровне пупка, на спокойном выдохе. Живот не втягивайте.'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Лента горизонтально, сразу под кадыком. Не затягивайте.'),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Вес')).toHaveAccessibleDescription(/Встаньте на весы/)
  })

  it('в имперской системе значения вводятся в фунтах и дюймах', async () => {
    const calls = mockApi({ ...base, [SAVE]: json(201, measurement(today(), 75)) })
    await renderApp('/measurements/new', { ...anna, unit_system: 'imperial' })

    await userEvent.type(await screen.findByLabelText('Вес'), '165.4')
    await userEvent.type(screen.getByLabelText('Шея'), '15.5')
    await save()

    await screen.findByRole('heading', { name: 'Здравствуйте, Анна!' })
    expect(callsTo(calls, SAVE).map((call) => call.body)).toEqual([
      expect.objectContaining({ metric: 'weight', value: 165.4, unit: 'lb' }),
      expect.objectContaining({ metric: 'neck', value: 15.5, unit: 'in' }),
    ])
  })

  it('замер задним числом получает местный полдень выбранного дня', async () => {
    const calls = mockApi({ ...base, [SAVE]: json(201, measurement('2020-01-15', 70)) })
    await renderApp('/measurements/new', anna)

    const date = await screen.findByLabelText('Дата')
    expect(date).toHaveValue(today().split('-').reverse().join('/'))
    await userEvent.clear(date)
    await userEvent.type(date, '15012020')
    await userEvent.type(screen.getByLabelText('Вес'), '70')
    await save()

    await screen.findByRole('heading', { name: 'Здравствуйте, Анна!' })
    const body = callsTo(calls, SAVE)[0].body as { measured_at: string; local_date: string }
    expect(body.local_date).toBe('2020-01-15')
    expect(localDateToIso(new Date(body.measured_at))).toBe('2020-01-15')
    expect(new Date(body.measured_at).getHours()).toBe(12)
  })

  it('пустую форму не отправляет', async () => {
    const calls = mockApi(base)
    await renderApp('/measurements/new', anna)

    await screen.findByLabelText('Вес')
    await save()

    expect(await screen.findByRole('alert')).toHaveTextContent('Введите хотя бы одно значение')
    expect(callsTo(calls, SAVE)).toEqual([])
  })

  it('не отправляет значение вне диапазона и не-число', async () => {
    const calls = mockApi(base)
    await renderApp('/measurements/new', anna)

    await userEvent.type(await screen.findByLabelText('Вес'), '700')
    await userEvent.type(screen.getByLabelText('Шея'), 'сорок')
    await save()

    expect(await screen.findByText('Значение вне допустимого диапазона')).toBeInTheDocument()
    expect(screen.getByText('Введите число')).toBeInTheDocument()
    expect(callsTo(calls, SAVE)).toEqual([])
  })

  it('после сбоя повторная отправка идёт с теми же ключами записей', async () => {
    const calls = mockApi({
      ...base,
      [SAVE]: sequence(json(500, { detail: 'boom' }), json(201, measurement(today(), 72.4))),
    })
    await renderApp('/measurements/new', anna)

    await userEvent.type(await screen.findByLabelText('Вес'), '72,4')
    await save()
    expect(await screen.findByRole('alert')).toHaveTextContent('Что-то пошло не так.')
    await save()

    await screen.findByRole('heading', { name: 'Здравствуйте, Анна!' })
    const [first, second] = callsTo(calls, SAVE)
    expect(idOf(second.path)).toBe(idOf(first.path))
  })
})
