import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { shiftDays, today } from '@/lib/dates'
import { copy } from '@/offline/copy'
import { db } from '@/offline/db'
import { type CatalogCopy, DIARY_COPY } from '@/offline/diary'
import { offlineState } from '@/offline/store'
import { callsTo, json, mockApi } from '@/test/api'
import { renderApp } from '@/test/app'
import {
  anna,
  cottageCheese,
  dailyGoal,
  diaryDay,
  foodEntry,
  meals,
  oatmeal,
  suggestionOf,
} from '@/test/fixtures'

const date = today()
const barcoded = { ...cottageCheese, barcode: '4600000000008' }

/** Копия, какой её оставил прошлый сеанс со связью. */
async function seedCopy() {
  await copy.put(DIARY_COPY.catalog, {
    etag: '"1"',
    products: [oatmeal, barcoded],
  } satisfies CatalogCopy)
  await copy.put(DIARY_COPY.day(date), diaryDay(date, [foodEntry(oatmeal, 50)], dailyGoal))
  await copy.put(DIARY_COPY.goal, dailyGoal)
  await copy.put(DIARY_COPY.suggestions(meals.breakfast.id), {
    in_meal: [],
    recent: [suggestionOf(oatmeal, 50)],
    frequent: [],
  })
}

function cutNetwork() {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
  )
  offlineState.setOnline(false)
}

const ADD = `/diary/${date}/add/${meals.breakfast.id}`

describe('дневник без сети', () => {
  it('запись из каталога на телефоне видна в дне с отметкой и уходит, когда связь вернулась', async () => {
    await seedCopy()
    cutNetwork()
    await renderApp(ADD, anna)

    await userEvent.type(await screen.findByLabelText('Поиск продукта'), 'творог')
    await userEvent.click(await screen.findByRole('button', { name: /Творог 5 %/ }))
    // Что требует сети, без неё не показывается (ADR 0020).
    expect(screen.queryByRole('button', { name: 'Искать в Open Food Facts' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Создать продукт' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Создать блюдо' })).toBeNull()
    const amount = await screen.findByLabelText('Сколько, г')
    await userEvent.clear(amount)
    await userEvent.type(amount, '150')
    await userEvent.click(screen.getByRole('button', { name: 'Добавить' }))
    expect(await screen.findByText('Добавлено: Творог 5 %, 150 г')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('link', { name: 'Готово' }))
    const row = (await screen.findByText('Творог 5 %')).closest('li')!
    expect(within(row).getByRole('img', { name: 'Ещё не отправлено' })).toBeInTheDocument()
    // Итог дня — по правилам сервера: 176 ккал овсянки и 181,5 творога, на экране — целыми.
    expect(document.body.textContent).toMatch(/358\sиз\s2\s100\sккал/)

    const calls = mockApi({
      'GET /api/health': json(200, { status: 'ok', version: '0.10.1' }),
      'PUT /api/diary/entries/*': json(201, {}),
      'GET /api/diary': json(200, diaryDay(date, [foodEntry(oatmeal, 50)], dailyGoal)),
    })
    act(() => {
      window.dispatchEvent(new Event('online'))
    })

    await waitFor(() => expect(callsTo(calls, 'PUT /api/diary/entries/*')).toHaveLength(1))
    expect(callsTo(calls, 'PUT /api/diary/entries/*')[0]!.body).toEqual({
      local_date: date,
      meal_id: meals.breakfast.id,
      product_id: cottageCheese.id,
      amount: 150,
    })
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
  })

  it('порция воды встаёт в очередь и видна с отметкой', async () => {
    await seedCopy()
    cutNetwork()
    await renderApp(`/diary/${date}`, anna)

    const [add] = await screen.findAllByRole('button', { name: /^Добавить \d+ мл$/ })
    await userEvent.click(add!)

    const portions = await screen.findByRole('list', { name: 'Порции за день' })
    expect(within(portions).getByRole('img', { name: 'Ещё не отправлено' })).toBeInTheDocument()
    expect(await db.queue.count()).toBe(1)
  })

  it('старый день вне копии не открывается, будущий — пустым', async () => {
    await seedCopy()
    cutNetwork()
    const { router } = await renderApp(`/diary/${shiftDays(date, -30)}`, anna)

    expect(await screen.findByText('Этот день не сохранён на телефоне')).toBeInTheDocument()

    await act(() => router.navigate({ to: '/diary/$date', params: { date: shiftDays(date, 1) } }))
    expect(await screen.findByText('Завтрак')).toBeInTheDocument()
    expect(screen.queryByText('Этот день не сохранён на телефоне')).toBeNull()
  })

  it('сканер находит знакомый штрихкод в каталоге на телефоне', async () => {
    await seedCopy()
    cutNetwork()
    const { router } = await renderApp(`${ADD}/scan`, anna)

    await userEvent.type(await screen.findByLabelText('Штрихкод цифрами'), barcoded.barcode)
    await userEvent.click(screen.getByRole('button', { name: 'Найти' }))

    await waitFor(() => expect(router.state.location.search).toEqual({ scanned: barcoded.id }))
    expect(await screen.findByRole('list', { name: 'По штрихкоду' })).toHaveTextContent(
      'Творог 5 %',
    )
  })

  it('статистика без сети ждёт связи', async () => {
    cutNetwork()
    await renderApp(`/diary/stats?date=${date}&period=week`, anna)

    expect(
      await screen.findByText('Статистику считает сервер — она откроется, когда вернётся связь.'),
    ).toBeInTheDocument()
  })
})

describe('не отправленная запись дневника', () => {
  it('«Выбрать продукт» ведёт в приём пищи, и новая запись заменяет отклонённую', async () => {
    await seedCopy()
    await db.rejected.put({
      seq: 3,
      method: 'PUT',
      path: '/api/diary/entries/{entry_id}',
      params: { entry_id: '0199b7a0-0000-7000-8000-0000000000e9' },
      body: { local_date: date, meal_id: meals.breakfast.id, product_id: 'gone', amount: 200 },
      context: {
        kind: 'entry',
        localDate: date,
        food: {
          productName: 'Сырок',
          amount: 200,
          unit: 'g',
          portion: null,
          mealId: meals.breakfast.id,
        },
      },
      failure: 'errors.product_not_found',
    })
    await offlineState.reload()
    const calls = mockApi({
      'GET /api/diary': json(200, diaryDay(date, [], dailyGoal)),
      'GET /api/diary/suggestions': json(200, {
        in_meal: [],
        recent: [suggestionOf(oatmeal, 50)],
        frequent: [],
      }),
      'PUT /api/diary/entries/*': json(201, {}),
    })
    const { router } = await renderApp('/unsent', anna)

    const row = await screen.findByRole('region', { name: 'Сырок' })
    expect(within(row).getByText('Этого продукта больше нет в каталоге.')).toBeInTheDocument()
    await userEvent.click(within(row).getByRole('link', { name: 'Выбрать продукт' }))
    expect(router.state.location.search).toEqual({ replaces: 3 })

    await userEvent.click(await screen.findByRole('button', { name: /Овсяные хлопья/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Добавить' }))

    await waitFor(() => expect(callsTo(calls, 'PUT /api/diary/entries/*')).toHaveLength(1))
    await waitFor(async () => expect(await db.rejected.count()).toBe(0))
  })
})
