import { expect, test } from '@playwright/test'

import { freshBarcode } from './barcode.ts'
import { adminInviteLink, register } from './steps.ts'

// Подменный Open Food Facts стенда находит по названию продукт с тем штрихкодом, который
// стоит в тексте поиска (deploy/stand/off/Caddyfile): так у каждого прогона продукт свой, а
// каталог стенда общий для всех прогонов.

test('поиск по названию: продукт из Open Food Facts → каталог → запись в дневнике', async ({
  page,
}, testInfo) => {
  const suffix = `${testInfo.project.name}-${Date.now()}`
  await register(page, adminInviteLink(), 'Борис', `search-${suffix}@example.com`)
  await page.getByRole('link', { name: 'Открыть дневник' }).click()

  // В своём каталоге такого нет, а наружу текст уходит только по кнопке.
  const text = `йогурт ${freshBarcode('4601')}`
  await page.getByRole('link', { name: 'Добавить: Завтрак' }).click()
  await page.getByLabel('Поиск продукта').fill(text)
  await expect(page.getByText('Ничего не найдено.')).toBeVisible()
  await expect(page.getByRole('list', { name: 'Open Food Facts' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Искать в Open Food Facts' }).click()

  const outside = page.getByRole('list', { name: 'Open Food Facts' })
  await expect(outside.getByRole('listitem')).toHaveCount(1)
  await expect(outside).toContainText('68 ккал · Б 5 · Ж 3,2 · У 4,7 на 100 г')
  await outside.getByRole('button', { name: /Йогурт натуральный, Стенд/ }).click()

  // Выбранный продукт уже в каталоге и ждёт количества.
  const picked = page.getByRole('list', { name: 'Из Open Food Facts' })
  await expect(
    page.getByText('Состав взят из Open Food Facts. Сверьте его с упаковкой.'),
  ).toBeVisible()
  await picked.getByLabel('Сколько, г').fill('125')
  await picked.getByRole('button', { name: 'Добавить', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText('Добавлено: Йогурт натуральный, Стенд, 125 г')

  // Второй раз Open Food Facts его не предлагает: он свой.
  await page.getByLabel('Поиск продукта').fill(text)
  await page.getByRole('button', { name: 'Искать в Open Food Facts' }).click()
  await expect(page.getByText('В Open Food Facts ничего не нашлось.')).toBeVisible()

  await page.getByRole('link', { name: 'Готово' }).click()
  await expect(page.getByRole('list', { name: 'Завтрак' }).getByRole('listitem')).toContainText(
    '125 г · 85 ккал',
  )
})

test('поиск по названию в каталоге: неполный продукт дополняют с упаковки', async ({
  page,
}, testInfo) => {
  const suffix = `${testInfo.project.name}-${Date.now()}`
  await register(page, adminInviteLink(), 'Борис', `search-form-${suffix}@example.com`)
  await page.getByRole('link', { name: 'Открыть дневник' }).click()
  await page.getByRole('link', { name: 'Каталог продуктов' }).click()

  const barcode = freshBarcode('4602')
  const drink = `Морс ${suffix}`
  await page.getByLabel('Поиск').fill(`морс ${barcode}`)
  await page.getByRole('button', { name: 'Искать в Open Food Facts' }).click()
  const row = page
    .getByRole('list', { name: 'Open Food Facts' })
    .getByRole('button', { name: /Морс клюквенный, Стенд/ })
  await expect(row).toContainText('Состав неполный')
  await row.click()

  // Известное подставлено: название, единица и штрихкод; состав — с упаковки.
  await expect(page.getByRole('status')).toContainText(
    `Продукт ${barcode} есть в Open Food Facts, но состав там неполный.`,
  )
  await expect(page.getByLabel('Название')).toHaveValue('Морс клюквенный, Стенд')
  await expect(page.getByLabel('В чём измеряется')).toHaveValue('ml')
  await expect(page.getByLabel('Штрихкод')).toHaveValue(barcode)
  await page.getByLabel('Название').fill(drink)
  await page.getByLabel('Белки, г').fill('0')
  await page.getByLabel('Жиры, г', { exact: true }).fill('0')
  await page.getByLabel('Углеводы, г').fill('11')
  // Остальное с этикетки необязательно, но часть не бывает больше целого.
  await page.getByLabel('Сахара, г').fill('12')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByText('Сахара — не больше углеводов')).toBeVisible()
  await page.getByLabel('Сахара, г').fill('10,5')
  await page.getByRole('button', { name: 'Сохранить' }).click()

  // Продукт в каталоге — со штрихкодом и с тем, что внесли с этикетки.
  await page.getByLabel('Поиск').fill(drink)
  await page
    .getByRole('list', { name: 'Каталог продуктов' })
    .getByRole('link', { name: new RegExp(drink) })
    .click()
  await expect(page.getByLabel('Штрихкод')).toHaveValue(barcode)
  await expect(page.getByLabel('Сахара, г')).toHaveValue('10.5')
  await expect(page.getByLabel('Соль, г')).toHaveValue('')
})
