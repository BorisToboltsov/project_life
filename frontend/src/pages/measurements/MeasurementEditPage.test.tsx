import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { localDateToIso } from '@/lib/dates'
import { callsTo, json, mockApi } from '@/test/api'
import { renderApp } from '@/test/app'
import { anna, measurement, metricList, metrics, wrist } from '@/test/fixtures'

const LIST = 'GET /api/measurements'
const SAVE = 'PUT /api/measurements/*'
const item = measurement('2026-10-03', 72.8)
const routes = {
  'GET /api/metrics': json(200, metricList()),
  [LIST]: json(200, [measurement('2026-10-05', 72.4), item]),
}
const WEIGHT = `/measurements/${metrics.weight.id}`
const save = () => userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

describe('правка замера', () => {
  it('открывается из истории с прежними значениями', async () => {
    mockApi(routes)
    await renderApp(WEIGHT, anna)

    const rows = await within(await screen.findByRole('list', { name: 'История' })).findAllByRole(
      'listitem',
    )
    await userEvent.click(within(rows[1]).getByRole('link', { name: 'Изменить' }))

    expect(await screen.findByRole('heading', { name: 'Изменить замер: Вес' })).toBeInTheDocument()
    expect(screen.getByLabelText('Значение')).toHaveValue('72.8')
    expect(screen.getByLabelText('Дата')).toHaveValue('03/10/2026')
  })

  it('сохраняет под тем же ключом; момент измерения при прежней дате не меняется', async () => {
    const calls = mockApi({ ...routes, [SAVE]: json(200, { ...item, value: 72.5 }) })
    await renderApp(`${WEIGHT}/${item.id}`, anna)

    const value = await screen.findByLabelText('Значение')
    await userEvent.clear(value)
    await userEvent.type(value, '72,5')
    await save()

    expect(await screen.findByRole('navigation', { name: 'Замеры' })).toBeInTheDocument()
    const [call] = callsTo(calls, SAVE)
    expect(call.path).toBe(`/api/measurements/${item.id}`)
    expect(call.body).toEqual({
      metric_id: metrics.weight.id,
      value: 72.5,
      unit: 'kg',
      measured_at: item.measured_at,
      local_date: '2026-10-03',
    })
  })

  it('при смене даты момент измерения — полдень нового дня', async () => {
    const calls = mockApi({ ...routes, [SAVE]: json(200, item) })
    await renderApp(`${WEIGHT}/${item.id}`, anna)

    const date = await screen.findByLabelText('Дата')
    await userEvent.clear(date)
    await userEvent.type(date, '01102026')
    await save()

    await screen.findByRole('navigation', { name: 'Замеры' })
    const body = callsTo(calls, SAVE)[0].body as { measured_at: string; local_date: string }
    expect(body.local_date).toBe('2026-10-01')
    expect(localDateToIso(new Date(body.measured_at))).toBe('2026-10-01')
  })

  it('в имперской системе значение показывается и уходит в фунтах', async () => {
    const calls = mockApi({ ...routes, [SAVE]: json(200, item) })
    await renderApp(`${WEIGHT}/${item.id}`, { ...anna, unit_system: 'imperial' })

    const value = await screen.findByLabelText('Значение')
    expect(value).toHaveValue('160.5')
    await userEvent.clear(value)
    await userEvent.type(value, '160')
    await save()

    await screen.findByRole('navigation', { name: 'Замеры' })
    expect(callsTo(calls, SAVE)[0].body).toMatchObject({ value: 160, unit: 'lb' })
  })

  it('пустое значение не отправляет', async () => {
    const calls = mockApi(routes)
    await renderApp(`${WEIGHT}/${item.id}`, anna)

    await userEvent.clear(await screen.findByLabelText('Значение'))
    await save()

    expect(await screen.findByText('Заполните поле')).toBeInTheDocument()
    expect(callsTo(calls, SAVE)).toEqual([])
  })

  it('показывает отказ сервера', async () => {
    mockApi({ ...routes, [SAVE]: json(404, { detail: 'not_found' }) })
    await renderApp(`${WEIGHT}/${item.id}`, anna)

    await screen.findByLabelText('Значение')
    await save()

    expect(await screen.findByRole('alert')).toHaveTextContent('Не найдено.')
  })

  it('«Отмена» возвращает к истории', async () => {
    mockApi(routes)
    await renderApp(`${WEIGHT}/${item.id}`, anna)

    await userEvent.click(await screen.findByRole('link', { name: 'Отмена' }))

    expect(await screen.findByRole('navigation', { name: 'Замеры' })).toBeInTheDocument()
  })

  it('несуществующий замер — пояснение и путь назад', async () => {
    mockApi(routes)
    await renderApp(`${WEIGHT}/0199b7a0-0000-7000-8000-ffffffffffff`, anna)

    expect(await screen.findByText('Такого замера нет.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('link', { name: 'К истории' }))
    expect(await screen.findByRole('navigation', { name: 'Замеры' })).toBeInTheDocument()
  })

  it('замер своего вида правится под его названием и в его единице', async () => {
    const reading = measurement('2026-10-03', 16.5, {
      metric_id: wrist.id,
      unit: 'cm',
      original_unit: 'cm',
    })
    const calls = mockApi({
      'GET /api/metrics': json(200, metricList([...Object.values(metrics), wrist])),
      [LIST]: json(200, [reading]),
      [SAVE]: json(200, reading),
    })
    await renderApp(`/measurements/${wrist.id}/${reading.id}`, anna)

    expect(
      await screen.findByRole('heading', { name: 'Изменить замер: Запястье' }),
    ).toBeInTheDocument()
    const value = screen.getByLabelText('Значение')
    await userEvent.clear(value)
    await userEvent.type(value, '17')
    await save()

    await screen.findByRole('navigation', { name: 'Замеры' })
    expect(callsTo(calls, SAVE)[0].body).toMatchObject({
      metric_id: wrist.id,
      value: 17,
      unit: 'cm',
    })
  })

  it('незнакомый вид замера — то же пояснение', async () => {
    mockApi(routes)
    await renderApp(`/measurements/${wrist.id}/${item.id}`, anna)

    expect(await screen.findByText('Такого замера нет.')).toBeInTheDocument()
  })
})
