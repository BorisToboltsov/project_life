import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'
import { mockApi, json, callsTo } from '@/test/api'
import { renderApp } from '@/test/app'
import { anna, metricList } from '@/test/fixtures'
import { pressureMetric, pressureReading, OWN_ID, VALUE_ID } from '@/test/health'
import { pressureCopy, pressureOffline } from '@/offline/pressure'
import { offlineState } from '@/offline/store'
import { db } from '@/offline/db'

const metrics = { metrics: [pressureMetric], available: [] }
it('давление имеет свою форму; проверяет пару, сохраняет пульс и время', async () => {
  const calls = mockApi({
    'GET /api/metrics': json(200, metrics),
    'PUT /api/blood-pressure/*': json(201, pressureReading()),
    'GET /api/blood-pressure': json(200, []),
  })
  await renderApp('/measurements/pressure/new', anna)
  await userEvent.type(await screen.findByLabelText('Верхнее'), '80')
  await userEvent.type(screen.getByLabelText('Нижнее'), '90')
  await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
  expect(await screen.findByText('Верхнее должно быть больше нижнего')).toBeVisible()
  expect(callsTo(calls, 'PUT /api/blood-pressure/*')).toHaveLength(0)
  await userEvent.clear(screen.getByLabelText('Верхнее'))
  await userEvent.type(screen.getByLabelText('Верхнее'), '135')
  await userEvent.type(screen.getByLabelText('Пульс, необязательно'), '72')
  await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
  await waitFor(() => expect(callsTo(calls, 'PUT /api/blood-pressure/*')).toHaveLength(1))
  expect(callsTo(calls, 'PUT /api/blood-pressure/*')[0]?.body).toMatchObject({
    systolic: 135,
    diastolic: 90,
    pulse: 72,
  })
})
it('показывает две линии, среднее и удаляет показание из истории', async () => {
  const calls = mockApi({
    'GET /api/metrics': json(200, metrics),
    'GET /api/blood-pressure': json(200, [
      pressureReading({ systolic: 140 }),
      pressureReading({ id: OWN_ID, systolic: 130, diastolic: 80 }),
    ]),
    'DELETE /api/blood-pressure/*': json(204),
  })
  await renderApp(`/measurements/${OWN_ID}`, anna)
  expect(await screen.findByText('135/81')).toBeVisible()
  expect(await screen.findByTestId('second')).toHaveTextContent('=80')
  const history = await screen.findByRole('list', { name: 'История' })
  const first = within(history).getAllByRole('listitem')[0]!
  expect(first).toHaveTextContent('выше 135/85')
  await userEvent.click(within(first).getByRole('button', { name: 'Удалить' }))
  await userEvent.click(within(first).getByRole('button', { name: 'Да, удалить' }))
  await waitFor(() => expect(callsTo(calls, 'DELETE /api/blood-pressure/*')).toHaveLength(1))
})
it('правка давления без сети сохраняется под тем же ключом', async () => {
  mockApi({ 'GET /api/metrics': json(200, metrics) })
  await pressureCopy.replace({ etag: null, items: [pressureReading()] })
  offlineState.setOnline(false)
  await renderApp(`/measurements/pressure/${VALUE_ID}`, anna)
  await userEvent.clear(await screen.findByLabelText('Верхнее'))
  await userEvent.type(screen.getByLabelText('Верхнее'), '140')
  await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
  await waitFor(async () => expect((await pressureOffline())[0]?.systolic).toBe(140))
  expect((await db.queue.toArray())[0]?.params.reading_id).toBe(VALUE_ID)
})
it('давление не появляется одиночным числом в общей форме замеров', async () => {
  mockApi({
    'GET /api/metrics': json(200, {
      ...metricList(),
      metrics: [...metricList().metrics, pressureMetric],
    }),
  })
  await renderApp('/measurements/new', anna)
  expect(await screen.findByRole('heading', { name: 'Новый замер' })).toBeVisible()
  expect(screen.queryByLabelText('Давление')).toBeNull()
})
it('отклонённое давление не называется тренировкой', async () => {
  mockApi({})
  await db.rejected.put({
    seq: 1,
    method: 'PUT',
    path: '/api/blood-pressure/{reading_id}',
    params: { reading_id: VALUE_ID },
    failure: 'errors.not_found',
    context: { kind: 'pressure', pressure: { systolic: 140, diastolic: 90, pulse: 72 } },
  })
  await offlineState.reload()
  await renderApp('/unsent', anna)
  expect(await screen.findByRole('region', { name: 'Давление · 140/90' })).toBeVisible()
  expect(screen.queryByRole('heading', { name: 'Тренировка' })).toBeNull()
})
