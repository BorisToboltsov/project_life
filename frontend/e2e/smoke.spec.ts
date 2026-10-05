import { expect, test } from '@playwright/test'

test('приложение открывается на экране входа', async ({ page }) => {
  await page.goto('/')

  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('heading', { name: 'Вход' })).toBeVisible()
})

test('страница грузится без ошибок в консоли и нарушений политики безопасности', async ({
  page,
}) => {
  const problems: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text())
  })
  page.on('pageerror', (error) => problems.push(error.message))

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Вход' })).toBeVisible()

  expect(problems).toEqual([])
})

test('язык переключается и сохраняется после перезагрузки', async ({ page }) => {
  await page.goto('/')

  await page.getByRole('button', { name: 'English' }).click()
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()

  await page.reload()
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
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

test('сервер жив и отдаёт версию', async ({ request }) => {
  const health = await request.get('/api/health')

  expect(health.ok()).toBe(true)
  expect(await health.json()).toMatchObject({
    status: 'ok',
    version: expect.stringMatching(/^\d+\.\d+\.\d+$/),
  })
})
