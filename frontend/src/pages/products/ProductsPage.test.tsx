import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { callsTo, json, mockApi, page, sequence } from '@/test/api'
import { renderApp } from '@/test/app'
import {
  anna,
  cottageCheese,
  egg,
  kefir,
  noLabel,
  noPortions,
  oatmeal,
  outsideOf,
} from '@/test/fixtures'

const SEARCH = 'GET /api/products'
const OUTSIDE = 'GET /api/products/external'
const LOOKUP = 'POST /api/products/lookup'

const yogurt = {
  barcode: '4600000000008',
  name: 'Йогурт натуральный',
  unit: 'g' as const,
  kcal: 68,
  protein_g: 5,
  fat_g: 3.2,
  carbs_g: 4.7,
}
const granola = { ...yogurt, barcode: '46012340', name: 'Гранола', kcal: null }
const UUID7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('каталог продуктов', () => {
  it('показывает продукты с составом и ищет по названию', async () => {
    const calls = mockApi({
      [SEARCH]: (call) =>
        json(200, call.query.q === 'твор' ? [cottageCheese] : [oatmeal, cottageCheese])(call),
    })
    await renderApp('/products', anna)

    const list = await screen.findByRole('list', { name: 'Каталог продуктов' })
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(2))
    expect(within(list).getByRole('link', { name: /Овсяные хлопья/ })).toHaveAttribute(
      'href',
      `/products/${oatmeal.id}`,
    )
    expect(
      within(list).getByText('352 ккал · Б 12,3 · Ж 6,2 · У 61,8 на 100 г'),
    ).toBeInTheDocument()

    await userEvent.type(screen.getByLabelText('Поиск'), 'твор')

    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(1))
    expect(callsTo(calls, SEARCH).at(-1)?.query).toEqual({ q: 'твор', offset: '0' })
  })

  it('различает пустой каталог и пустой результат поиска', async () => {
    mockApi({ [SEARCH]: json(200, []) })
    await renderApp('/products', anna)

    expect(await screen.findByText('В каталоге пока пусто.')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Поиск'), 'кефир')
    expect(await screen.findByText('Ничего не найдено.')).toBeInTheDocument()
  })

  it('каталог приходит страницами: остальное — по «Показать ещё»', async () => {
    const calls = mockApi({
      [SEARCH]: (call) =>
        (call.query.offset === '0'
          ? page([kefir, oatmeal], 20)
          : json(200, [oatmeal, cottageCheese]))(call),
    })
    await renderApp('/products', anna)

    const list = await screen.findByRole('list', { name: 'Каталог продуктов' })
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(2))
    await userEvent.click(screen.getByRole('button', { name: 'Показать ещё' }))

    // Продукт, попавший на обе страницы, — каталог успел измениться — показан один раз.
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(3))
    expect(callsTo(calls, SEARCH).map((call) => call.query)).toEqual([
      { q: '', offset: '0' },
      { q: '', offset: '20' },
    ])
    expect(screen.queryByRole('button', { name: 'Показать ещё' })).not.toBeInTheDocument()
    // Без текста искать в Open Food Facts нечего.
    expect(
      screen.queryByRole('button', { name: 'Искать в Open Food Facts' }),
    ).not.toBeInTheDocument()
  })

  it('по кнопке ищет в Open Food Facts отдельной секцией и листает её', async () => {
    const calls = mockApi({
      [SEARCH]: json(200, [cottageCheese]),
      [OUTSIDE]: (call) =>
        json(200, call.query.page === '1' ? outsideOf([yogurt], 2) : outsideOf([granola]))(call),
    })
    await renderApp('/products', anna)

    await userEvent.type(await screen.findByLabelText('Поиск'), 'йо')
    // Свой каталог ищется при наборе, Open Food Facts — только по кнопке.
    expect(await screen.findByRole('heading', { name: 'В каталоге' })).toBeInTheDocument()
    expect(callsTo(calls, OUTSIDE)).toEqual([])
    await userEvent.click(screen.getByRole('button', { name: 'Искать в Open Food Facts' }))

    const outside = await screen.findByRole('list', { name: 'Open Food Facts' })
    expect(screen.getByRole('heading', { name: 'Open Food Facts' })).toBeInTheDocument()
    expect(within(outside).getAllByRole('listitem')).toHaveLength(1)
    await userEvent.click(screen.getByRole('button', { name: 'Показать ещё' }))
    await waitFor(() => expect(within(outside).getAllByRole('listitem')).toHaveLength(2))
    expect(within(outside).getByRole('button', { name: /Гранола/ })).toHaveTextContent(
      'Состав неполный',
    )
    expect(callsTo(calls, OUTSIDE).map((call) => call.query)).toEqual([
      { q: 'йо', page: '1' },
      { q: 'йо', page: '2' },
    ])
    expect(screen.queryByRole('button', { name: 'Показать ещё' })).not.toBeInTheDocument()

    // Новый текст — новая просьба: прежняя выдача убрана, наружу без кнопки ничего не ушло.
    await userEvent.type(screen.getByLabelText('Поиск'), 'г')
    expect(screen.queryByRole('list', { name: 'Open Food Facts' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Искать в Open Food Facts' })).toBeInTheDocument()
    expect(callsTo(calls, OUTSIDE)).toHaveLength(2)
  })

  it('выбранный в Open Food Facts продукт берётся в каталог и открывается', async () => {
    const imported = {
      ...cottageCheese,
      ...yogurt,
      id: '0199b7a0-0000-7000-8000-0000000000c9',
      source: 'open_food_facts' as const,
    }
    const calls = mockApi({
      [SEARCH]: json(200, []),
      [OUTSIDE]: json(200, outsideOf([yogurt])),
      [LOOKUP]: json(200, { status: 'found', barcode: yogurt.barcode, product: imported }),
      'GET /api/products/*': json(200, imported),
    })
    const { router } = await renderApp('/products', anna)

    await userEvent.type(await screen.findByLabelText('Поиск'), 'йогурт')
    await userEvent.click(await screen.findByRole('button', { name: 'Искать в Open Food Facts' }))
    await userEvent.click(await screen.findByRole('button', { name: /Йогурт натуральный/ }))

    await waitFor(() => expect(router.state.location.pathname).toBe(`/products/${imported.id}`))
    expect(callsTo(calls, LOOKUP)[0].body).toEqual({ barcode: yogurt.barcode })
    // Продукт теперь свой: открылась его карточка с пометкой об источнике.
    expect(await screen.findByLabelText('Название')).toHaveValue('Йогурт натуральный')
    expect(screen.getByText(/Состав взят из Open Food Facts/)).toBeInTheDocument()
  })

  it('неполный продукт из Open Food Facts дополняют в форме и возвращаются в каталог', async () => {
    const draft = { ...granola, name: 'Гранола, Стенд', carbs_g: null, ...noLabel, fiber_g: 7 }
    const calls = mockApi({
      [SEARCH]: json(200, []),
      [OUTSIDE]: json(200, outsideOf([granola])),
      [LOOKUP]: json(200, { status: 'draft', barcode: granola.barcode, draft }),
      'PUT /api/products/*': json(201, cottageCheese),
    })
    await renderApp('/products', anna)

    await userEvent.type(await screen.findByLabelText('Поиск'), 'гранола')
    await userEvent.click(await screen.findByRole('button', { name: 'Искать в Open Food Facts' }))
    await userEvent.click(await screen.findByRole('button', { name: /Гранола/ }))

    expect(await screen.findByRole('status')).toHaveTextContent(
      `Продукт ${granola.barcode} есть в Open Food Facts, но состав там неполный.`,
    )
    // Что знает запрос по штрихкоду, важнее того, что было в выдаче поиска.
    expect(screen.getByLabelText('Название')).toHaveValue('Гранола, Стенд')
    expect(screen.getByLabelText('Клетчатка, г')).toHaveValue('7')
    expect(screen.getByLabelText('Углеводы, г')).toHaveValue('')
    await userEvent.type(screen.getByLabelText('Углеводы, г'), '60')
    // Калорий источник не знает — посчитаны по БЖУ: 5 × 4 + 3,2 × 9 + 60 × 4.
    expect(screen.getByLabelText('Калории, ккал')).toHaveValue('288.8')
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    expect(await screen.findByLabelText('Поиск')).toBeInTheDocument()
    expect(callsTo(calls, 'PUT /api/products/*')[0].body).toMatchObject({
      barcode: granola.barcode,
      fiber_g: 7,
    })
  })

  it('Open Food Facts не отвечает — поиск можно повторить', async () => {
    const calls = mockApi({
      [SEARCH]: json(200, []),
      [OUTSIDE]: sequence(
        json(200, { status: 'unavailable', items: [], next_page: null }),
        json(429, { detail: 'too_many_attempts' }),
        json(200, outsideOf([])),
      ),
    })
    await renderApp('/products', anna)

    await userEvent.type(await screen.findByLabelText('Поиск'), 'йогурт')
    await userEvent.click(await screen.findByRole('button', { name: 'Искать в Open Food Facts' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Open Food Facts не отвечает. Попробуйте позже.',
    )

    // Свой предел обращений наружу — тоже причина попробовать позже.
    await userEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(await screen.findByText(/Слишком много попыток/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(await screen.findByText('В Open Food Facts ничего не нашлось.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Повторить' })).not.toBeInTheDocument()
    expect(callsTo(calls, OUTSIDE)).toHaveLength(3)
  })

  it('отказ при выборе продукта остаётся на экране; выбрать можно снова', async () => {
    const calls = mockApi({
      [SEARCH]: json(200, []),
      [OUTSIDE]: json(200, outsideOf([yogurt])),
      [LOOKUP]: json(429, { detail: 'too_many_attempts' }),
    })
    await renderApp('/products', anna)

    await userEvent.type(await screen.findByLabelText('Поиск'), 'йогурт')
    await userEvent.click(await screen.findByRole('button', { name: 'Искать в Open Food Facts' }))
    await userEvent.click(await screen.findByRole('button', { name: /Йогурт натуральный/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/Слишком много попыток/)
    expect(screen.getByRole('button', { name: /Йогурт натуральный/ })).toBeEnabled()
    expect(callsTo(calls, LOOKUP)).toHaveLength(1)
  })

  it('создаёт продукт и возвращается в каталог', async () => {
    const calls = mockApi({
      [SEARCH]: sequence(json(200, []), json(200, [cottageCheese])),
      'PUT /api/products/*': json(201, cottageCheese),
    })
    await renderApp('/products', anna)

    await userEvent.click(await screen.findByRole('link', { name: 'Создать продукт' }))
    expect(await screen.findByRole('heading', { name: 'Новый продукт' })).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Название'), '  Творог 5 %  ')
    await userEvent.type(screen.getByLabelText('Калории, ккал'), '121')
    await userEvent.type(screen.getByLabelText('Белки, г'), '17,2')
    await userEvent.type(screen.getByLabelText('Жиры, г'), '5')
    await userEvent.type(screen.getByLabelText('Углеводы, г'), '1,8')
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    expect(await screen.findByRole('link', { name: /Творог 5 %/ })).toBeInTheDocument()
    const [saved] = callsTo(calls, 'PUT /api/products/*')
    expect(saved.path.split('/').at(-1)).toMatch(UUID7)
    expect(saved.body).toEqual({
      name: 'Творог 5 %',
      unit: 'g',
      kcal: 121,
      protein_g: 17.2,
      fat_g: 5,
      carbs_g: 1.8,
      ...noLabel,
      ...noPortions,
      barcode: null,
    })
  })

  it('считает калории по белкам, жирам и углеводам, пока их не ввели сами', async () => {
    const calls = mockApi({
      [SEARCH]: json(200, []),
      'PUT /api/products/*': json(201, oatmeal),
    })
    await renderApp('/products/new', anna)

    const kcal = await screen.findByLabelText('Калории, ккал')
    await userEvent.type(screen.getByLabelText('Название'), 'Овсяные хлопья')
    await userEvent.type(screen.getByLabelText('Белки, г'), '12,3')
    await userEvent.type(screen.getByLabelText('Жиры, г'), '6,2')
    // Пока заполнено не всё, считать не из чего.
    expect(kcal).toHaveValue('')
    await userEvent.type(screen.getByLabelText('Углеводы, г'), '61,8')
    // 12,3 × 4 + 6,2 × 9 + 61,8 × 4.
    expect(kcal).toHaveValue('352.2')
    await userEvent.type(screen.getByLabelText('Углеводы, г'), '5')
    expect(kcal).toHaveValue('352.4')

    // На упаковке другое число: введённое остаётся, что бы ни стало с БЖУ.
    await userEvent.clear(kcal)
    await userEvent.type(kcal, '352')
    await userEvent.clear(screen.getByLabelText('Жиры, г'))
    await userEvent.type(screen.getByLabelText('Жиры, г'), '7')
    expect(kcal).toHaveValue('352')

    // Стёртые калории снова считаются — когда из поля вышли.
    await userEvent.clear(kcal)
    expect(kcal).toHaveValue('')
    await userEvent.tab()
    expect(kcal).toHaveValue('359.6')
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() => expect(callsTo(calls, 'PUT /api/products/*')).toHaveLength(1))
    expect(callsTo(calls, 'PUT /api/products/*')[0].body).toMatchObject({
      kcal: 359.6,
      protein_g: 12.3,
      fat_g: 7,
      carbs_g: 61.85,
    })
  })

  it('жидкость заводится в миллилитрах', async () => {
    const calls = mockApi({
      [SEARCH]: json(200, []),
      'PUT /api/products/*': json(201, kefir),
    })
    await renderApp('/products/new', anna)

    expect(await screen.findByText('Состав указывается на 100 г продукта.')).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText('В чём измеряется'), 'Миллилитры')
    expect(screen.getByText('Состав указывается на 100 мл продукта.')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Название'), 'Кефир 1 %')
    await userEvent.type(screen.getByLabelText('Белки, г'), '3')
    await userEvent.type(screen.getByLabelText('Жиры, г'), '1')
    await userEvent.type(screen.getByLabelText('Углеводы, г'), '4')
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() => expect(callsTo(calls, 'PUT /api/products/*')).toHaveLength(1))
    expect(callsTo(calls, 'PUT /api/products/*')[0].body).toEqual({
      name: 'Кефир 1 %',
      unit: 'ml',
      kcal: 37,
      protein_g: 3,
      fat_g: 1,
      carbs_g: 4,
      ...noLabel,
      ...noPortions,
      barcode: null,
    })
  })

  it('остальное с этикетки вносится по желанию и сверяется с жирами и углеводами', async () => {
    const calls = mockApi({
      [SEARCH]: json(200, []),
      'PUT /api/products/*': json(201, cottageCheese),
    })
    await renderApp('/products/new', anna)

    expect(await screen.findByRole('group', { name: 'Ещё с этикетки' })).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Название'), 'Творог 5 %')
    await userEvent.type(screen.getByLabelText('Белки, г'), '17,2')
    await userEvent.type(screen.getByLabelText('Жиры, г'), '5')
    await userEvent.type(screen.getByLabelText('Углеводы, г'), '1,8')
    await userEvent.type(screen.getByLabelText('Насыщенные жиры, г'), '5,5')
    await userEvent.type(screen.getByLabelText('Сахара, г'), '2')
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    expect(await screen.findByText('Насыщенные жиры — не больше жиров')).toBeInTheDocument()
    expect(screen.getByText('Сахара — не больше углеводов')).toBeInTheDocument()
    expect(callsTo(calls, 'PUT /api/products/*')).toEqual([])

    await userEvent.clear(screen.getByLabelText('Насыщенные жиры, г'))
    await userEvent.type(screen.getByLabelText('Насыщенные жиры, г'), '3,2')
    await userEvent.clear(screen.getByLabelText('Сахара, г'))
    await userEvent.type(screen.getByLabelText('Сахара, г'), '1,8')
    await userEvent.type(screen.getByLabelText('Соль, г'), '0,1')
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() => expect(callsTo(calls, 'PUT /api/products/*')).toHaveLength(1))
    // Пустое поле — значения нет; ноль пришлось бы ввести.
    expect(callsTo(calls, 'PUT /api/products/*')[0].body).toMatchObject({
      saturated_fat_g: 3.2,
      sugars_g: 1.8,
      fiber_g: null,
      salt_g: 0.1,
    })
  })

  it('порция и упаковка вносятся по желанию — в единицах продукта', async () => {
    const calls = mockApi({ [SEARCH]: json(200, []), 'PUT /api/products/*': json(201, egg) })
    await renderApp('/products/new', anna)

    const sizes = within(await screen.findByRole('group', { name: 'Порция и упаковка' }))
    await userEvent.type(screen.getByLabelText('Название'), 'Яйцо куриное')
    await userEvent.type(screen.getByLabelText('Белки, г'), '12,7')
    await userEvent.type(screen.getByLabelText('Жиры, г'), '11,5')
    await userEvent.type(screen.getByLabelText('Углеводы, г'), '0,7')
    await userEvent.type(sizes.getByLabelText('Порция'), '60')
    await userEvent.type(sizes.getByLabelText('Упаковка'), '6000')
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    expect(await sizes.findByText('От 0,1 до 5000')).toBeInTheDocument()
    expect(callsTo(calls, 'PUT /api/products/*')).toEqual([])

    await userEvent.clear(sizes.getByLabelText('Упаковка'))
    await userEvent.type(sizes.getByLabelText('Упаковка'), '600')
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() => expect(callsTo(calls, 'PUT /api/products/*')).toHaveLength(1))
    expect(callsTo(calls, 'PUT /api/products/*')[0].body).toMatchObject({
      serving_size: 60,
      package_size: 600,
    })
  })

  it('размеры порции и упаковки подписаны единицей продукта', async () => {
    mockApi({ [SEARCH]: json(200, []) })
    await renderApp('/products/new', anna)

    const sizes = await screen.findByRole('group', { name: 'Порция и упаковка' })
    expect(within(sizes).getAllByText('г')).toHaveLength(2)
    await userEvent.selectOptions(screen.getByLabelText('В чём измеряется'), 'Миллилитры')

    expect(within(sizes).getAllByText('мл')).toHaveLength(2)
  })

  it('не отправляет продукт с невозможным составом', async () => {
    const calls = mockApi({})
    await renderApp('/products/new', anna)

    await userEvent.click(await screen.findByRole('button', { name: 'Сохранить' }))
    expect(await screen.findByText('Заполните поле')).toBeInTheDocument()
    expect(screen.getByText('Калории — от 0 до 900')).toBeInTheDocument()

    await userEvent.type(screen.getByLabelText('Название'), 'Чудо')
    await userEvent.type(screen.getByLabelText('Калории, ккал'), '500')
    await userEvent.type(screen.getByLabelText('Белки, г'), '50')
    await userEvent.type(screen.getByLabelText('Жиры, г'), '40')
    await userEvent.type(screen.getByLabelText('Углеводы, г'), '30')
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    expect(
      await screen.findByText('Белки, жиры и углеводы вместе — не больше 100 г'),
    ).toBeInTheDocument()
    expect(callsTo(calls, 'PUT /api/products/*')).toEqual([])
  })
})

describe('продукт', () => {
  const ONE = `GET /api/products/${cottageCheese.id}`
  const SAVE = `PUT /api/products/${cottageCheese.id}`

  it('автор исправляет состав; прошлые дни от этого не меняются', async () => {
    const calls = mockApi({
      [ONE]: json(200, cottageCheese),
      [SAVE]: json(200, cottageCheese),
      [SEARCH]: json(200, [cottageCheese]),
    })
    const { router } = await renderApp(`/products/${cottageCheese.id}`, anna)

    expect(await screen.findByRole('heading', { name: 'Изменить продукт' })).toBeInTheDocument()
    expect(screen.getByText(/Правка не изменит уже внесённые дни/)).toBeInTheDocument()
    const kcal = screen.getByLabelText('Калории, ккал')
    expect(kcal).toHaveValue('121')
    await userEvent.clear(kcal)
    await userEvent.type(kcal, '145,5')
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/products'))
    expect(callsTo(calls, SAVE)[0].body).toEqual({
      name: 'Творог 5 %',
      unit: 'g',
      kcal: 145.5,
      protein_g: 17.2,
      fat_g: 5,
      carbs_g: 1.8,
      ...noLabel,
      ...noPortions,
      barcode: null,
    })
  })

  it('продукт открывается со своей единицей; калории с упаковки расчётом не затираются', async () => {
    const label = { ...kefir, kcal: 41 }
    const calls = mockApi({
      [`GET /api/products/${kefir.id}`]: json(200, label),
      [`PUT /api/products/${kefir.id}`]: json(200, label),
      [SEARCH]: json(200, [label]),
    })
    await renderApp(`/products/${kefir.id}`, anna)

    expect(await screen.findByLabelText('В чём измеряется')).toHaveValue('ml')
    await userEvent.clear(screen.getByLabelText('Белки, г'))
    await userEvent.type(screen.getByLabelText('Белки, г'), '2,9')
    expect(screen.getByLabelText('Калории, ккал')).toHaveValue('41')
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() => expect(callsTo(calls, `PUT /api/products/${kefir.id}`)).toHaveLength(1))
    expect(callsTo(calls, `PUT /api/products/${kefir.id}`)[0].body).toMatchObject({
      unit: 'ml',
      kcal: 41,
      protein_g: 2.9,
    })
  })

  it('удаляет продукт после подтверждения', async () => {
    const remove = `DELETE /api/products/${cottageCheese.id}`
    const calls = mockApi({
      [ONE]: json(200, cottageCheese),
      [remove]: json(204),
      [SEARCH]: json(200, []),
    })
    const { router } = await renderApp(`/products/${cottageCheese.id}`, anna)

    await userEvent.click(await screen.findByRole('button', { name: 'Удалить продукт' }))
    expect(
      screen.getByText('Удалить продукт? Записи дневника с ним останутся.'),
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Да, удалить' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/products'))
    expect(callsTo(calls, remove)).toHaveLength(1)
  })

  it('отказ в удалении остаётся на экране; подтверждение можно отменить', async () => {
    mockApi({
      [ONE]: json(200, cottageCheese),
      [`DELETE /api/products/${cottageCheese.id}`]: json(403, { detail: 'forbidden' }),
    })
    await renderApp(`/products/${cottageCheese.id}`, anna)

    await userEvent.click(await screen.findByRole('button', { name: 'Удалить продукт' }))
    await userEvent.click(screen.getAllByRole('button', { name: 'Отмена' })[0])
    await userEvent.click(screen.getByRole('button', { name: 'Удалить продукт' }))
    await userEvent.click(screen.getByRole('button', { name: 'Да, удалить' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Недостаточно прав.')
  })

  it('чужой продукт показывает без формы', async () => {
    mockApi({ [`GET /api/products/${oatmeal.id}`]: json(200, oatmeal) })
    await renderApp(`/products/${oatmeal.id}`, anna)

    expect(await screen.findByText('Овсяные хлопья')).toBeInTheDocument()
    expect(screen.getByText(/Изменить его может автор или администратор/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Сохранить' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'К каталогу' })).toHaveAttribute('href', '/products')
  })

  it('продукт открывается со своими порцией и упаковкой; пустое поле размер убирает', async () => {
    const save = `PUT /api/products/${egg.id}`
    const calls = mockApi({
      [`GET /api/products/${egg.id}`]: json(200, egg),
      [SEARCH]: json(200, [egg]),
      [save]: json(200, egg),
    })
    await renderApp(`/products/${egg.id}`, anna)

    expect(await screen.findByLabelText('Порция')).toHaveValue('60')
    expect(screen.getByLabelText('Упаковка')).toHaveValue('600')
    await userEvent.clear(screen.getByLabelText('Упаковка'))
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() => expect(callsTo(calls, save)).toHaveLength(1))
    expect(callsTo(calls, save)[0].body).toMatchObject({ serving_size: 60, package_size: null })
  })

  it('чужой продукт показывает свои порцию и упаковку', async () => {
    const foreign = { ...egg, editable: false }
    mockApi({ [`GET /api/products/${egg.id}`]: json(200, { ...foreign, package_size: null }) })
    await renderApp(`/products/${egg.id}`, anna)

    const sizes = await screen.findByRole('list', { name: 'Порция и упаковка' })
    expect(
      within(sizes)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Порция — 60 г'])
  })

  it('чужой продукт без порции и упаковки о них молчит', async () => {
    mockApi({ [`GET /api/products/${oatmeal.id}`]: json(200, oatmeal) })
    await renderApp(`/products/${oatmeal.id}`, anna)

    await screen.findByText('Овсяные хлопья')
    expect(screen.queryByRole('list', { name: 'Порция и упаковка' })).not.toBeInTheDocument()
  })

  it('чужой продукт показывает то, что ещё известно с этикетки', async () => {
    const labelled = { ...oatmeal, saturated_fat_g: 1.1, sugars_g: 1, fiber_g: 0, salt_g: 0.03 }
    mockApi({ [`GET /api/products/${oatmeal.id}`]: json(200, { ...labelled, salt_g: null }) })
    await renderApp(`/products/${oatmeal.id}`, anna)

    const label = await screen.findByRole('list', { name: 'Ещё с этикетки' })
    // Ноль — значение, его показываем; чего нет — не показываем.
    expect(
      within(label)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Насыщенные жиры — 1,1 г', 'Сахара — 1 г', 'Клетчатка — 0 г'])
  })

  it('у продукта из Open Food Facts назван источник и есть ссылка на него', async () => {
    const imported = {
      ...cottageCheese,
      barcode: '4600000000008',
      source: 'open_food_facts' as const,
    }
    mockApi({ [ONE]: json(200, imported) })
    await renderApp(`/products/${cottageCheese.id}`, anna)

    expect(
      await screen.findByText(/Состав взят из Open Food Facts\. Сверьте его с упаковкой\./),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Открыть в Open Food Facts' })).toHaveAttribute(
      'href',
      'https://world.openfoodfacts.org/product/4600000000008',
    )
    expect(screen.getByLabelText('Штрихкод')).toHaveValue('4600000000008')
  })

  it('у продукта, внесённого человеком, источник не упоминается', async () => {
    mockApi({ [ONE]: json(200, cottageCheese) })
    await renderApp(`/products/${cottageCheese.id}`, anna)

    expect(await screen.findByLabelText('Штрихкод')).toHaveValue('')
    expect(screen.queryByText(/Open Food Facts/)).not.toBeInTheDocument()
  })

  it('штрихкод вписывается в карточку продукта; занятый — отказ', async () => {
    const calls = mockApi({
      [ONE]: json(200, cottageCheese),
      [SAVE]: json(409, { detail: 'barcode_taken' }),
    })
    await renderApp(`/products/${cottageCheese.id}`, anna)

    await userEvent.type(await screen.findByLabelText('Штрихкод'), '4600000000000')
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(await screen.findByText('Проверьте штрихкод: 8, 12 или 13 цифр')).toBeInTheDocument()
    expect(callsTo(calls, SAVE)).toEqual([])

    // UPC-A уходит на сервер уже как EAN-13.
    await userEvent.clear(screen.getByLabelText('Штрихкод'))
    await userEvent.type(screen.getByLabelText('Штрихкод'), '036000291452')
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Продукт с таким штрихкодом уже есть в каталоге.',
    )
    expect(callsTo(calls, SAVE)[0].body).toMatchObject({ barcode: '0036000291452' })
  })

  it('говорит, что продукта нет', async () => {
    mockApi({})
    await renderApp('/products/0199b7a0-0000-7000-8000-00000000dead', anna)

    expect(await screen.findByText('Такого продукта нет.')).toBeInTheDocument()
  })

  it('отказ сервера при сохранении показывается над формой', async () => {
    mockApi({ [ONE]: json(200, cottageCheese), [SAVE]: json(403, { detail: 'forbidden' }) })
    await renderApp(`/products/${cottageCheese.id}`, anna)

    await userEvent.click(await screen.findByRole('button', { name: 'Сохранить' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Недостаточно прав.')
  })
})
