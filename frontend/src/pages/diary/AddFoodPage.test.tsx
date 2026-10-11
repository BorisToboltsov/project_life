import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { callsTo, json, mockApi } from '@/test/api'
import { renderApp } from '@/test/app'
import { anna, cottageCheese, oatmeal } from '@/test/fixtures'

const DATE = '2026-10-11'
const PAGE = `/diary/${DATE}/add/breakfast`
const SUGGESTIONS = 'GET /api/diary/suggestions'
const SEARCH = 'GET /api/products'
const SAVE = 'PUT /api/diary/entries/*'
const UUID7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

const suggestions = {
  frequent: [{ ...cottageCheese, amount_g: 180 }],
  recent: [
    { ...oatmeal, amount_g: 60 },
    { ...cottageCheese, amount_g: 180 },
  ],
}
const nothing = { frequent: [], recent: [] }

describe('добавление в приём пищи', () => {
  it('предлагает частые и недавние продукты с прошлой граммовкой', async () => {
    const calls = mockApi({ [SUGGESTIONS]: json(200, suggestions), [SAVE]: json(201, {}) })
    await renderApp(PAGE, anna)

    expect(await screen.findByRole('heading', { name: 'Завтрак, 11/10/2026' })).toBeInTheDocument()
    const frequent = await screen.findByRole('list', { name: 'Частые' })
    expect(
      within(frequent).getByText('121 ккал · Б 17,2 · Ж 5 · У 1,8 на 100 г'),
    ).toBeInTheDocument()
    expect(
      within(screen.getByRole('list', { name: 'Недавние' })).getAllByRole('listitem'),
    ).toHaveLength(2)

    // Раскрывается одна строка — та, что нажата, хотя творог есть в обоих списках.
    await userEvent.click(within(frequent).getByRole('button', { name: /Творог/ }))
    expect(screen.getAllByLabelText('Сколько, г')).toHaveLength(1)
    expect(screen.getByLabelText('Сколько, г')).toHaveValue('180')
    await userEvent.click(screen.getByRole('button', { name: 'Добавить' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Добавлено: Творог 5 %, 180 г')
    const [saved] = callsTo(calls, SAVE)
    expect(saved.path.split('/').at(-1)).toMatch(UUID7)
    expect(saved.body).toEqual({
      local_date: DATE,
      meal: 'breakfast',
      product_id: cottageCheese.id,
      amount_g: 180,
    })
    // Форма закрылась: можно выбирать следующий продукт.
    expect(screen.queryByLabelText('Сколько, г')).not.toBeInTheDocument()
  })

  it('ищет по каталогу и вносит найденное с введённой граммовкой', async () => {
    const calls = mockApi({
      [SUGGESTIONS]: json(200, nothing),
      [SEARCH]: (call) => json(200, call.query.q === 'овс' ? [oatmeal] : [])(call),
      [SAVE]: json(201, {}),
    })
    await renderApp(PAGE, anna)
    expect(
      await screen.findByText('Введите название продукта. Если его нет в каталоге — создайте.'),
    ).toBeInTheDocument()

    await userEvent.type(screen.getByLabelText('Поиск продукта'), 'овс')
    await userEvent.click(await screen.findByRole('button', { name: /Овсяные хлопья/ }))
    const amount = screen.getByLabelText('Сколько, г')
    expect(amount).toHaveValue('100')
    await userEvent.clear(amount)
    await userEvent.type(amount, '62,5')
    await userEvent.click(screen.getByRole('button', { name: 'Добавить' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Добавлено: Овсяные хлопья, 62,5 г')
    expect(callsTo(calls, SAVE)[0].body).toMatchObject({ product_id: oatmeal.id, amount_g: 62.5 })
    // Поиск очищен — снова видны подсказки.
    expect(screen.getByLabelText('Поиск продукта')).toHaveValue('')
  })

  it('говорит, когда ничего не найдено', async () => {
    mockApi({ [SUGGESTIONS]: json(200, suggestions), [SEARCH]: json(200, []) })
    await renderApp(PAGE, anna)

    await userEvent.type(await screen.findByLabelText('Поиск продукта'), 'кефир')

    expect(await screen.findByText('Ничего не найдено.')).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Частые' })).not.toBeInTheDocument()
  })

  it('не принимает граммовку вне диапазона', async () => {
    const calls = mockApi({ [SUGGESTIONS]: json(200, suggestions) })
    await renderApp(PAGE, anna)

    await userEvent.click(await screen.findByRole('button', { name: /Овсяные хлопья/ }))
    await userEvent.clear(screen.getByLabelText('Сколько, г'))
    await userEvent.type(screen.getByLabelText('Сколько, г'), '0')
    await userEvent.click(screen.getByRole('button', { name: 'Добавить' }))

    expect(await screen.findByText('От 0,1 до 5000 г')).toBeInTheDocument()
    expect(callsTo(calls, SAVE)).toEqual([])
  })

  it('после отказа повторная отправка идёт с тем же ключом записи', async () => {
    const calls = mockApi({
      [SUGGESTIONS]: json(200, suggestions),
      [SAVE]: json(404, { detail: 'product_not_found' }),
    })
    await renderApp(PAGE, anna)

    await userEvent.click(await screen.findByRole('button', { name: /Овсяные хлопья/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Добавить' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Этого продукта больше нет в каталоге.',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Добавить' }))

    await waitFor(() => expect(callsTo(calls, SAVE)).toHaveLength(2))
    const [first, second] = callsTo(calls, SAVE)
    expect(second.path).toBe(first.path)
  })

  it('кнопка «Готово» возвращает в день', async () => {
    mockApi({ [SUGGESTIONS]: json(200, nothing) })
    await renderApp(PAGE, anna)

    expect(await screen.findByRole('link', { name: 'Готово' })).toHaveAttribute(
      'href',
      `/diary/${DATE}`,
    )
  })
})

describe('новый продукт по пути в приём пищи', () => {
  it('создаёт продукт и возвращает к вводу граммов для него', async () => {
    const created = { ...oatmeal, editable: true }
    // Продукт попадает в «недавние», когда запись с ним сохранена.
    let logged = false
    const calls = mockApi({
      [SUGGESTIONS]: (call) =>
        json(
          200,
          logged ? { frequent: [], recent: [{ ...created, amount_g: 100 }] } : nothing,
        )(call),
      'PUT /api/products/*': json(201, created),
      'GET /api/products/*': json(200, created),
      [SAVE]: (call) => {
        logged = true
        return json(201, {})(call)
      },
    })
    const { router } = await renderApp(PAGE, anna)

    await userEvent.click(await screen.findByRole('link', { name: 'Создать продукт' }))
    await userEvent.type(await screen.findByLabelText('Название'), 'Овсяные хлопья')
    await userEvent.type(screen.getByLabelText('Калории, ккал'), '352')
    await userEvent.type(screen.getByLabelText('Белки, г'), '12,3')
    await userEvent.type(screen.getByLabelText('Жиры, г'), '6,2')
    await userEvent.type(screen.getByLabelText('Углеводы, г'), '61,8')
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    const list = await screen.findByRole('list', { name: 'Только что создан' })
    const [saved] = callsTo(calls, 'PUT /api/products/*')
    const id = saved.path.split('/').at(-1)
    expect(id).toMatch(UUID7)
    expect(saved.body).toEqual({
      name: 'Овсяные хлопья',
      kcal: 352,
      protein_g: 12.3,
      fat_g: 6.2,
      carbs_g: 61.8,
    })
    expect(router.state.location.search).toEqual({ product: id })
    expect(callsTo(calls, `GET /api/products/${id}`)).toHaveLength(1)

    // Форма граммов уже открыта: осталось ввести и добавить.
    expect(within(list).getByLabelText('Сколько, г')).toHaveValue('100')
    await userEvent.click(within(list).getByRole('button', { name: 'Добавить' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Добавлено: Овсяные хлопья, 100 г')
    // Внесённый продукт переехал в «недавние» и отдельно больше не показывается.
    expect(await screen.findByRole('list', { name: 'Недавние' })).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Только что создан' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Сколько, г')).not.toBeInTheDocument()
  })

  it('«Отмена» возвращает к выбору продукта', async () => {
    mockApi({ [SUGGESTIONS]: json(200, nothing) })
    await renderApp(`${PAGE}/new`, anna)

    await userEvent.click(await screen.findByRole('link', { name: 'Отмена' }))

    expect(await screen.findByLabelText('Поиск продукта')).toBeInTheDocument()
  })
})
