import { expect, test } from '@playwright/test'

import { adminInviteLink, register } from './steps.ts'

test('блюдо: создать ингредиент внутри формы и внести порцию в дневник', async ({
  page,
}, testInfo) => {
  const suffix = `${testInfo.project.name}-${Date.now()}`
  await register(page, adminInviteLink(), 'Борис', `dish-${suffix}@example.com`)
  await page.getByRole('link', { name: 'Открыть дневник' }).click()
  await page.getByRole('link', { name: 'Добавить: Завтрак' }).click()
  await page.getByRole('button', { name: 'Создать блюдо' }).click()
  await page.getByLabel('Название', { exact: true }).fill(`Блюдо ${suffix}`)
  await page.getByRole('button', { name: 'Добавить ингредиент' }).click()
  await page.getByRole('button', { name: 'Создать продукт', exact: true }).click()
  await page.getByLabel('Название', { exact: true }).fill(`Ингредиент ${suffix}`)
  await page.getByLabel('Белки, г').fill('10')
  await page.getByLabel('Жиры, г', { exact: true }).fill('5')
  await page.getByLabel('Углеводы, г').fill('20')
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(page.getByLabel('Название', { exact: true })).toHaveValue(`Блюдо ${suffix}`)
  await page.getByLabel('Вес готового блюда, г').fill('100')
  await page.getByLabel('Порция, г', { exact: true }).fill('50')
  await page.screenshot({ path: testInfo.outputPath('dish.png'), fullPage: true })
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await page.getByRole('button', { name: 'Добавить', exact: true }).click()
  await expect(page.getByRole('status')).toContainText(`Добавлено: Блюдо ${suffix}`)
})
