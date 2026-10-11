import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { callsTo, json, mockApi, sequence } from '@/test/api'
import { renderApp } from '@/test/app'
import { anna, cottageCheese, kefir, oatmeal } from '@/test/fixtures'

const SEARCH = 'GET /api/products'
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
    expect(callsTo(calls, SEARCH).at(-1)?.query).toEqual({ q: 'твор' })
  })

  it('различает пустой каталог и пустой результат поиска', async () => {
    mockApi({ [SEARCH]: json(200, []) })
    await renderApp('/products', anna)

    expect(await screen.findByText('В каталоге пока пусто.')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Поиск'), 'кефир')
    expect(await screen.findByText('Ничего не найдено.')).toBeInTheDocument()
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
      barcode: null,
    })
  })

  it('считает калории по белкам, жирам и углеводам, пока их не ввели сами', async () => {
    const calls = mockApi({ [SEARCH]: json(200, []), 'PUT /api/products/*': json(201, oatmeal) })
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
    const calls = mockApi({ [SEARCH]: json(200, []), 'PUT /api/products/*': json(201, kefir) })
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
      barcode: null,
    })
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
