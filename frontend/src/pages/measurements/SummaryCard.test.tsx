import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { json, mockApi } from '@/test/api'
import { renderApp } from '@/test/app'
import {
  anna,
  biceps,
  girthOf,
  measurement,
  metricList,
  metrics,
  summaryOf,
  wrist,
} from '@/test/fixtures'

const summary = summaryOf({
  [metrics.weight.id]: [measurement('2026-10-05', 72.4), measurement('2026-10-03', 72.8)],
  [metrics.waist.id]: [girthOf(metrics.waist, '2026-10-04', 86)],
})
const routes = {
  'GET /api/metrics': json(200, metricList()),
  'GET /api/measurements/summary': json(200, summary),
}

describe('замеры на главной', () => {
  it('показывает последнее значение, дату и изменение к предыдущему', async () => {
    mockApi(routes)
    await renderApp('/', anna)

    const weight = await screen.findByRole('link', { name: /Вес/ })
    expect(weight).toHaveTextContent('72,4 кг')
    expect(weight).toHaveTextContent('05/10/2026 · -0,4 кг')
    const waist = screen.getByRole('link', { name: /Талия/ })
    expect(waist).toHaveTextContent('86 см')
    expect(waist).toHaveTextContent('04/10/2026')
    expect(waist).not.toHaveTextContent('·')
    expect(screen.getByRole('link', { name: /Шея/ })).toHaveTextContent('Нет замеров')
  })

  it('в имперской системе пересчитывает в фунты и дюймы', async () => {
    mockApi(routes)
    await renderApp('/', { ...anna, unit_system: 'imperial' })

    expect(await screen.findByRole('link', { name: /Вес/ })).toHaveTextContent('159,6 фунт')
    expect(screen.getByRole('link', { name: /Талия/ })).toHaveTextContent('33,9 дюйм')
  })

  it('до формы нового замера — одно нажатие', async () => {
    mockApi(routes)
    await renderApp('/', anna)

    await userEvent.click(await screen.findByRole('link', { name: 'Внести замер' }))

    expect(await screen.findByRole('heading', { name: 'Новый замер' })).toBeInTheDocument()
  })

  it('плитка ведёт к истории своего показателя', async () => {
    mockApi({ ...routes, 'GET /api/measurements': json(200, []) })
    await renderApp('/', anna)

    await userEvent.click(await screen.findByRole('link', { name: /Талия/ }))

    const tabs = await screen.findByRole('navigation', { name: 'Замеры' })
    expect(within(tabs).getByRole('link', { name: 'Талия' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  it('свои и рекомендуемые виды стоят плитками после начальных, убранных среди них нет', async () => {
    const list = [
      metrics.weight,
      { ...metrics.neck, archived: true },
      metrics.waist,
      metrics.hips,
      biceps,
      wrist,
    ]
    mockApi({
      'GET /api/metrics': json(200, metricList(list)),
      'GET /api/measurements/summary': json(
        200,
        summaryOf(
          {
            [metrics.neck.id]: [girthOf(metrics.neck, '2026-10-01', 38)],
            [wrist.id]: [girthOf(wrist, '2026-10-05', 16.5), girthOf(wrist, '2026-10-01', 16)],
          },
          list,
        ),
      ),
    })
    await renderApp('/', anna)

    const tile = await screen.findByRole('link', { name: /Запястье/ })
    expect(tile).toHaveTextContent('16,5 см')
    expect(tile).toHaveTextContent('05/10/2026 · +0,5 см')
    expect(screen.getByRole('link', { name: /Бицепс/ })).toHaveTextContent('Нет замеров')
    expect(screen.queryByRole('link', { name: /Шея/ })).not.toBeInTheDocument()
    const card = tile.parentElement!
    expect(
      within(card)
        .getAllByRole('link')
        .map((link) => link.textContent.replace(/[0-9].*|Нет замеров/, '')),
    ).toEqual(['Вес', 'Талия', 'Бёдра', 'Бицепс', 'Запястье', 'Свой замер'])
  })

  it('последняя плитка — «+»: ведёт к добавлению своего замера', async () => {
    mockApi(routes)
    await renderApp('/', anna)

    await userEvent.click(await screen.findByRole('link', { name: 'Свой замер' }))

    expect(await screen.findByRole('heading', { name: 'Свой замер' })).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Рекомендуемые' })).toBeInTheDocument()
  })
})
