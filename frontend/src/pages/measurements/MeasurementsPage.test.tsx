import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { shiftDays, today } from '@/lib/dates'
import { callsTo, json, mockApi, sequence } from '@/test/api'
import { renderApp } from '@/test/app'
import { anna, measurement, metricTypes } from '@/test/fixtures'

/** Строки истории — без пунктов меню приложения. */
const rows = async () =>
  within(await screen.findByRole('list', { name: 'История' })).findAllByRole('listitem')

const LIST = 'GET /api/measurements'
const types = { 'GET /api/metric-types': json(200, metricTypes) }
const history = [
  measurement('2026-10-05', 72.4),
  measurement('2026-10-03', 72.8),
  measurement('2026-10-01', 73),
]

describe('история показателя', () => {
  it('показывает записи новыми вперёд, а графику отдаёт их по времени вместе с трендом', async () => {
    mockApi({ ...types, [LIST]: json(200, history) })
    await renderApp('/measurements/weight', anna)

    const items = await rows()
    expect(items.map((row) => row.textContent)).toEqual([
      '72,4 кг05/10/2026',
      '72,8 кг03/10/2026',
      '73 кг01/10/2026',
    ])
    expect(await screen.findByTestId('values')).toHaveTextContent(
      '2026-10-01=73 2026-10-03=72.8 2026-10-05=72.4',
    )
    expect(screen.getByTestId('trend')).toHaveTextContent('73 72.9 72.73')
    expect(screen.getByTestId('sample')).toHaveTextContent('72,4 кг')
    expect(screen.getByRole('img', { name: 'График: Вес' })).toBeInTheDocument()
  })

  it('по умолчанию запрашивает 90 дней, «всё время» — без ограничения', async () => {
    const calls = mockApi({ ...types, [LIST]: json(200, history) })
    await renderApp('/measurements/weight', anna)
    await rows()

    await userEvent.selectOptions(screen.getByLabelText('Период'), 'all')
    await rows()

    expect(callsTo(calls, LIST).map((call) => call.query)).toEqual([
      { metric: 'weight', from: shiftDays(today(), -90) },
      { metric: 'weight' },
    ])
  })

  it('с одним замером вместо графика — пояснение', async () => {
    mockApi({ ...types, [LIST]: json(200, history.slice(0, 1)) })
    await renderApp('/measurements/weight', anna)

    expect(await screen.findByText('График появится после второго замера.')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('с двумя замерами график есть, тренда ещё нет', async () => {
    mockApi({ ...types, [LIST]: json(200, history.slice(0, 2)) })
    await renderApp('/measurements/weight', anna)

    expect(await screen.findByTestId('trend')).toHaveTextContent('нет')
  })

  it('при редких замерах тренд повторял бы точки — его не рисуют', async () => {
    const weekly = [
      measurement('2026-10-05', 72.4),
      measurement('2026-09-28', 72.8),
      measurement('2026-09-21', 73),
    ]
    mockApi({ ...types, [LIST]: json(200, weekly) })
    await renderApp('/measurements/weight', anna)

    expect(await screen.findByTestId('values')).toHaveTextContent('2026-09-21=73')
    expect(screen.getByTestId('trend')).toHaveTextContent('нет')
  })

  it('без замеров говорит об этом', async () => {
    mockApi({ ...types, [LIST]: json(200, []) })
    await renderApp('/measurements/neck', anna)

    expect(await screen.findByText('Замеров пока нет.')).toBeInTheDocument()
  })

  it('вкладки переключают показатель', async () => {
    const calls = mockApi({ ...types, [LIST]: json(200, []) })
    await renderApp('/measurements/weight', anna)

    const tabs = await screen.findByRole('navigation', { name: 'Замеры' })
    expect(
      within(tabs)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Вес', 'Шея', 'Талия', 'Бёдра'])
    await userEvent.click(within(tabs).getByRole('link', { name: 'Бёдра' }))

    expect(await within(tabs).findByRole('link', { name: 'Бёдра' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(callsTo(calls, LIST).at(-1)?.query.metric).toBe('hips')
  })

  it('в имперской системе значения — в фунтах', async () => {
    mockApi({ ...types, [LIST]: json(200, history.slice(0, 2)) })
    await renderApp('/measurements/weight', { ...anna, unit_system: 'imperial' })

    const items = await rows()
    expect(items[0]).toHaveTextContent('159,6 фунт')
  })

  it('удаляет запись после подтверждения', async () => {
    const calls = mockApi({
      ...types,
      [LIST]: sequence(json(200, history), json(200, history.slice(1))),
      'DELETE /api/measurements/*': json(204),
    })
    await renderApp('/measurements/weight', anna)

    const [first] = await rows()
    await userEvent.click(within(first).getByRole('button', { name: 'Удалить' }))
    expect(within(first).getByText('Удалить замер?')).toBeInTheDocument()
    expect(callsTo(calls, 'DELETE /api/measurements/*')).toEqual([])
    await userEvent.click(within(first).getByRole('button', { name: 'Да, удалить' }))

    await waitFor(async () => expect(await rows()).toHaveLength(2))
    expect(callsTo(calls, 'DELETE /api/measurements/*')[0].path).toBe(
      `/api/measurements/${history[0].id}`,
    )
  })

  it('от удаления можно отказаться', async () => {
    const calls = mockApi({ ...types, [LIST]: json(200, history) })
    await renderApp('/measurements/weight', anna)

    const [first] = await rows()
    await userEvent.click(within(first).getByRole('button', { name: 'Удалить' }))
    await userEvent.click(within(first).getByRole('button', { name: 'Отмена' }))

    expect(within(first).getByRole('button', { name: 'Удалить' })).toBeInTheDocument()
    expect(callsTo(calls, 'DELETE /api/measurements/*')).toEqual([])
  })

  it('показывает отказ сервера при удалении', async () => {
    mockApi({
      ...types,
      [LIST]: json(200, history),
      'DELETE /api/measurements/*': json(404, { detail: 'not_found' }),
    })
    await renderApp('/measurements/weight', anna)

    const [first] = await rows()
    await userEvent.click(within(first).getByRole('button', { name: 'Удалить' }))
    await userEvent.click(within(first).getByRole('button', { name: 'Да, удалить' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Не найдено.')
  })

  it.each(['/measurements', '/measurements/biceps'])('%s ведёт на вес', async (path) => {
    mockApi({ ...types, [LIST]: json(200, []) })
    await renderApp(path, anna)

    const tabs = await screen.findByRole('navigation', { name: 'Замеры' })
    expect(within(tabs).getByRole('link', { name: 'Вес' })).toHaveAttribute('aria-current', 'page')
  })
})
