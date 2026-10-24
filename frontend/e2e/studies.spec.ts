import { expect, test } from '@playwright/test'
import { adminInviteLink, register } from './steps.ts'

test('исследование внутри здоровья: сведения, заключение, удаление', async ({ page }, info) => {
  await register(
    page,
    adminInviteLink(),
    'Анна',
    `studies-${info.project.name}-${Date.now()}@example.com`,
  )
  await page.getByRole('main').getByRole('link', { name: 'Исследования', exact: true }).click()
  await page.getByRole('button', { name: 'Добавить исследование' }).click()
  await page.getByLabel('Название', { exact: true }).fill('КТ грудной клетки')
  await page.getByLabel('Медицинская организация').fill('Клиника')
  await page.getByLabel('Заметка').fill('Контрольное исследование')
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await page.waitForURL(/\/studies\/[^/]+$/)
  const studyUrl = page.url()
  await expect(page.getByRole('heading', { name: 'КТ грудной клетки' })).toBeVisible()
  const files = page.getByRole('region', { name: 'Файлы' })
  await files.getByLabel('Прикрепить файл').setInputFiles({
    name: 'conclusion.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP8zwACTGCSAQANHQEDgslx/wAAAABJRU5ErkJggg==',
      'base64',
    ),
  })
  await files.getByRole('button', { name: 'Открыть', exact: true }).click()
  await expect(files.getByRole('img', { name: 'conclusion.png' })).toBeVisible()
  await page.getByLabel('Название', { exact: true }).fill('КТ — заключение')
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'КТ — заключение' })).toBeVisible()
  await page.screenshot({ path: info.outputPath('study.png'), fullPage: true })
  await page.getByRole('button', { name: 'Удалить', exact: true }).click()
  await expect(page.getByText('Удалить исследование и его вложения?')).toBeVisible()
  await page.getByRole('button', { name: 'Удалить', exact: true }).click()
  await page.waitForURL('**/studies')
  await expect(page.getByText('Исследований пока нет')).toBeVisible()
  await page.goto(studyUrl)
  await expect(page.getByText('Не удалось загрузить исследования')).toBeVisible()
})
