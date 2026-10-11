import { expect, type Page, test } from '@playwright/test'

import { freshBarcode } from './barcode.ts'
import { adminInviteLink, register } from './steps.ts'

async function openScanner(page: Page, meal: string) {
  await page.getByRole('link', { name: `Добавить: ${meal}` }).click()
  await page.getByRole('link', { name: 'Сканировать штрихкод' }).click()
  await expect(page.getByRole('heading', { name: 'Штрихкод' })).toBeVisible()
}

async function typeBarcode(page: Page, barcode: string) {
  await page.getByLabel('Штрихкод цифрами').fill(barcode)
  await page.getByRole('button', { name: 'Найти' }).click()
}

test('сканер: штрихкод с камеры → продукт из Open Food Facts → запись в дневнике', async ({
  page,
}, testInfo) => {
  const problems: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text())
  })
  page.on('pageerror', (error) => problems.push(error.message))
  // Распознавание, встроенное в браузер, есть не на каждой системе; без него работает
  // zxing-wasm — путь iPhone. Его и проверяем: модуль WebAssembly обязан загрузиться со
  // своего адреса и пройти политику безопасности.
  await page.addInitScript(() => {
    delete (window as { BarcodeDetector?: unknown }).BarcodeDetector
  })
  const suffix = `${testInfo.project.name}-${Date.now()}`
  await register(page, adminInviteLink(), 'Борис', `scan-${suffix}@example.com`)
  await page.getByRole('link', { name: 'Открыть дневник' }).click()

  // Камера → штрихкод → продукт уже ждёт количества. Откуда он — из Open Food Facts или
  // уже из каталога стенда после прошлого прогона — для пути неважно. Сканер срабатывает
  // быстрее, чем его экран успевает показаться, поэтому ждём сразу итог.
  const wasm = page.waitForResponse((response) => response.url().endsWith('.wasm'))
  await page.getByRole('link', { name: 'Добавить: Завтрак' }).click()
  await page.getByRole('link', { name: 'Сканировать штрихкод' }).click()
  expect(new URL((await wasm).url()).origin).toBe(new URL(page.url()).origin)
  const found = page.getByRole('list', { name: 'По штрихкоду' })
  await expect(found.getByRole('button', { name: /Йогурт натуральный, Стенд/ })).toBeVisible()
  await expect(found).toContainText('68 ккал · Б 5 · Ж 3,2 · У 4,7 на 100 г')
  await found.getByLabel('Сколько, г').fill('350')
  await found.getByRole('button', { name: 'Добавить', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText('Добавлено: Йогурт натуральный, Стенд, 350 г')
  await expect(found).toHaveCount(0)
  await page.getByRole('link', { name: 'Готово' }).click()
  await expect(page.getByRole('list', { name: 'Завтрак' }).getByRole('listitem')).toContainText(
    '350 г · 238 ккал',
  )

  // Тот же продукт во второй раз: количество подставлено из прошлого.
  await page.getByRole('link', { name: 'Добавить: Завтрак' }).click()
  await page.getByRole('link', { name: 'Сканировать штрихкод' }).click()
  await expect(found.getByLabel('Сколько, г')).toHaveValue('350')

  expect(problems).toEqual([])
})

test('сканер: ненайденный и неполный продукт дополняются вручную и дальше находятся', async ({
  page,
}, testInfo) => {
  // Доступа к камере человек не дал: штрихкод вводится цифрами.
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () =>
      Promise.reject(new DOMException('Permission denied', 'NotAllowedError'))
  })
  const suffix = `${testInfo.project.name}-${Date.now()}`
  await register(page, adminInviteLink(), 'Борис', `scan-form-${suffix}@example.com`)
  await page.getByRole('link', { name: 'Открыть дневник' }).click()

  // Штрихкода нет нигде: форма продукта открывается уже с ним.
  const unknown = freshBarcode('4699')
  const cheese = `Сырок ${suffix}`
  await openScanner(page, 'Обед')
  await expect(
    page.getByText(
      'Нет доступа к камере. Разрешите его в настройках браузера или введите штрихкод цифрами.',
    ),
  ).toBeVisible()
  await typeBarcode(page, '4600000000000')
  await expect(page.getByText('Проверьте штрихкод: 8, 12 или 13 цифр')).toBeVisible()
  await typeBarcode(page, unknown)
  await expect(page.getByRole('status')).toContainText(`Штрихкод ${unknown} не найден.`)
  await expect(page.getByLabel('Штрихкод')).toHaveValue(unknown)
  await page.getByLabel('Название').fill(cheese)
  await page.getByLabel('Белки, г').fill('8')
  await page.getByLabel('Жиры, г').fill('23')
  await page.getByLabel('Углеводы, г').fill('30')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await page.getByLabel('Сколько, г').fill('45')
  await page.getByRole('button', { name: 'Добавить', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText(`Добавлено: ${cheese}, 45 г`)

  // Теперь этот штрихкод находится в своём каталоге.
  await page.getByRole('link', { name: 'Сканировать штрихкод' }).click()
  await typeBarcode(page, unknown)
  const found = page.getByRole('list', { name: 'По штрихкоду' })
  await expect(found.getByRole('button', { name: new RegExp(cheese) })).toBeVisible()
  await expect(found.getByLabel('Сколько, г')).toHaveValue('45')

  // В Open Food Facts продукт есть, но без состава: известное подставлено, остальное —
  // с упаковки. Напиток заведён в миллилитрах.
  const partial = freshBarcode('4602')
  await page.getByRole('link', { name: 'Сканировать штрихкод' }).click()
  await typeBarcode(page, partial)
  await expect(page.getByRole('status')).toContainText(
    `Продукт ${partial} есть в Open Food Facts, но состав там неполный.`,
  )
  await expect(page.getByLabel('Название')).toHaveValue('Морс клюквенный, Стенд')
  await expect(page.getByLabel('В чём измеряется')).toHaveValue('ml')
  await page.getByLabel('Название').fill(`Морс ${suffix}`)
  await page.getByLabel('Белки, г').fill('0')
  await page.getByLabel('Жиры, г').fill('0')
  await page.getByLabel('Углеводы, г').fill('11')
  await expect(page.getByLabel('Калории, ккал')).toHaveValue('44')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await page.getByLabel('Сколько, мл').fill('200')
  await page.getByRole('button', { name: 'Добавить', exact: true }).click()
  await page.getByRole('link', { name: 'Готово' }).click()
  await expect(page.getByRole('list', { name: 'Обед' }).getByRole('listitem')).toHaveCount(2)

  // Занятый штрихкод второму продукту не достаётся.
  await page.getByRole('link', { name: 'Каталог продуктов' }).click()
  await page.getByRole('link', { name: 'Создать продукт' }).click()
  await page.getByLabel('Название').fill(`Дубль ${suffix}`)
  await page.getByLabel('Белки, г').fill('1')
  await page.getByLabel('Жиры, г').fill('1')
  await page.getByLabel('Углеводы, г').fill('1')
  await page.getByLabel('Штрихкод').fill(unknown)
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('alert')).toHaveText(
    'Продукт с таким штрихкодом уже есть в каталоге.',
  )
})
