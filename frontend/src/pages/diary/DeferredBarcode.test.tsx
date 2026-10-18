import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { today } from '@/lib/dates'
import { copy } from '@/offline/copy'
import { db, type Deferred } from '@/offline/db'
import { type CatalogCopy, DIARY_COPY } from '@/offline/diary'
import { offlineState } from '@/offline/store'
import { callsTo, json, mockApi } from '@/test/api'
import { renderApp } from '@/test/app'
import { anna, dailyGoal, diaryDay, meals } from '@/test/fixtures'

const date = today()
const barcode = '4601000000012'
const id = '0199b7a0-0000-7000-8000-0000000000f1'
// Творог в пачке: упаковка — 180 г.
const curd = {
  id: '0199b7a0-0000-7000-8000-0000000000d7',
  name: 'Творог 5 % в пачке',
  unit: 'g' as const,
  kcal: 121,
  protein_g: 17.2,
  fat_g: 5,
  carbs_g: 1.8,
  sugars_g: null,
  saturated_fat_g: null,
  fiber_g: null,
  salt_g: null,
  serving_size: null,
  package_size: 180,
  barcode,
  source: 'open_food_facts' as const,
  editable: true,
}

async function seedDay(products: CatalogCopy['products'] = []) {
  await copy.put(DIARY_COPY.catalog, { etag: '"1"', products } satisfies CatalogCopy)
  await copy.put(DIARY_COPY.day(date), diaryDay(date, [], dailyGoal))
}

function cutNetwork() {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
  )
  offlineState.setOnline(false)
}

async function defer(status: Deferred['status'], extra: Partial<Deferred> = {}) {
  await db.deferred.put({
    id,
    barcode,
    localDate: date,
    mealId: meals.lunch.id,
    amount: { packages: 1 },
    status,
    createdAt: 1,
    ...extra,
  })
  await offlineState.reload()
}

describe('незнакомый штрихкод без сети', () => {
  it('записывается с количеством и стоит в приёме пищи пунктирной строкой', async () => {
    await seedDay()
    cutNetwork()
    const { router } = await renderApp(`/diary/${date}/add/${meals.lunch.id}/scan`, anna)

    await userEvent.type(await screen.findByLabelText('Штрихкод цифрами'), barcode)
    await userEvent.click(screen.getByRole('button', { name: 'Найти' }))
    expect(
      await screen.findByText(
        `Штрихкода ${barcode} на телефоне нет. Запишем его — продукт найдём, когда вернётся связь.`,
      ),
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('radio', { name: 'Граммы или мл' }))
    await userEvent.type(screen.getByLabelText('Сколько граммов или миллилитров'), '0')
    await userEvent.click(screen.getByRole('button', { name: 'Записать до сети' }))
    expect(screen.getByText('Проверьте количество.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('radio', { name: 'Упаковки' }))
    await userEvent.click(screen.getByRole('button', { name: 'Записать до сети' }))

    await waitFor(() => expect(router.state.location.pathname).toBe(`/diary/${date}`))
    const lunch = await screen.findByRole('list', { name: 'Обед' })
    expect(within(lunch).getByText(barcode)).toBeInTheDocument()
    expect(within(lunch).getByText('Упаковки: 1 · Состав придёт с сетью')).toBeInTheDocument()
    expect(screen.getByText('В итог не вошло записей по штрихкоду: 1')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Нет сети · ждут отправки: 1')
    expect(await db.deferred.count()).toBe(1)
  })
})

describe('найденный по штрихкоду продукт', () => {
  it('ищется сам, когда связь есть, и вносится только после «Внести»', async () => {
    await seedDay()
    await defer('waiting')
    const calls = mockApi({
      'POST /api/products/lookup': json(200, { status: 'found', barcode, product: curd }),
      [`GET /api/products/${curd.id}`]: json(200, curd),
      'GET /api/diary': json(200, diaryDay(date, [], dailyGoal)),
      'PUT /api/diary/entries/*': json(201, {}),
    })
    await renderApp(`/diary/${date}`, anna)

    const offer = await screen.findByRole('listitem', { name: 'Найден по штрихкоду' })
    expect(await within(offer).findByText('Творог 5 % в пачке')).toBeInTheDocument()
    expect(within(offer).getByText(/1 упаковка · 180 г · 218 ккал/)).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Найдено по штрихкоду: 1 — подтвердите')
    expect(callsTo(calls, 'PUT /api/diary/entries/*')).toHaveLength(0)

    await userEvent.click(within(offer).getByRole('button', { name: 'Внести' }))

    await waitFor(() => expect(callsTo(calls, 'PUT /api/diary/entries/*')).toHaveLength(1))
    const [entry] = callsTo(calls, 'PUT /api/diary/entries/*')
    expect(entry!.path).toBe(`/api/diary/entries/${id}`)
    expect(entry!.body).toEqual({
      local_date: date,
      meal_id: meals.lunch.id,
      product_id: curd.id,
      portion: { kind: 'package', count: 1 },
    })
    await waitFor(async () => expect(await db.deferred.count()).toBe(0))
  })

  it('«Не то» — убрать запись', async () => {
    await seedDay([curd])
    await defer('found', { productId: curd.id })
    mockApi({
      [`GET /api/products/${curd.id}`]: json(200, curd),
      'GET /api/diary': json(200, diaryDay(date, [], dailyGoal)),
    })
    await renderApp(`/diary/${date}`, anna)

    const offer = await screen.findByRole('listitem', { name: 'Найден по штрихкоду' })
    await userEvent.click(within(offer).getByRole('button', { name: 'Не то' }))
    expect(within(offer).getByRole('link', { name: 'Исправить продукт' })).toHaveAttribute(
      'href',
      `/diary/${date}/barcode/${id}`,
    )
    await userEvent.click(within(offer).getByRole('button', { name: 'Убрать запись' }))

    await waitFor(() =>
      expect(screen.queryByRole('listitem', { name: 'Найден по штрихкоду' })).toBeNull(),
    )
    expect(await db.deferred.count()).toBe(0)
  })
})

describe('штрихкод не нашёлся', () => {
  it('продукт заполняют с упаковки, и запись вносится сразу', async () => {
    await seedDay()
    await defer('missing', {
      amount: { units: 150 },
      missing: { status: 'not_found', draft: null },
    })
    const calls = mockApi({
      'GET /api/diary': json(200, diaryDay(date, [], dailyGoal)),
      'PUT /api/products/*': (call) =>
        json(201, { ...curd, id: call.path.split('/').at(-1) })(call),
      'PUT /api/diary/entries/*': json(201, {}),
    })
    const { router } = await renderApp('/unsent', anna)

    const row = await screen.findByRole('region', { name: `Штрихкод ${barcode}` })
    expect(
      within(row).getByText('Штрихкод не найден ни в каталоге, ни в Open Food Facts.'),
    ).toBeInTheDocument()
    await userEvent.click(within(row).getByRole('link', { name: 'Заполнить продукт' }))
    await userEvent.type(await screen.findByLabelText('Название'), 'Творог')
    await userEvent.type(screen.getByLabelText('Калории, ккал'), '121')
    await userEvent.type(screen.getByLabelText('Белки, г'), '17,2')
    await userEvent.type(screen.getByLabelText('Жиры, г'), '5')
    await userEvent.type(screen.getByLabelText('Углеводы, г'), '1,8')
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() => expect(callsTo(calls, 'PUT /api/diary/entries/*')).toHaveLength(1))
    expect(callsTo(calls, 'PUT /api/products/*')[0]!.body).toMatchObject({ barcode })
    expect(callsTo(calls, 'PUT /api/diary/entries/*')[0]!.body).toMatchObject({
      meal_id: meals.lunch.id,
      amount: 150,
    })
    await waitFor(() => expect(router.state.location.pathname).toBe(`/diary/${date}`))
    expect(await db.deferred.count()).toBe(0)
  })

  it('Open Food Facts не ответил — штрихкод можно записать и найти позже', async () => {
    await seedDay()
    mockApi({
      'POST /api/products/lookup': json(200, { status: 'unavailable', barcode }),
    })
    await renderApp(`/diary/${date}/add/${meals.lunch.id}/scan`, anna)

    await userEvent.type(await screen.findByLabelText('Штрихкод цифрами'), barcode)
    await userEvent.click(screen.getByRole('button', { name: 'Найти' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Записать и найти позже' }))

    expect(await screen.findByRole('button', { name: 'Записать до сети' })).toBeInTheDocument()
  })
})
