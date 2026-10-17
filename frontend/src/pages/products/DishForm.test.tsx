import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'

import { callsTo, json, mockApi } from '@/test/api'
import { renderApp } from '@/test/app'
import { anna, cottageCheese } from '@/test/fixtures'

it('сохраняет рецепт с весом готового блюда и возвращается в каталог', async () => {
  const calls = mockApi({
    'GET /api/products': json(200, [cottageCheese]),
    'PUT /api/products/*': json(201, cottageCheese),
  })
  await renderApp('/products', anna)
  await userEvent.click(await screen.findByRole('button', { name: 'Создать блюдо' }))
  await userEvent.type(await screen.findByLabelText('Название'), 'Сырники')
  await userEvent.click(screen.getByRole('button', { name: 'Добавить ингредиент' }))
  await userEvent.click(await screen.findByRole('button', { name: cottageCheese.name }))
  await userEvent.type(screen.getByLabelText('Вес готового блюда, г'), '80')
  await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
  await waitFor(() => expect(callsTo(calls, 'PUT /api/products/*')).toHaveLength(1))
  expect(callsTo(calls, 'PUT /api/products/*')[0]?.body).toMatchObject({
    name: 'Сырники',
    output_g: '80',
    ingredients: [{ product_id: cottageCheese.id, amount: '100' }],
  })
})

it('не отправляет пустой рецепт', async () => {
  const calls = mockApi({ 'GET /api/products': json(200, []) })
  await renderApp('/products', anna)
  await userEvent.click(await screen.findByRole('button', { name: 'Создать блюдо' }))
  await userEvent.click(await screen.findByRole('button', { name: 'Сохранить' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Проверьте рецепт')
  expect(callsTo(calls, 'PUT /api/products/*')).toHaveLength(0)
})

it('сохраняет удалённый ингредиент и разрешает убрать его из рецепта', async () => {
  const dish = {
    ...cottageCheese,
    name: 'Сырники',
    recipe: {
      output_g: 200,
      ingredients: [
        { product_id: 'missing', amount: '200', mass_g: null, snapshot: cottageCheese },
      ],
    },
  }
  mockApi({
    [`GET /api/products/${dish.id}`]: json(200, dish),
    'GET /api/products/missing': json(404, { detail: 'not_found' }),
  })
  await renderApp(`/products/${dish.id}`, anna)
  expect(await screen.findByText('Продукт удалён: сохранённый состав')).toBeInTheDocument()
  expect(screen.getByLabelText('Количество, г')).toHaveValue('200')
  await userEvent.click(screen.getByRole('button', { name: /^Убрать$/ }))
  expect(screen.queryByLabelText('Количество, г')).not.toBeInTheDocument()
})
