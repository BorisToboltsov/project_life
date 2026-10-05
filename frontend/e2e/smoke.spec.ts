import { expect, test } from '@playwright/test'

test('приложение открывается и видит сервер', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'project_life' })).toBeVisible()
  await expect(page.getByRole('status')).toContainText(/версия \d+\.\d+\.\d+|version \d+\.\d+\.\d+/)
})

test('язык переключается и сохраняется после перезагрузки', async ({ page }) => {
  await page.goto('/')

  await page.getByRole('button', { name: 'English' }).click()
  await expect(page.getByRole('status')).toContainText('Server is up')

  await page.reload()
  await expect(page.getByRole('status')).toContainText('Server is up')
})

test('приложение устанавливается: есть манифест и service worker', async ({ page }) => {
  await page.goto('/')

  const manifest = await page.request.get('/manifest.webmanifest')
  expect(manifest.ok()).toBe(true)
  expect(await manifest.json()).toMatchObject({ display: 'standalone', short_name: 'Life' })

  const registration = await page.evaluate(async () => {
    const ready = await navigator.serviceWorker.ready
    return ready.active?.state
  })
  expect(['activating', 'activated']).toContain(registration)
})
