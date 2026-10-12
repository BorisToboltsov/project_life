import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { shiftDays, today } from '@/lib/dates'
import { callsTo, json, mockApi, sequence } from '@/test/api'
import { renderApp } from '@/test/app'
import { anna, biceps, girthOf, measurement, metricList, metrics, wrist } from '@/test/fixtures'

/** Строки истории — без пунктов меню приложения. */
const rows = async () =>
  within(await screen.findByRole('list', { name: 'История' })).findAllByRole('listitem')

const LIST = 'GET /api/measurements'
const types = { 'GET /api/metrics': json(200, metricList()) }
const WEIGHT = `/measurements/${metrics.weight.id}`
const history = [
  measurement('2026-10-05', 72.4),
  measurement('2026-10-03', 72.8),
  measurement('2026-10-01', 73),
]

describe('история показателя', () => {
  it('показывает записи новыми вперёд, а графику отдаёт их по времени вместе с трендом', async () => {
    mockApi({ ...types, [LIST]: json(200, history) })
    await renderApp(WEIGHT, anna)

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
    await renderApp(WEIGHT, anna)
    await rows()

    await userEvent.selectOptions(screen.getByLabelText('Период'), 'all')
    await rows()

    expect(callsTo(calls, LIST).map((call) => call.query)).toEqual([
      { metric_id: metrics.weight.id, from: shiftDays(today(), -90) },
      { metric_id: metrics.weight.id },
    ])
  })

  it('с одним замером вместо графика — пояснение', async () => {
    mockApi({ ...types, [LIST]: json(200, history.slice(0, 1)) })
    await renderApp(WEIGHT, anna)

    expect(await screen.findByText('График появится после второго замера.')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('с двумя замерами график есть, тренда ещё нет', async () => {
    mockApi({ ...types, [LIST]: json(200, history.slice(0, 2)) })
    await renderApp(WEIGHT, anna)

    expect(await screen.findByTestId('trend')).toHaveTextContent('нет')
  })

  it('при редких замерах тренд повторял бы точки — его не рисуют', async () => {
    const weekly = [
      measurement('2026-10-05', 72.4),
      measurement('2026-09-28', 72.8),
      measurement('2026-09-21', 73),
    ]
    mockApi({ ...types, [LIST]: json(200, weekly) })
    await renderApp(WEIGHT, anna)

    expect(await screen.findByTestId('values')).toHaveTextContent('2026-09-21=73')
    expect(screen.getByTestId('trend')).toHaveTextContent('нет')
  })

  it('без замеров говорит об этом', async () => {
    mockApi({ ...types, [LIST]: json(200, []) })
    await renderApp(`/measurements/${metrics.neck.id}`, anna)

    expect(await screen.findByText('Замеров пока нет.')).toBeInTheDocument()
  })

  it('вкладки переключают показатель', async () => {
    const calls = mockApi({ ...types, [LIST]: json(200, []) })
    await renderApp(WEIGHT, anna)

    const tabs = await screen.findByRole('navigation', { name: 'Замеры' })
    expect((await within(tabs).findAllByRole('link')).map((link) => link.textContent)).toEqual([
      'Вес',
      'Шея',
      'Талия',
      'Бёдра',
    ])
    await userEvent.click(within(tabs).getByRole('link', { name: 'Бёдра' }))

    expect(await within(tabs).findByRole('link', { name: 'Бёдра' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(callsTo(calls, LIST).at(-1)?.query.metric_id).toBe(metrics.hips.id)
  })

  it('в имперской системе значения — в фунтах', async () => {
    mockApi({ ...types, [LIST]: json(200, history.slice(0, 2)) })
    await renderApp(WEIGHT, { ...anna, unit_system: 'imperial' })

    const items = await rows()
    expect(items[0]).toHaveTextContent('159,6 фунт')
  })

  it('удаляет запись после подтверждения', async () => {
    const calls = mockApi({
      ...types,
      [LIST]: sequence(json(200, history), json(200, history.slice(1))),
      'DELETE /api/measurements/*': json(204),
    })
    await renderApp(WEIGHT, anna)

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
    await renderApp(WEIGHT, anna)

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
    await renderApp(WEIGHT, anna)

    const [first] = await rows()
    await userEvent.click(within(first).getByRole('button', { name: 'Удалить' }))
    await userEvent.click(within(first).getByRole('button', { name: 'Да, удалить' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Не найдено.')
  })

  it('раздел открывает первый вид из списка', async () => {
    mockApi({ ...types, [LIST]: json(200, []) })
    await renderApp('/measurements', anna)

    const tabs = await screen.findByRole('navigation', { name: 'Замеры' })
    expect(await within(tabs).findByRole('link', { name: 'Вес' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })
})

const METRICS = 'GET /api/metrics'
const RENAME = 'PUT /api/metrics/*'
const REMOVE = 'DELETE /api/metrics/*'
const own = [...Object.values(metrics), biceps, wrist]
const WRIST = `/measurements/${wrist.id}`
const tabNames = async () =>
  (
    await within(await screen.findByRole('navigation', { name: 'Замеры' })).findAllByRole('link')
  ).map((link) => link.textContent)

describe('список видов замеров', () => {
  // В jsdom прокрутки нет: метод появляется только на время теста, который его ждёт.
  afterEach(() => {
    Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
  })

  it('текущая вкладка прокручивается в видимую часть ряда', async () => {
    const scrolled: (string | null)[] = []
    Element.prototype.scrollIntoView = vi.fn<(this: Element) => void>(function () {
      scrolled.push(this.textContent)
    })
    mockApi({ [METRICS]: json(200, metricList(own)), [LIST]: json(200, []) })
    await renderApp(WRIST, anna)

    await waitFor(() => expect(scrolled).toEqual(['Запястье']))
    const tabs = screen.getByRole('navigation', { name: 'Замеры' })
    await userEvent.click(within(tabs).getByRole('link', { name: 'Шея' }))

    await waitFor(() => expect(scrolled).toEqual(['Запястье', 'Шея']))
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({
      block: 'nearest',
      inline: 'nearest',
    })
  })

  it('вкладки — виды из списка пользователя, убранных среди них нет', async () => {
    const list = [metrics.weight, { ...metrics.neck, archived: true }, ...own.slice(2)]
    mockApi({ [METRICS]: json(200, metricList(list)), [LIST]: json(200, []) })
    await renderApp(WEIGHT, anna)

    await screen.findByText('Замеров пока нет.')
    expect(await tabNames()).toEqual(['Вес', 'Талия', 'Бёдра', 'Бицепс', 'Запястье'])
  })

  it('история своего вида — под его названием и в его единице', async () => {
    mockApi({
      [METRICS]: json(200, metricList(own)),
      [LIST]: json(200, [girthOf(wrist, '2026-10-05', 16.5), girthOf(wrist, '2026-10-01', 16)]),
    })
    await renderApp(WRIST, anna)

    expect((await rows()).map((row) => row.textContent)).toEqual([
      '16,5 см05/10/2026',
      '16 см01/10/2026',
    ])
    expect(await screen.findByRole('img', { name: 'График: Запястье' })).toBeInTheDocument()
  })

  it('когда вес убран, раздел открывает следующий вид', async () => {
    const list = [{ ...metrics.weight, archived: true }, ...own.slice(1)]
    mockApi({ [METRICS]: json(200, metricList(list)), [LIST]: json(200, []) })
    await renderApp('/measurements', anna)

    const tabs = await screen.findByRole('navigation', { name: 'Замеры' })
    expect(await within(tabs).findByRole('link', { name: 'Шея' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  it('когда список пуст, раздел предлагает добавить замер', async () => {
    const list = Object.values(metrics).map((metric) => ({ ...metric, archived: true }))
    mockApi({ [METRICS]: json(200, metricList(list)) })
    await renderApp('/measurements', anna)

    expect(await screen.findByText('В списке нет ни одного замера.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('link', { name: 'Добавить свой замер' }))
    expect(await screen.findByRole('heading', { name: 'Свой замер' })).toBeInTheDocument()
  })

  it.each([
    ['незнакомый ключ', '0199b7a0-0000-7000-8000-ffffffffffff', Object.values(metrics)],
    ['убранный вид', metrics.neck.id, [metrics.weight, { ...metrics.neck, archived: true }]],
  ])('%s в адресе — пояснение, вкладки остаются', async (_, id, list) => {
    const calls = mockApi({ [METRICS]: json(200, metricList(list)), [LIST]: json(200, []) })
    await renderApp(`/measurements/${id}`, anna)

    expect(await screen.findByText('Такого замера в списке нет.')).toBeInTheDocument()
    expect(await tabNames()).toContain('Вес')
    expect(screen.queryByRole('list', { name: 'История' })).not.toBeInTheDocument()
    expect(callsTo(calls, LIST)).toEqual([])
  })

  it('убирает вид из списка после подтверждения и открывает первый из оставшихся', async () => {
    const calls = mockApi({
      [METRICS]: sequence(
        json(200, metricList(own)),
        json(200, metricList([...own.slice(0, -1), { ...wrist, archived: true }])),
      ),
      [LIST]: json(200, [girthOf(wrist, '2026-10-05', 16.5)]),
      [REMOVE]: json(204),
    })
    await renderApp(WRIST, anna)

    await userEvent.click(await screen.findByRole('button', { name: 'Убрать из списка' }))
    expect(
      screen.getByText('Убрать «Запястье» из списка? Внесённые замеры сохранятся.'),
    ).toBeInTheDocument()
    expect(callsTo(calls, REMOVE)).toEqual([])
    await userEvent.click(screen.getByRole('button', { name: 'Да, убрать' }))

    await waitFor(async () => expect(await tabNames()).not.toContain('Запястье'))
    expect(callsTo(calls, REMOVE).map((call) => call.path)).toEqual([`/api/metrics/${wrist.id}`])
    const tabs = screen.getByRole('navigation', { name: 'Замеры' })
    expect(await within(tabs).findByRole('link', { name: 'Вес' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  it('штатный вид тоже убирается', async () => {
    const calls = mockApi({
      [METRICS]: sequence(
        json(200, metricList()),
        json(200, metricList([{ ...metrics.weight, archived: true }, metrics.neck])),
      ),
      [LIST]: json(200, []),
      [REMOVE]: json(204),
    })
    await renderApp(WEIGHT, anna)

    await userEvent.click(await screen.findByRole('button', { name: 'Убрать из списка' }))
    expect(screen.getByText(/Убрать «Вес» из списка\?/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Да, убрать' }))

    await waitFor(async () => expect(await tabNames()).toEqual(['Шея']))
    expect(callsTo(calls, REMOVE)[0].path).toBe(`/api/metrics/${metrics.weight.id}`)
  })

  it('от удаления из списка можно отказаться', async () => {
    const calls = mockApi({ [METRICS]: json(200, metricList(own)), [LIST]: json(200, []) })
    await renderApp(WRIST, anna)

    await userEvent.click(await screen.findByRole('button', { name: 'Убрать из списка' }))
    await userEvent.click(screen.getByRole('button', { name: 'Отмена' }))

    expect(screen.getByRole('button', { name: 'Убрать из списка' })).toBeInTheDocument()
    expect(callsTo(calls, REMOVE)).toEqual([])
  })

  it('показывает отказ сервера, когда вид не убрался', async () => {
    mockApi({
      [METRICS]: json(200, metricList(own)),
      [LIST]: json(200, []),
      [REMOVE]: json(404, { detail: 'not_found' }),
    })
    await renderApp(WRIST, anna)

    await userEvent.click(await screen.findByRole('button', { name: 'Убрать из списка' }))
    await userEvent.click(screen.getByRole('button', { name: 'Да, убрать' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Не найдено.')
    expect(await tabNames()).toContain('Запястье')
  })

  it('свой вид переименовывается на месте', async () => {
    const renamed = { ...wrist, name: 'Запястье правое' }
    const calls = mockApi({
      [METRICS]: sequence(
        json(200, metricList(own)),
        json(200, metricList([...own.slice(0, -1), renamed])),
      ),
      [LIST]: json(200, []),
      [RENAME]: json(200, renamed),
    })
    await renderApp(WRIST, anna)

    await userEvent.click(await screen.findByRole('button', { name: 'Переименовать' }))
    const name = screen.getByLabelText('Название')
    expect(name).toHaveValue('Запястье')
    await userEvent.type(name, ' правое')
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(async () => expect(await tabNames()).toContain('Запястье правое'))
    const [call] = callsTo(calls, RENAME)
    expect(call.path).toBe(`/api/metrics/${wrist.id}`)
    expect(call.body).toEqual({ name: 'Запястье правое', quantity: 'length' })
    expect(screen.queryByLabelText('Название')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Переименовать' })).toBeInTheDocument()
  })

  it('пустое название не отправляет, «Отмена» закрывает форму', async () => {
    const calls = mockApi({ [METRICS]: json(200, metricList(own)), [LIST]: json(200, []) })
    await renderApp(WRIST, anna)

    await userEvent.click(await screen.findByRole('button', { name: 'Переименовать' }))
    await userEvent.clear(screen.getByLabelText('Название'))
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    expect(await screen.findByText('Заполните поле')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Отмена' }))
    expect(screen.queryByLabelText('Название')).not.toBeInTheDocument()
    expect(callsTo(calls, RENAME)).toEqual([])
  })

  it('показывает отказ сервера при переименовании', async () => {
    mockApi({
      [METRICS]: json(200, metricList(own)),
      [LIST]: json(200, []),
      [RENAME]: json(404, { detail: 'not_found' }),
    })
    await renderApp(WRIST, anna)

    await userEvent.click(await screen.findByRole('button', { name: 'Переименовать' }))
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Не найдено.')
    expect(screen.getByLabelText('Название')).toBeInTheDocument()
  })

  it('штатный вид переименовать нельзя: его название подбирает интерфейс', async () => {
    mockApi({ [METRICS]: json(200, metricList(own)), [LIST]: json(200, []) })
    await renderApp(`/measurements/${biceps.id}`, anna)

    expect(await screen.findByRole('button', { name: 'Убрать из списка' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Переименовать' })).not.toBeInTheDocument()
  })
})
