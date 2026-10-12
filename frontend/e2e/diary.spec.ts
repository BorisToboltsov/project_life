import { expect, type Page, test } from '@playwright/test'

import { adminInviteLink, register } from './steps.ts'

/**
 * Заводит продукт. Калории `null` — их не вводят: поле считается по белкам, жирам и
 * углеводам, и в нём ждём `expected`.
 */
async function createProduct(
  page: Page,
  name: string,
  [kcal, protein, fat, carbs]: [string | null, string, string, string],
  { unit, expected }: { unit?: string; expected?: string } = {},
) {
  await page.getByRole('link', { name: 'Создать продукт' }).click()
  await page.getByLabel('Название').fill(name)
  if (unit) await page.getByLabel('В чём измеряется').selectOption({ label: unit })
  if (kcal !== null) await page.getByLabel('Калории, ккал').fill(kcal)
  await page.getByLabel('Белки, г').fill(protein)
  await page.getByLabel('Жиры, г', { exact: true }).fill(fat)
  await page.getByLabel('Углеводы, г').fill(carbs)
  if (expected) await expect(page.getByLabel('Калории, ккал')).toHaveValue(expected)
  await page.getByRole('button', { name: 'Сохранить' }).click()
}

test('дневник питания: день внесён целиком, правка продукта не меняет прошлые дни', async ({
  page,
}, testInfo) => {
  const problems: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text())
  })
  page.on('pageerror', (error) => problems.push(error.message))

  // Каталог общий для всех прогонов на стенде — названия у каждого свои.
  const suffix = `${testInfo.project.name}-${Date.now()}`
  const oatmeal = `Овсянка ${suffix}`
  const cheese = `Творог ${suffix}`
  const kefir = `Кефир ${suffix}`
  await register(page, adminInviteLink(), 'Борис', `diary-${suffix}@example.com`)

  // С главной — в сегодняшний день; продукт создаётся по пути в завтрак.
  await page.getByRole('link', { name: 'Открыть дневник' }).click()
  await page.getByRole('link', { name: 'Добавить: Завтрак' }).click()
  await createProduct(page, oatmeal, ['352', '12,3', '6,2', '61,8'])
  await page.getByLabel('Сколько, г').fill('60')
  await page.getByRole('button', { name: 'Добавить', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText(`Добавлено: ${oatmeal}, 60 г`)
  // Калории творога не вводим: они считаются по БЖУ — 17,2 × 4 + 5 × 9 + 1,8 × 4.
  await createProduct(page, cheese, [null, '17,2', '5', '1,8'], { expected: '121' })
  await page.getByLabel('Сколько, г').fill('150')
  await page.getByRole('button', { name: 'Добавить', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText(`Добавлено: ${cheese}, 150 г`)
  await page.getByRole('link', { name: 'Готово' }).click()

  // Итог дня: 60 г овсянки и 150 г творога — 211 + 182 ккал.
  const breakfast = page.getByRole('list', { name: 'Завтрак' }).getByRole('listitem')
  await expect(breakfast).toHaveCount(2)
  await expect(breakfast.first()).toContainText('60 г · 211 ккал')
  await expect(page.getByText('393 ккал', { exact: true }).first()).toBeVisible()

  // Цель на день хватит задать по одному показателю: остальные идут без неё.
  await page.getByRole('link', { name: 'Задать цель' }).click()
  await page.getByLabel('Белки, г').fill('130')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByText('33,2 из 130 г')).toBeVisible()
  await expect(page.getByRole('progressbar')).toHaveCount(1)

  // Полная цель: калории — предел для белков, жиров и углеводов.
  await page.getByRole('link', { name: 'Изменить цель' }).click()
  await page.getByLabel('Калории, ккал').fill('2000')
  await page.getByLabel('Жиры, г', { exact: true }).fill('70')
  await page.getByLabel('Углеводы, г').fill('230')
  await expect(page.getByText(/БЖУ дают 2\s070 ккал — на 70 больше цели/)).toBeVisible()
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByText('Белки, жиры и углеводы не помещаются в эти калории')).toBeVisible()
  await page.getByLabel('Калории, ккал').fill('2100')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByText(/^393 из 2\s100 ккал$/)).toBeVisible()
  await expect(page.getByRole('progressbar', { name: 'Калории' })).toHaveAttribute(
    'aria-valuenow',
    '19',
  )

  // Завтрашний день собирается копированием сегодняшнего.
  await page.getByRole('link', { name: 'Следующий день' }).click()
  await expect(page.getByText('Пока пусто.')).toHaveCount(4)
  await page.getByRole('link', { name: 'Скопировать день' }).click()
  await expect(
    page.getByRole('list', { name: 'Будут скопированы' }).getByRole('listitem'),
  ).toHaveCount(2)
  await page.getByRole('button', { name: 'Скопировать', exact: true }).click()
  await expect(breakfast).toHaveCount(2)
  await expect(page.getByText(/^393 из 2\s100 ккал$/)).toBeVisible()

  // Продукт исправили: внесённые дни остались при своём составе.
  await page.getByRole('link', { name: 'Каталог продуктов' }).click()
  await page.getByLabel('Поиск').fill(oatmeal)
  await page.getByRole('link', { name: new RegExp(oatmeal) }).click()
  await page.getByLabel('Калории, ккал').fill('400')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  // Каталог открывается с начала и приходит страницами: продукт снова находим поиском.
  await page.getByLabel('Поиск').fill(oatmeal)
  await expect(page.getByRole('link', { name: new RegExp(oatmeal) })).toContainText('400 ккал')
  await page.getByRole('link', { name: 'Питание' }).click()
  await expect(page.getByText(/^393 из 2\s100 ккал$/)).toBeVisible()

  // Новая запись берёт уже исправленный состав; продукт найден среди недавних.
  await page.getByRole('link', { name: 'Добавить: Перекус' }).click()
  await page
    .getByRole('list', { name: 'Недавние' })
    .getByRole('button', { name: new RegExp(oatmeal) })
    .click()
  await expect(page.getByLabel('Сколько, г')).toHaveValue('60')
  await page.getByLabel('Сколько, г').fill('100')
  await page.getByRole('button', { name: 'Добавить', exact: true }).click()
  await page.getByRole('link', { name: 'Готово' }).click()
  await expect(page.getByText(/^793 из 2\s100 ккал$/)).toBeVisible()

  // Правка граммов и удаление записи.
  const snack = page.getByRole('list', { name: 'Перекус' }).getByRole('listitem')
  await snack.getByRole('link', { name: 'Изменить' }).click()
  await page.getByLabel('Сколько, г').fill('50')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(snack).toContainText('50 г · 200 ккал')
  await snack.getByRole('button', { name: 'Удалить' }).click()
  await snack.getByRole('button', { name: 'Да, удалить' }).click()
  await expect(snack).toHaveCount(0)

  // Данные пережили перезагрузку страницы.
  await page.reload()
  await expect(breakfast).toHaveCount(2)
  await expect(page.getByText(/^393 из 2\s100 ккал$/)).toBeVisible()

  // Завтрак предлагает то, что в него уже вносили, — искать не нужно.
  await page.getByRole('link', { name: 'Добавить: Завтрак' }).click()
  const usual = page.getByRole('list', { name: 'Часто в этом приёме пищи' })
  await expect(usual.getByRole('button', { name: new RegExp(oatmeal) })).toBeVisible()
  await expect(usual.getByRole('button', { name: new RegExp(cheese) })).toBeVisible()
  await page.getByRole('link', { name: 'Готово' }).click()

  // Пятый приём пищи со своим названием; в него вносится напиток в миллилитрах.
  await page.getByRole('link', { name: 'Добавить приём пищи' }).click()
  await page.getByLabel('Название').fill('Полдник')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await page.getByRole('link', { name: 'Добавить: Полдник' }).click()
  await createProduct(page, kefir, [null, '3', '1', '4'], { unit: 'Миллилитры', expected: '37' })
  await page.getByLabel('Сколько, мл').fill('250')
  await page.getByRole('button', { name: 'Добавить', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText(`Добавлено: ${kefir}, 250 мл`)
  await page.getByRole('link', { name: 'Готово' }).click()
  await expect(page.getByRole('list', { name: 'Полдник' }).getByRole('listitem')).toContainText(
    '250 мл · 93 ккал',
  )

  // Приём пищи убирается из списка — и предустановленный тоже. Пустой исчезает из дня,
  // а тот, где есть записи, остаётся в нём вместе с ними.
  await page.getByRole('button', { name: 'Удалить приём пищи: Обед' }).click()
  await page.getByRole('button', { name: 'Да, удалить' }).click()
  await expect(page.getByRole('link', { name: 'Добавить: Обед' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Удалить приём пищи: Полдник' }).click()
  await page.getByRole('button', { name: 'Да, удалить' }).click()
  await expect(page.getByRole('link', { name: 'Добавить: Полдник' })).toHaveCount(0)
  await expect(page.getByRole('list', { name: 'Полдник' }).getByRole('listitem')).toHaveCount(1)
  await expect(
    page.getByText('Приём пищи убран из списка. Записи этого дня остались.'),
  ).toBeVisible()
  await page.getByRole('link', { name: 'Следующий день' }).click()
  await expect(breakfast).toHaveCount(2)
  await expect(page.getByText('Полдник')).toHaveCount(0)
  await expect(page.getByText('Обед')).toHaveCount(0)

  expect(problems).toEqual([])
})
