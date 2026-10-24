import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { adminInviteLink, register } from './steps.ts'
import { imagingZip } from './imaging-fixture.ts'

test('ZIP: upload, inspection, selection and import inside a study card', async ({
  page,
}, info) => {
  test.setTimeout(150_000)
  await register(
    page,
    adminInviteLink(),
    'Анна',
    `imaging-${info.project.name}-${Date.now()}@example.com`,
  )
  await page.getByRole('main').getByRole('link', { name: 'Исследования', exact: true }).click()
  await page.getByRole('button', { name: 'Добавить исследование' }).click()
  await page.getByLabel('Название', { exact: true }).fill('КТ и МРТ')
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await page.waitForURL(/\/studies\/[^/]+$/)
  await page
    .getByLabel('Выбрать ZIP или продолжить загрузку того же файла')
    .setInputFiles({ name: 'studies.zip', mimeType: 'application/zip', buffer: imagingZip })
  const confirm = page.getByRole('button', { name: 'Импортировать выбранное' })
  await expect(confirm).toBeVisible({ timeout: 60_000 })
  await expect(confirm).toBeDisabled()
  await expect(page.getByRole('checkbox')).toHaveCount(2)
  await page.getByRole('checkbox').nth(0).check()
  await page.getByRole('checkbox').nth(1).check()
  await page.screenshot({ path: info.outputPath('imaging-selection.png'), fullPage: true })
  await confirm.click()
  await expect(page.getByText('Импорт завершён.')).toBeVisible({ timeout: 60_000 })
  await page.reload()
  await expect(page.getByText('Импорт завершён.')).toBeVisible()
  await page.screenshot({ path: info.outputPath('imaging-ready.png'), fullPage: true })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const pixelRequests: string[] = []
  page.on('request', (request) => {
    if (request.url().endsWith('/pixels')) pixelRequests.push(request.url())
  })
  await page.getByRole('link', { name: 'Открыть снимки' }).click()
  await expect(page.getByText('Кадр 1 из 2')).toBeVisible()
  const viewport = page.getByTestId('dicom-viewport')
  await expect(viewport).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('navigation')).toHaveCount(0)
  const bands = async () =>
    viewport.locator('canvas:visible').evaluate((element) => {
      const canvas = element as HTMLCanvasElement
      const context = canvas.getContext('2d')!
      const size = Math.min(canvas.width, canvas.height)
      return [0.125, 0.375, 0.625, 0.875].map(
        (fraction) =>
          context.getImageData(
            Math.floor((canvas.width - size) / 2 + size * fraction),
            Math.floor(canvas.height / 2),
            1,
            1,
          ).data[0],
      )
    })
  await expect.poll(bands).toEqual([0, 127, 128, 255])
  expect(pixelRequests).toHaveLength(1)
  await page.screenshot({ path: info.outputPath('viewer.png'), fullPage: true })
  await page.getByRole('button', { name: 'Вперёд' }).click()
  await expect(page.getByText('Кадр 2 из 2')).toBeVisible()
  await expect(viewport).toBeVisible()
  await expect.poll(bands).toEqual([255, 128, 128, 0])
  await page.getByRole('slider', { name: 'Ширина окна', exact: true }).fill('4001')
  await expect.poll(async () => (await bands())[0]).toBeLessThan(255)
  await page.getByRole('button', { name: 'Масштаб', exact: true }).click()
  await page.getByRole('slider', { name: 'Масштаб', exact: true }).fill('2')
  await expect(page.getByText('Масштаб: 200%')).toBeVisible()
  await expect.poll(bands).not.toEqual([255, 128, 128, 0])
  await page.getByRole('button', { name: 'Сбросить' }).click()
  await expect.poll(bands).toEqual([255, 128, 128, 0])
  await page.getByRole('button', { name: 'Перемещение', exact: true }).click()
  await viewport.scrollIntoViewIfNeeded()
  const bounds = (await viewport.boundingBox())!
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  await page.mouse.down()
  await page.mouse.move(bounds.x + bounds.width * 0.7, bounds.y + bounds.height / 2, { steps: 5 })
  await page.mouse.up()
  await expect.poll(bands).not.toEqual([255, 128, 128, 0])
  await page.getByRole('button', { name: 'Сбросить' }).click()
  await expect.poll(bands).toEqual([255, 128, 128, 0])
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Скачать исходный ZIP' }).click()
  const downloaded = await downloading
  expect(await readFile((await downloaded.path())!)).toEqual(imagingZip)
  const cached = await page.evaluate(async () => {
    const urls: string[] = []
    for (const name of await caches.keys())
      for (const request of await (await caches.open(name)).keys()) urls.push(request.url)
    return urls.filter((url) => /\/api\/|viewerEngine-/.test(url))
  })
  expect(cached).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(errors).toEqual([])
  await page.getByRole('link', { name: 'К исследованию' }).click()
  await page.getByRole('main').getByRole('link', { name: 'Исследования', exact: true }).click()
  await expect(
    page.getByRole('main').getByRole('link').filter({ hasText: 'КТ и МРТ' }),
  ).toHaveCount(1)
  await page.getByRole('main').getByRole('link').filter({ hasText: 'MR phantom' }).click()
  await page.getByRole('link', { name: 'Открыть снимки' }).click()
  await expect(viewport).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('Ширина окна: 301')).toBeVisible()
  await expect.poll(bands).toEqual([255, 170, 85, 0])
  await page.getByRole('button', { name: 'Вперёд' }).click()
  await expect(page.getByText('Ширина окна: 901')).toBeVisible()
  await expect(viewport).toBeVisible()
  await expect.poll(bands).toEqual([255, 170, 85, 0])
  await page.screenshot({ path: info.outputPath('viewer-mr.png'), fullPage: true })
  expect(errors).toEqual([])
})
