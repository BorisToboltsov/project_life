import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { callsTo, json, mockApi, sequence } from '@/test/api'
import { renderApp } from '@/test/app'
import { anna, cottageCheese, oatmeal } from '@/test/fixtures'

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
      kcal: 121,
      protein_g: 17.2,
      fat_g: 5,
      carbs_g: 1.8,
    })
  })

  it('не отправляет продукт с невозможным составом', async () => {
    const calls = mockApi({})
    await renderApp('/products/new', anna)

    await userEvent.click(await screen.findByRole('button', { name: 'Сохранить' }))
    expect(await screen.findByText('Заполните поле')).toBeInTheDocument()
    expect(screen.getByText('Калории — от 0 до 900 на 100 г')).toBeInTheDocument()

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
      kcal: 145.5,
      protein_g: 17.2,
      fat_g: 5,
      carbs_g: 1.8,
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
