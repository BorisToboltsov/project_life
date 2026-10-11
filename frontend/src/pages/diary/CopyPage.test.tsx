import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { callsTo, json, mockApi } from '@/test/api'
import { renderApp } from '@/test/app'
import { anna, cottageCheese, diaryDay, foodEntry, oatmeal } from '@/test/fixtures'

const DATE = '2026-10-11'
const DAY = 'GET /api/diary'
const COPY = 'POST /api/diary/copy'
const UUID7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

const porridge = foodEntry(oatmeal, 60)
const cheese = foodEntry(cottageCheese, 150)
const supper = foodEntry(cottageCheese, 200, { meal: 'dinner' })

/** Вчера внесены завтрак и ужин; остальные дни пусты. */
function days() {
  return mockApi({
    [DAY]: (call) =>
      json(
        200,
        diaryDay(
          call.query.date,
          call.query.date === '2026-10-10' ? [porridge, cheese, supper] : [],
        ),
      )(call),
    [COPY]: json(204),
  })
}

describe('копирование', () => {
  it('копирует вчерашний приём пищи в открытый день', async () => {
    const calls = days()
    const { router } = await renderApp(`/diary/${DATE}/copy/breakfast`, anna)

    expect(await screen.findByRole('heading', { name: 'Скопировать: Завтрак' })).toBeInTheDocument()
    expect(screen.getByText('Записи появятся в дне 11/10/2026.')).toBeInTheDocument()
    expect(screen.getByLabelText('Из какого дня')).toHaveValue('10/10/2026')
    const rows = await within(
      screen.getByRole('list', { name: 'Будут скопированы' }),
    ).findAllByRole('listitem')
    expect(rows.map((row) => row.textContent)).toEqual([
      'Овсяные хлопьяЗавтрак · 60 г · 211 ккал',
      'Творог 5 %Завтрак · 150 г · 182 ккал',
    ])

    await userEvent.click(screen.getByRole('button', { name: 'Скопировать' }))

    await waitFor(() => expect(router.state.location.pathname).toBe(`/diary/${DATE}`))
    const body = callsTo(calls, COPY)[0].body as {
      to_date: string
      to_meal: string | null
      items: { source_id: string; id: string }[]
    }
    expect(body.to_date).toBe(DATE)
    expect(body.to_meal).toBe('breakfast')
    expect(body.items.map((item) => item.source_id)).toEqual([porridge.id, cheese.id])
    for (const item of body.items) expect(item.id).toMatch(UUID7)
  })

  it('копирует весь день, оставляя записи в своих приёмах пищи', async () => {
    const calls = days()
    await renderApp(`/diary/${DATE}/copy/day`, anna)

    expect(
      await screen.findByRole('heading', { name: 'Скопировать: весь день' }),
    ).toBeInTheDocument()
    expect(await screen.findByText('Ужин · 200 г · 242 ккал')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Скопировать' }))

    await waitFor(() => expect(callsTo(calls, COPY)).toHaveLength(1))
    expect(callsTo(calls, COPY)[0].body).toMatchObject({ to_date: DATE, to_meal: null })
    expect((callsTo(calls, COPY)[0].body as { items: unknown[] }).items).toHaveLength(3)
  })

  it('из пустого дня копировать нечего; день можно выбрать другой', async () => {
    days()
    await renderApp(`/diary/${DATE}/copy/lunch`, anna)

    expect(await screen.findByText('В этот день ничего не внесено.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Скопировать' })).toBeDisabled()

    // Обеда не было и девятого; недописанная дата ничего не запрашивает.
    const field = screen.getByLabelText('Из какого дня')
    await userEvent.clear(field)
    expect(screen.queryByText('В этот день ничего не внесено.')).not.toBeInTheDocument()
    await userEvent.type(field, '09102026')
    expect(await screen.findByText('В этот день ничего не внесено.')).toBeInTheDocument()
  })

  it('после отказа повторяет копирование с теми же ключами', async () => {
    const calls = mockApi({
      [DAY]: json(200, diaryDay('2026-10-10', [porridge])),
      [COPY]: json(404, { detail: 'not_found' }),
    })
    await renderApp(`/diary/${DATE}/copy/breakfast`, anna)

    await userEvent.click(await screen.findByRole('button', { name: 'Скопировать' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Не найдено.')
    await userEvent.click(screen.getByRole('button', { name: 'Скопировать' }))

    await waitFor(() => expect(callsTo(calls, COPY)).toHaveLength(2))
    expect(callsTo(calls, COPY)[1].body).toEqual(callsTo(calls, COPY)[0].body)
  })
})
