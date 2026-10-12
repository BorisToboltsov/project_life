import { expect, test } from '@playwright/test'

import { adminInviteLink, openUnderMore, register } from './steps.ts'

test('сбой в приложении виден администратору и удаляется', async ({ page }, testInfo) => {
  const suffix = `${testInfo.project.name}${Date.now()}`
  // Имя типа своё у каждого прогона: одинаковые сбои свелись бы в одну строку.
  const kind = `SmokeCrash${suffix}`

  await register(page, adminInviteLink(), 'Борис', `errors-${suffix}@example.com`)

  // Необработанное исключение вне отрисовки — как в обработчике нажатия.
  const reported = page.waitForResponse(
    (response) => response.url().endsWith('/api/errors') && response.request().method() === 'POST',
  )
  await page.evaluate((name) => {
    setTimeout(() => {
      const error = new Error('weight 72.4 is wrong')
      error.name = name
      throw error
    })
  }, kind)
  expect((await reported).status()).toBe(204)

  await openUnderMore(page, 'Управление')
  const row = page.getByRole('listitem').filter({ hasText: kind })
  // Сбой случился на главной; в отчёте её шаблон маршрута, а текста ошибки нет.
  await expect(row).toContainText('Приложение · /')
  await expect(row).toContainText('всего 1')
  await expect(page.getByText('72.4')).toHaveCount(0)

  await row.getByRole('button', { name: 'Удалить' }).click()
  await expect(row).toHaveCount(0)
})
