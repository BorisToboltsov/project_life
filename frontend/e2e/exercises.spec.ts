import { expect, test } from '@playwright/test'

import { adminInviteLink, register } from './steps.ts'

test('упражнения: справочник, карточка с рисунком и своё упражнение', async ({
  page,
}, testInfo) => {
  const problems: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text())
  })
  page.on('pageerror', (error) => problems.push(error.message))

  const email = `gym-${testInfo.project.name}-${Date.now()}@example.com`
  await register(page, adminInviteLink(), 'Борис', email)

  // Раздел открывает журнал; список упражнений — отдельной кнопкой.
  await page.getByRole('link', { name: 'Тренировки' }).click()
  await expect(page.getByRole('heading', { name: 'Тренировки' })).toBeVisible()
  await page.getByRole('link', { name: 'Мои упражнения' }).click()
  await expect(page.getByRole('heading', { name: 'Упражнения' })).toBeVisible()
  const catalog = page.getByRole('list', { name: 'Справочник' }).getByRole('listitem')
  await expect(catalog).toHaveCount(40)
  await expect(page.getByText(/В списке пока пусто/)).toBeVisible()

  // Метка группы и поиск сужают справочник.
  await page.getByRole('button', { name: 'Кардио' }).click()
  await expect(catalog).toHaveCount(4)
  await page.getByRole('button', { name: 'Все' }).click()
  await page.getByRole('searchbox', { name: 'Найти упражнение' }).fill('тяга')
  await expect(catalog).toHaveCount(6)
  await page.getByRole('searchbox', { name: 'Найти упражнение' }).fill('')

  // Одним касанием упражнение переезжает в свой список.
  await page.getByRole('button', { name: 'Добавить в список: Становая тяга' }).click()
  await expect(page.getByRole('status')).toHaveText('Добавлено в список: Становая тяга.')
  const mine = page.getByRole('list', { name: 'Мой список' }).getByRole('listitem')
  await expect(mine).toHaveCount(1)
  await expect(catalog).toHaveCount(39)

  // Карточка: рисунок техники движется, рядом карта мышц, ниже шаги.
  await mine.getByRole('link').click()
  await expect(page.getByRole('heading', { name: 'Становая тяга' })).toBeVisible()
  await expect(page.locator('svg.illus')).toHaveCount(2)
  await expect(page.locator('svg.ex .ex-plate')).toBeVisible()
  await expect(page.locator('.mm-main').first()).toBeVisible()
  await expect(page.getByRole('list', { name: 'Техника' }).getByRole('listitem')).toHaveCount(3)

  // Убрать из списка — после подтверждения; упражнение возвращается в справочник.
  await page.getByRole('button', { name: 'Убрать из списка' }).click()
  await page.getByRole('button', { name: 'Да, убрать' }).click()
  await expect(page.getByRole('button', { name: 'Добавить в мой список' })).toBeVisible()

  // Карточка кардио говорит, что записывает подход; у подтягиваний рисунок идёт по шагам.
  await page.goto('/workouts/exercises/treadmill_walk')
  await expect(page.getByText('Записывается:')).toBeVisible()
  await expect(page.getByText('время, дистанция, наклон')).toBeVisible()
  await page.goto('/workouts/exercises/pull_up')
  await expect(page.locator('svg.ex .ex-t').first()).toBeVisible()

  // Своё упражнение: название, вид и мышцы; после создания открывается его карточка.
  await page.goto('/workouts/exercises')
  await page.getByRole('link', { name: 'Своё упражнение' }).click()
  await page.getByLabel('Название').fill('Тяга гантели к поясу')
  await page.getByText('Широчайшие').click()
  await page.getByRole('button', { name: 'Добавить' }).click()
  await expect(page.getByRole('heading', { name: 'Тяга гантели к поясу' })).toBeVisible()
  await expect(page.getByText('Своё', { exact: true })).toBeVisible()
  await expect(page.getByText('широчайшие')).toBeVisible()

  // Правка: название меняется, вид подхода заблокирован.
  await page.getByRole('link', { name: 'Изменить' }).click()
  await expect(page.getByRole('radio', { name: 'Время' })).toBeDisabled()
  await page.getByLabel('Название').fill('Тяга гантели в наклоне')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('heading', { name: 'Тяга гантели в наклоне' })).toBeVisible()

  // В списке оно стоит сверху с меткой «Своё».
  await page.getByRole('link', { name: 'К списку упражнений' }).click()
  await expect(mine).toHaveCount(1)
  await expect(mine).toContainText('Своё · широчайшие')

  expect(problems).toEqual([])
})
