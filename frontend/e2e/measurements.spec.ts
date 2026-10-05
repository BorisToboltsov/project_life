import { expect, test } from '@playwright/test'

import { adminInviteLink, register } from './steps.ts'

test('замеры: ввод с главной, история, график, правка и удаление', async ({ page }, testInfo) => {
  const problems: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text())
  })
  page.on('pageerror', (error) => problems.push(error.message))

  const email = `body-${testInfo.project.name}-${Date.now()}@example.com`
  await register(page, adminInviteLink(), 'Борис', email)

  // С главной до сохранённого замера: «Внести замер» → числа → «Сохранить».
  await expect(page.getByRole('link', { name: /Вес/ })).toContainText('Нет замеров')
  await page.getByRole('link', { name: 'Внести замер' }).click()
  await expect(page.locator('svg.illus')).toHaveCount(4)
  await page.getByLabel('Вес').fill('72,4')
  await page.getByLabel('Шея').fill('38')
  await page.getByLabel('Талия').fill('86,5')
  await page.getByLabel('Бёдра').fill('97')
  await page.getByRole('button', { name: 'Сохранить' }).click()

  await expect(page.getByRole('link', { name: /Вес/ })).toContainText('72,4 кг')
  await expect(page.getByRole('link', { name: /Талия/ })).toContainText('86,5 см')
  await expect(page.getByRole('link', { name: /Бёдра/ })).toContainText('97 см')

  // Второй и третий замер задним числом — появляются изменение, график и тренд.
  for (const [date, weight] of [
    ['01092026', '74'],
    ['15092026', '73,1'],
  ]) {
    await page.getByRole('link', { name: 'Внести замер' }).click()
    await page.getByLabel('Дата').fill('')
    await page.getByLabel('Дата').pressSequentially(date)
    await page.getByLabel('Вес').fill(weight)
    await page.getByRole('button', { name: 'Сохранить' }).click()
    await expect(page.getByRole('heading', { name: 'Здравствуйте, Борис!' })).toBeVisible()
  }
  await expect(page.getByRole('link', { name: /Вес/ })).toContainText('-0,7 кг')

  // История веса: три записи новыми вперёд и нарисованный график.
  await page.getByRole('link', { name: /Вес/ }).click()
  const history = page.getByRole('list', { name: 'История' }).getByRole('listitem')
  await expect(history).toHaveCount(3)
  await expect(history.nth(1)).toContainText('73,1 кг')
  await expect(history.nth(1)).toContainText('15/09/2026')
  await expect(page.getByRole('img', { name: 'График: Вес' }).locator('canvas')).toBeVisible()

  // Правка: значение меняется, запись остаётся той же.
  await history.nth(1).getByRole('link', { name: 'Изменить' }).click()
  await page.getByLabel('Значение').fill('73,4')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(history).toHaveCount(3)
  await expect(history.nth(1)).toContainText('73,4 кг')

  // Удаление — после подтверждения.
  await history.nth(2).getByRole('button', { name: 'Удалить' }).click()
  await history.nth(2).getByRole('button', { name: 'Да, удалить' }).click()
  await expect(history).toHaveCount(2)

  // У талии своя история.
  await page
    .getByRole('navigation', { name: 'Замеры' })
    .getByRole('link', { name: 'Талия' })
    .click()
  await expect(history).toHaveCount(1)
  await expect(history.first()).toContainText('86,5 см')

  // Данные пережили перезагрузку страницы.
  await page.reload()
  await expect(history.first()).toContainText('86,5 см')

  expect(problems).toEqual([])
})

test('замеры в имперской системе вводятся и показываются в фунтах и дюймах', async ({
  page,
}, testInfo) => {
  const email = `imperial-${testInfo.project.name}-${Date.now()}@example.com`
  await register(page, adminInviteLink(), 'Вера', email)
  await page.getByRole('link', { name: 'Профиль' }).click()
  await page.getByLabel('Единицы').selectOption('imperial')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByText('Сохранено')).toBeVisible()

  await page.getByRole('link', { name: 'Замеры' }).click()
  await page.getByRole('link', { name: 'Внести замер' }).click()
  await page.getByLabel('Вес').fill('165,4')
  await page.getByLabel('Талия').fill('34,5')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('link', { name: /Вес/ })).toContainText('165,4 фунт')
  await expect(page.getByRole('link', { name: /Талия/ })).toContainText('34,5 дюйм')

  // После возврата к метрической системе те же замеры — в килограммах и сантиметрах.
  await page.getByRole('link', { name: 'Профиль' }).click()
  await page.getByLabel('Единицы').selectOption('metric')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByText('Сохранено')).toBeVisible()
  await page.getByRole('link', { name: 'Главная' }).click()
  await expect(page.getByRole('link', { name: /Вес/ })).toContainText('75 кг')
  await expect(page.getByRole('link', { name: /Талия/ })).toContainText('87,6 см')
})
