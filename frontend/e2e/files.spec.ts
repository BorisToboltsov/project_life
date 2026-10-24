import { expect, test } from '@playwright/test'
import { adminInviteLink, register } from './steps.ts'

test('файл бланка: загрузка, просмотр, скачивание и удаление', async ({ page }, info) => {
  await register(
    page,
    adminInviteLink(),
    'Анна',
    `files-${info.project.name}-${Date.now()}@example.com`,
  )
  await page.goto('/labs/new')
  await page.getByLabel('Лаборатория').fill('Файлы')
  await page.getByRole('button', { name: 'Создать бланк' }).click()
  await page.waitForURL(/\/labs\/[^/]+\/add$/)
  await page.goto(page.url().replace(/\/add$/, ''))
  const files = page.getByRole('region', { name: 'Файлы' })
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP8zwACTGCSAQANHQEDgslx/wAAAABJRU5ErkJggg==',
    'base64',
  )
  const data = Buffer.concat([png, Buffer.alloc(9 * 1024 * 1024)])
  let interrupted = false
  let firstPartUploads = 0
  await page.route('**/life-uploads/**', async (route) => {
    const part = new URL(route.request().url()).searchParams.get('partNumber')
    if (part === '1') {
      firstPartUploads++
      const wrongSize = await page.request.put(route.request().url(), { data: Buffer.alloc(1) })
      expect(wrongSize.status()).toBe(403)
    }
    if (part === '2' && !interrupted) {
      interrupted = true
      await route.abort()
    } else await route.continue()
  })
  await files
    .getByLabel('Прикрепить файл')
    .setInputFiles({ name: 'scan.png', mimeType: 'image/png', buffer: data })
  await expect(files.getByRole('alert')).toBeVisible()
  await files
    .getByLabel('Прикрепить файл')
    .setInputFiles({ name: 'scan.png', mimeType: 'image/png', buffer: data })
  await expect(files.getByRole('button', { name: 'Открыть', exact: true })).toBeVisible({
    timeout: 20000,
  })
  expect(firstPartUploads).toBe(1)
  await files.getByRole('button', { name: 'Открыть', exact: true }).click()
  await expect(files.getByRole('img', { name: 'scan.png' })).toBeVisible()
  const downloaded = page.waitForEvent('download')
  await files.getByRole('button', { name: 'Скачать' }).click()
  expect((await downloaded).suggestedFilename()).toBe('scan.png')
  await page.screenshot({ path: info.outputPath('files.png'), fullPage: true })
  await files.getByRole('button', { name: 'Удалить файл', exact: true }).click()
  await files.getByRole('button', { name: 'Удалить', exact: true }).click()
  await expect(files.getByText('scan.png', { exact: true })).toHaveCount(0)
  const pdf = Buffer.from(
    'JVBERi0xLjMKJeLjz9MKMSAwIG9iago8PAovUHJvZHVjZXIgKHB5cGRmKQo+PgplbmRvYmoKMiAwIG9iago8PAovVHlwZSAvUGFnZXMKL0NvdW50IDIKL0tpZHMgWyA0IDAgUiA2IDAgUiBdCj4+CmVuZG9iagozIDAgb2JqCjw8Ci9UeXBlIC9DYXRhbG9nCi9QYWdlcyAyIDAgUgo+PgplbmRvYmoKNCAwIG9iago8PAovVHlwZSAvUGFnZQovUmVzb3VyY2VzIDw8Ci9Gb250IDw8Ci9GMSA8PAovVHlwZSAvRm9udAovU3VidHlwZSAvVHlwZTEKL0Jhc2VGb250IC9IZWx2ZXRpY2EKPj4KPj4KPj4KL01lZGlhQm94IFsgMC4wIDAuMCAyMDAgMjAwIF0KL1BhcmVudCAyIDAgUgovQ29udGVudHMgNSAwIFIKPj4KZW5kb2JqCjUgMCBvYmoKPDwKL0xlbmd0aCA0MQo+PgpzdHJlYW0KQlQgL0YxIDE2IFRmIDIwIDEwMCBUZCAoTGFiIHJlcG9ydCkgVGogRVQKZW5kc3RyZWFtCmVuZG9iago2IDAgb2JqCjw8Ci9UeXBlIC9QYWdlCi9SZXNvdXJjZXMgPDwKPj4KL01lZGlhQm94IFsgMC4wIDAuMCAyMDAgMjAwIF0KL1BhcmVudCAyIDAgUgo+PgplbmRvYmoKeHJlZgowIDcKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDE1IDAwMDAwIG4gCjAwMDAwMDAwNTQgMDAwMDAgbiAKMDAwMDAwMDExOSAwMDAwMCBuIAowMDAwMDAwMTY4IDAwMDAwIG4gCjAwMDAwMDAzNDkgMDAwMDAgbiAKMDAwMDAwMDQ0MCAwMDAwMCBuIAp0cmFpbGVyCjw8Ci9TaXplIDcKL1Jvb3QgMyAwIFIKL0luZm8gMSAwIFIKPj4Kc3RhcnR4cmVmCjUzNAolJUVPRgo=',
    'base64',
  )
  await files
    .getByLabel('Прикрепить файл')
    .setInputFiles({ name: 'report.pdf', mimeType: 'application/pdf', buffer: pdf })
  await files.getByRole('button', { name: 'Открыть', exact: true }).click()
  await expect(files.getByText('Страница 1 из 2')).toBeVisible()
  await expect(files.locator('canvas')).toHaveJSProperty('width', 300)
  await expect
    .poll(async () =>
      files.locator('canvas').evaluate((element) => {
        const canvas = element as HTMLCanvasElement
        const context = canvas.getContext('2d')!
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
        return pixels.some(
          (value, index) => index % 4 === 0 && value < 200 && pixels[index + 3] > 0,
        )
      }),
    )
    .toBe(true)
  await files.getByRole('button', { name: 'Следующая', exact: true }).click()
  await expect(files.getByText('Страница 2 из 2')).toBeVisible()
  await expect(files.getByRole('alert')).toHaveCount(0)
})
