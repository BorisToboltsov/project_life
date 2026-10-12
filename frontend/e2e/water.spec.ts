import { expect, test } from '@playwright/test'

import { adminInviteLink, register } from './steps.ts'

test('вода: порции с главной, цель по весу, стакан заполняется, правка в дне дневника', async ({
  page,
}, testInfo) => {
  const problems: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text())
  })
  page.on('pageerror', (error) => problems.push(error.message))

  const email = `water-${testInfo.project.name}-${Date.now()}@example.com`
  await register(page, adminInviteLink(), 'Борис', email)

  // Без цели: порция с главной в одно касание, стакан пуст и шкалы нет.
  const water = page.locator('[data-slot="card"]', { hasText: 'Вода сегодня' })
  await expect(water.locator('svg.illus')).toBeVisible()
  await water.getByRole('button', { name: 'Добавить 250 мл' }).click()
  await expect(water.getByText('250 мл', { exact: true }).first()).toBeVisible()
  await expect(water.getByRole('progressbar')).toHaveCount(0)

  // Вес внесён — цель по воде уже посчитана: 80 кг × 30 мл.
  await page.getByRole('link', { name: 'Внести замер' }).click()
  await page.getByLabel('Вес').fill('80')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await water.getByRole('link', { name: 'Задать цель' }).click()
  await expect(page.getByLabel('Вода, мл')).toHaveValue('2400')
  await expect(page.getByText(/По весу 80 кг — около 2\s400 мл/)).toBeVisible()
  await page.getByLabel('Вода, мл').fill('2000')
  await page.getByRole('button', { name: 'Сохранить' }).click()

  // День дневника: тот же стакан, теперь с целью.
  const day = page.locator('[data-slot="card"]', { hasText: 'Вода' }).filter({
    has: page.getByRole('progressbar', { name: 'Выпито из цели' }),
  })
  await expect(day.getByText(/^250 из 2\s000 мл$/)).toBeVisible()
  await expect(day.getByText(/^Осталось 1\s750 мл$/)).toBeVisible()
  await expect(day.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '13')

  // Бутылка и своё количество; ошибочную порцию убирает крестик на её метке.
  await day.getByRole('button', { name: 'Добавить 500 мл' }).click()
  await expect(day.getByText(/^750 из 2\s000 мл$/)).toBeVisible()
  await day.getByRole('button', { name: 'Другое' }).click()
  await day.getByLabel('Сколько, мл').fill('330')
  await day.getByRole('button', { name: 'Добавить', exact: true }).click()
  await expect(day.getByText(/^1\s080 из 2\s000 мл$/)).toBeVisible()
  const portions = day.getByRole('list', { name: 'Порции за день' }).getByRole('listitem')
  await expect(portions).toHaveText(['250 мл', '500 мл', '330 мл'])
  await day.getByRole('button', { name: 'Убрать 250 мл' }).click()
  await expect(portions).toHaveText(['500 мл', '330 мл'])
  await expect(day.getByText(/^830 из 2\s000 мл$/)).toBeVisible()

  // Вчерашний день — свой: в нём пусто, и вода вносится в него же.
  await page.getByRole('link', { name: 'Предыдущий день' }).click()
  await expect(page.getByRole('list', { name: 'Порции за день' })).toHaveCount(0)
  await page.getByRole('link', { name: 'К сегодняшнему дню' }).click()
  await expect(portions).toHaveCount(2)

  // Цель выполнена: стакан полон. Данные пережили перезагрузку и видны на главной.
  await day.getByRole('button', { name: 'Добавить 500 мл' }).click()
  await day.getByRole('button', { name: 'Добавить 500 мл' }).click()
  await day.getByRole('button', { name: 'Добавить 250 мл' }).click()
  await expect(day.getByText('Цель выполнена')).toBeVisible()
  await expect(day.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100')
  await page.reload()
  await expect(day.getByText(/^2\s080 из 2\s000 мл$/)).toBeVisible()
  await page.getByRole('link', { name: 'Главная' }).click()
  await expect(water.getByText(/^2\s080 из 2\s000 мл$/)).toBeVisible()
  await expect(water.getByRole('link', { name: 'Изменить цель' })).toBeVisible()

  expect(problems).toEqual([])
})
