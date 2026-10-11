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

test('оболочка открывается без сети', async ({ page, context }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Вход' })).toBeVisible()
  // Service worker положил приложение в кэш; страницей он управляет со следующей загрузки.
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Вход' })).toBeVisible()

  // Сети нет, а приложение открылось — вместе с экраном, который подгружается отдельно.
  await context.setOffline(true)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Вход' })).toBeVisible()

  // На устройстве, где уже входили, приложение говорит, что связи нет, и ждёт её.
  await page.evaluate(() => localStorage.setItem('life.session', '1'))
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Нет связи с сервером' })).toBeVisible()
  await context.setOffline(false)
  await page.getByRole('button', { name: 'Повторить' }).click()
  await expect(page.getByRole('heading', { name: 'Вход' })).toBeVisible()
})

test('первая загрузка не тянет экраны, которые не открыты', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Вход' })).toBeVisible()

  // Что скачала сама страница; service worker кладёт в кэш всю сборку, но в фоне.
  const scripts = await page.evaluate(() =>
    performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .filter((name) => name.endsWith('.js')),
  )

  expect(scripts.some((name) => name.includes('LoginPage'))).toBe(true)
  expect(
    scripts.filter((name) =>
      /Diary|AddFood|Scan|Product|Measurement|Profile|Admin|Chart/.test(name),
    ),
  ).toEqual([])
})

test('сервер жив и отдаёт версию', async ({ request }) => {
  const health = await request.get('/api/health')

  expect(health.ok()).toBe(true)
  expect(await health.json()).toMatchObject({
    status: 'ok',
    version: expect.stringMatching(/^\d+\.\d+\.\d+$/),
  })
})
