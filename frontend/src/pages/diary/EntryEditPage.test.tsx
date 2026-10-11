import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { callsTo, json, mockApi } from '@/test/api'
import { renderApp } from '@/test/app'
import { anna, cottageCheese, diaryDay, foodEntry, kefir, meals } from '@/test/fixtures'

const DATE = '2026-10-11'
const DAY = 'GET /api/diary'

describe('правка записи дневника', () => {
  it('меняет граммы и приём пищи, не трогая продукт', async () => {
    const entry = foodEntry(cottageCheese, 150)
    const save = `PUT /api/diary/entries/${entry.id}`
    const calls = mockApi({ [DAY]: json(200, diaryDay(DATE, [entry])), [save]: json(200, entry) })
    const { router } = await renderApp(`/diary/${DATE}/entries/${entry.id}`, anna)

    expect(
      await screen.findByRole('heading', { name: 'Изменить запись: Творог 5 %' }),
    ).toBeInTheDocument()
    const amount = screen.getByLabelText('Сколько, г')
    expect(amount).toHaveValue('150')
    await userEvent.clear(amount)
    await userEvent.type(amount, '200')
    await userEvent.selectOptions(screen.getByLabelText('Приём пищи'), 'Ужин')
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() => expect(router.state.location.pathname).toBe(`/diary/${DATE}`))
    expect(callsTo(calls, save)[0].body).toEqual({
      local_date: DATE,
      meal_id: meals.dinner.id,
      product_id: cottageCheese.id,
      amount: 200,
    })
  })

  describe('в дне с убранным приёмом пищи', () => {
    const archived = { ...meals.snack, archived: true }
    const drink = foodEntry(kefir, 250, { meal_id: archived.id })
    const eaten = foodEntry(cottageCheese, 150)
    const day = diaryDay(DATE, [drink, eaten], null, [meals.breakfast, meals.lunch, archived])
    const options = () =>
      [...screen.getByLabelText<HTMLSelectElement>('Приём пищи').options].map(
        (option) => option.text,
      )

    it('жидкость правится в миллилитрах и остаётся в своём убранном приёме', async () => {
      mockApi({ [DAY]: json(200, day) })
      await renderApp(`/diary/${DATE}/entries/${drink.id}`, anna)

      expect(await screen.findByLabelText('Сколько, мл')).toHaveValue('250')
      expect(options()).toEqual(['Завтрак', 'Обед', 'Перекус'])
      expect(screen.getByLabelText('Приём пищи')).toHaveValue(archived.id)
    })

    it('запись другого приёма в убранный не перенести', async () => {
      mockApi({ [DAY]: json(200, day) })
      await renderApp(`/diary/${DATE}/entries/${eaten.id}`, anna)

      expect(await screen.findByLabelText('Сколько, г')).toHaveValue('150')
      expect(options()).toEqual(['Завтрак', 'Обед'])
    })
  })

  it('запись удалённого продукта правится: продукт остаётся пустым', async () => {
    const entry = foodEntry(cottageCheese, 150, { product_id: null })
    const save = `PUT /api/diary/entries/${entry.id}`
    const calls = mockApi({ [DAY]: json(200, diaryDay(DATE, [entry])), [save]: json(200, entry) })
    await renderApp(`/diary/${DATE}/entries/${entry.id}`, anna)

    await userEvent.click(await screen.findByRole('button', { name: 'Сохранить' }))

    await waitFor(() => expect(callsTo(calls, save)).toHaveLength(1))
    expect(callsTo(calls, save)[0].body).toMatchObject({ product_id: null, amount: 150 })
  })

  it('показывает ошибку поля и отказ сервера', async () => {
    const entry = foodEntry(cottageCheese, 150)
    mockApi({
      [DAY]: json(200, diaryDay(DATE, [entry])),
      'PUT /api/diary/entries/*': json(404, { detail: 'not_found' }),
    })
    await renderApp(`/diary/${DATE}/entries/${entry.id}`, anna)

    const amount = await screen.findByLabelText('Сколько, г')
    await userEvent.clear(amount)
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(await screen.findByText('От 0,1 до 5000')).toBeInTheDocument()

    await userEvent.type(amount, '90')
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Не найдено.')
  })

  it('говорит, что записи нет, и ведёт обратно в день', async () => {
    mockApi({ [DAY]: json(200, diaryDay(DATE)) })
    await renderApp(`/diary/${DATE}/entries/0199b7a0-0000-7000-8000-00000000dead`, anna)

    expect(await screen.findByText('Такой записи нет.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'К дневнику' })).toHaveAttribute(
      'href',
      `/diary/${DATE}`,
    )
  })
})
