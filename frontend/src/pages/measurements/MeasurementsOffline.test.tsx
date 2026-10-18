import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { shiftDays, today } from '@/lib/dates'
import { copy } from '@/offline/copy'
import { db } from '@/offline/db'
import { MEASUREMENT_COPY, type MeasurementsCopy } from '@/offline/measurements'
import { offlineState } from '@/offline/store'
import { callsTo, json, mockApi } from '@/test/api'
import { renderApp } from '@/test/app'
import { anna, measurement, metricList, metrics, summaryOf, wrist } from '@/test/fixtures'

const date = today()
const lastWeek = measurement(shiftDays(date, -7), 72.8)
const longAgo = measurement(shiftDays(date, -800), 80)
const WEIGHT = `/measurements/${metrics.weight.id}`

/** Копия, какой её оставил прошлый сеанс со связью: вся история замеров. */
async function seedCopy(list = metricList()) {
  await copy.put(MEASUREMENT_COPY.metrics, list)
  await copy.put(MEASUREMENT_COPY.all, {
    etag: '"1"',
    items: [lastWeek, longAgo],
  } satisfies MeasurementsCopy)
}

function cutNetwork() {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
  )
  offlineState.setOnline(false)
}

const rows = async () =>
  within(await screen.findByRole('list', { name: 'История' })).findAllByRole('listitem')

const pendingMark = { name: 'Ещё не отправлено' }

describe('замеры без сети', () => {
  it('новый замер виден на главной с отметкой и уходит, когда связь вернулась', async () => {
    await seedCopy()
    cutNetwork()
    const { router } = await renderApp('/measurements/new', anna)

    // Виды замеров без сети не заводятся (ADR 0020).
    await screen.findByLabelText('Вес')
    expect(screen.queryByRole('link', { name: 'Добавить свой замер' })).toBeNull()
    await userEvent.type(screen.getByLabelText('Вес'), '72,4')
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    const tile = await screen.findByRole('link', { name: /^Вес/ })
    await waitFor(() => expect(tile).toHaveTextContent('72,4 кг'))
    expect(within(tile).getByRole('img', pendingMark)).toBeInTheDocument()
    expect(tile).toHaveTextContent('-0,4 кг')
    expect(screen.queryByRole('link', { name: 'Свой замер' })).toBeNull()
    expect(await db.queue.count()).toBe(1)

    const calls = mockApi({
      'GET /api/health': json(200, { status: 'ok', version: '0.10.3' }),
      'PUT /api/measurements/*': json(201, {}),
      'GET /api/metrics': json(200, metricList()),
      'GET /api/measurements/summary': json(200, summaryOf({})),
    })
    act(() => {
      window.dispatchEvent(new Event('online'))
    })

    await waitFor(() => expect(callsTo(calls, 'PUT /api/measurements/*')).toHaveLength(1))
    expect(callsTo(calls, 'PUT /api/measurements/*')[0]!.body).toMatchObject({
      metric_id: metrics.weight.id,
      value: 72.4,
      unit: 'kg',
      local_date: date,
    })
    await waitFor(async () => expect(await db.queue.count()).toBe(0))
  })

  it('история и график — за любой период, замер правится и удаляется', async () => {
    await seedCopy()
    cutNetwork()
    await renderApp(WEIGHT, anna)

    expect((await rows()).map((row) => row.textContent)).toEqual([
      `72,8 кг${lastWeek.local_date.split('-').reverse().join('/')}`,
    ])
    await userEvent.selectOptions(screen.getByLabelText('Период'), 'all')
    await waitFor(async () => expect(await rows()).toHaveLength(2))
    expect(await screen.findByTestId('values')).toHaveTextContent(
      `${longAgo.local_date}=80 ${lastWeek.local_date}=72.8`,
    )
    // Список видов без сети не меняется: действий с видом нет.
    expect(screen.queryByRole('button', { name: 'Убрать из списка' })).toBeNull()

    const [first] = await rows()
    await userEvent.click(within(first!).getByRole('link', { name: 'Изменить' }))
    const value = await screen.findByLabelText('Значение')
    await userEvent.clear(value)
    await userEvent.type(value, '72,6')
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(async () => expect((await rows())[0]).toHaveTextContent('72,6 кг'))
    expect(within((await rows())[0]!).getByRole('img', pendingMark)).toBeInTheDocument()

    await userEvent.selectOptions(screen.getByLabelText('Период'), 'all')
    await waitFor(async () => expect(await rows()).toHaveLength(2))
    const second = (await rows())[1]!
    await userEvent.click(within(second).getByRole('button', { name: 'Удалить' }))
    await userEvent.click(within(second).getByRole('button', { name: 'Да, удалить' }))
    await waitFor(async () => expect(await rows()).toHaveLength(1))

    expect((await db.queue.toArray()).map((change) => change.method)).toEqual(['PUT', 'DELETE'])
  })

  it('свой вид переименовать и убрать без сети нельзя, экран добавления ждёт связи', async () => {
    await seedCopy(metricList([...Object.values(metrics), wrist]))
    cutNetwork()
    const { router } = await renderApp(`/measurements/${wrist.id}`, anna)

    expect(await screen.findByText('Замеров пока нет.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Переименовать' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Убрать из списка' })).toBeNull()

    await act(() => router.navigate({ to: '/measurements/metrics/new' }))
    expect(
      await screen.findByText(
        'Список замеров меняется при связи — экран откроется, когда она вернётся.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Добавить:/ })).toBeNull()
  })
})

describe('не отправленный замер', () => {
  it('на экране «Не отправлено» — вид, значение и дата; «Убрать» стирает его', async () => {
    await seedCopy()
    await db.rejected.put({
      seq: 4,
      method: 'PUT',
      path: '/api/measurements/{measurement_id}',
      params: { measurement_id: '0199b7a0-0000-7000-8000-0000000000f1' },
      body: { metric_id: metrics.weight.id, value: 72.4, unit: 'kg', local_date: date },
      context: {
        kind: 'measurement',
        localDate: date,
        measurement: { metricId: metrics.weight.id, value: 72.4, unit: 'kg' },
      },
      failure: 'errors.unknown',
    })
    await offlineState.reload()
    mockApi({ 'GET /api/metrics': json(200, metricList()) })
    await renderApp('/unsent', anna)

    const row = await screen.findByRole('region', { name: 'Вес · 72,4 кг' })
    expect(row).toHaveTextContent(date.split('-').reverse().join('/'))
    await userEvent.click(within(row).getByRole('button', { name: 'Убрать' }))

    await waitFor(async () => expect(await db.rejected.count()).toBe(0))
    expect(await screen.findByText(/дошло до сервера/)).toBeInTheDocument()
  })
})
