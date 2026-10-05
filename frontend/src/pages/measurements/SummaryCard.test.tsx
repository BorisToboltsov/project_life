import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { json, mockApi } from '@/test/api'
import { renderApp } from '@/test/app'
import { anna, measurement, metricTypes, summaryOf } from '@/test/fixtures'

const summary = summaryOf({
  weight: [measurement('2026-10-05', 72.4), measurement('2026-10-03', 72.8)],
  waist: [measurement('2026-10-04', 86, { metric: 'waist', unit: 'cm', original_unit: 'cm' })],
})
const routes = {
  'GET /api/metric-types': json(200, metricTypes),
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
})
