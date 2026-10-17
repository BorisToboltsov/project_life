import { expect, test } from '@playwright/test'

import { adminInviteLink, register } from './steps.ts'

test('статистика: входы, календарный период, график и возврат к дню', async ({
  page,
}, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const suffix = `${testInfo.project.name}-${Date.now()}`
  await register(page, adminInviteLink(), 'Борис', `stats-${suffix}@example.com`)
  await page.getByRole('link', { name: 'Статистика', exact: true }).click()
  await expect(page.getByText('За этот период нет записей питания.')).toBeVisible()
  await page.getByRole('link', { name: 'Открыть день', exact: true }).click()
  await page.getByRole('link', { name: 'Добавить: Завтрак' }).click()
  await page.getByRole('link', { name: 'Создать продукт', exact: true }).click()
  await page.getByLabel('Название', { exact: true }).fill(`Продукт ${suffix}`)
  await page.getByLabel('Калории, ккал').fill('100')
  await page.getByLabel('Белки, г').fill('10')
  await page.getByLabel('Жиры, г', { exact: true }).fill('0')
  await page.getByLabel('Углеводы, г').fill('15')
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await page.getByLabel('Сколько, г').fill('100')
  await page.getByRole('button', { name: 'Добавить', exact: true }).click()
  await page.getByRole('link', { name: 'Готово' }).click()
  await page.getByRole('button', { name: 'Добавить 250 мл', exact: true }).click()
  await page.getByRole('link', { name: 'Статистика', exact: true }).click()
  await expect(page.getByText('По дням с записями питания: 1')).toBeVisible()
  await expect(page.getByText('По дням с записями воды: 1')).toBeVisible()
  await expect(page.getByRole('img', { name: /Калории по дням/ }).locator('canvas')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('statistics-week.png'), fullPage: true })
  await page.getByRole('link', { name: 'Месяц', exact: true }).click()
  await expect(page).toHaveURL(/period=month/)
  await expect(page.getByText('По дням с записями питания: 1')).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Статистика питания' })).toBeVisible()
  await expect(page.getByText('По дням с записями воды: 1')).toBeVisible()
  await expect(page.getByRole('img', { name: /Калории по дням/ }).locator('canvas')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('statistics-month.png'), fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  expect(errors).toEqual([])
})
