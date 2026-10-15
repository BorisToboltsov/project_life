import { expect, test } from '@playwright/test'

import { adminInviteLink, register } from './steps.ts'

test('тренировка: подход, история, прогресс и повтор', async ({ page }, testInfo) => {
  const email = `workout-${testInfo.project.name}-${Date.now()}@example.com`
  await register(page, adminInviteLink(), 'Борис', email)

  await page.getByRole('link', { name: 'Тренировки' }).click()
  await page.getByRole('link', { name: 'Мои упражнения' }).click()
  await page.getByRole('button', { name: 'Добавить в список: Становая тяга' }).click()
  await page.getByRole('link', { name: 'Тренировки' }).click()

  await page.getByRole('button', { name: 'Начать тренировку' }).click()
  await expect(page.getByText('Идёт тренировка')).toBeVisible()
  await page
    .getByRole('combobox', { name: 'Выберите упражнение' })
    .selectOption({ label: 'Становая тяга' })
  await page.getByRole('button', { name: 'Добавить упражнение' }).click()
  await expect(page.getByRole('heading', { name: 'Становая тяга' })).toBeVisible()
  await page.getByRole('spinbutton', { name: 'Вес, кг' }).fill('50')
  await page.getByRole('spinbutton', { name: 'Повторы' }).fill('8')
  await page.getByRole('button', { name: 'Сохранить подход' }).click()
  await expect(page.getByText('1. 50 кг × 8')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Отдых' })).toBeVisible()
  await page.getByRole('button', { name: 'Завершить тренировку' }).click()
  await expect(page.getByText('Завершена')).toBeVisible()

  await page.goto('/workouts/exercises/deadlift')
  await expect(page.getByRole('heading', { name: 'Прогресс' })).toBeVisible()
  await expect(page.getByText('50 кг')).toBeVisible()
  await page.getByRole('link', { name: 'Тренировки' }).click()
  await page.getByRole('link', { name: /Упражнения: 1 · Подходы: 1/ }).click()
  await page.getByRole('button', { name: 'Повторить тренировку' }).click()
  await expect(page.getByText('Подходов пока нет.')).toBeVisible()
  const repeatedUrl = page.url()
  await page.getByRole('button', { name: 'Завершить тренировку' }).click()
  await page.getByRole('button', { name: 'Повторить тренировку' }).click()
  await expect(page).not.toHaveURL(repeatedUrl)
  await expect(page.getByText('Подходов пока нет.')).toBeVisible()
})
