import { expect, test } from '@playwright/test'

import { adminInviteLink, register } from './steps.ts'

// ADR 0020: приложение открывается без сети на копии, тренировка записывается в очередь и
// сама уходит на сервер, когда связь вернулась.
test('тренировка в режиме полёта уходит на сервер, когда связь вернулась', async ({
  page,
  context,
}, testInfo) => {
  const email = `offline-${testInfo.project.name}-${Date.now()}@example.com`
  await register(page, adminInviteLink(), 'Борис', email)
  await page.getByRole('link', { name: 'Тренировки' }).click()
  await page.getByRole('link', { name: 'Мои упражнения' }).click()
  await page.getByRole('button', { name: 'Добавить в список: Становая тяга' }).click()
  // Кнопка пропадает, когда сервер принял упражнение и список перечитан — уже и в копию.
  await expect(page.getByRole('button', { name: 'Добавить в список: Становая тяга' })).toBeHidden()
  await page.getByRole('link', { name: 'Тренировки' }).click()
  // Service worker управляет страницей со следующей загрузки — после неё оболочка есть в кэше.
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.reload()
  await expect(page.getByRole('button', { name: 'Начать тренировку' })).toBeVisible()

  await context.setOffline(true)
  await page.reload()
  await expect(page.getByText('Нет сети · записи сохраняются на телефоне')).toBeVisible()
  await page.getByRole('button', { name: 'Начать тренировку' }).click()
  await page
    .getByRole('combobox', { name: 'Выберите упражнение' })
    .selectOption({ label: 'Становая тяга' })
  await page.getByRole('button', { name: 'Добавить упражнение' }).click()
  await page.getByRole('spinbutton', { name: 'Вес, кг' }).fill('50')
  await page.getByRole('spinbutton', { name: 'Повторы' }).fill('8')
  await page.getByRole('button', { name: 'Сохранить подход' }).click()
  await expect(page.getByText('1. 50 кг × 8')).toBeVisible()
  await expect(page.getByRole('img', { name: 'Ещё не отправлено' })).toBeVisible()
  await expect(page.getByText('Нет сети · ждут отправки: 3')).toBeVisible()

  await context.setOffline(false)
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await expect(page.getByRole('img', { name: 'Ещё не отправлено' })).toBeHidden()
  await expect(page.getByRole('status').filter({ hasText: /Нет сети|Отправляем/ })).toBeHidden()

  await page.reload()
  await expect(page.getByText('1. 50 кг × 8')).toBeVisible()
  await expect(page.getByText('Идёт тренировка')).toBeVisible()
})
