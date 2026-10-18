import { expect, test } from '@playwright/test'

import { adminInviteLink, register } from './steps.ts'

test('тесты: Купер с оценкой по нормам, отжимания с колен и ссылка с карточки упражнения', async ({
  page,
}, testInfo) => {
  const email = `fitness-${testInfo.project.name}-${Date.now()}@example.com`
  await register(page, adminInviteLink(), 'Анна', email)

  // Без пола и даты рождения в профиле — VO2max без оценки.
  await page.getByRole('link', { name: 'Тренировки' }).click()
  await page.getByRole('link', { name: /^Тест Купера/ }).click()
  await page.getByRole('link', { name: 'Внести результат' }).click()
  await page.getByLabel('Дистанция за 12 минут').fill('2300')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('heading', { name: 'Тест Купера' })).toBeVisible()
  await expect(page.getByText('40,1', { exact: true })).toBeVisible()
  await expect(page.getByText(/Укажите в профиле пол и дату рождения/)).toBeVisible()

  await page.getByRole('link', { name: 'Открыть профиль' }).click()
  await page.getByLabel('Пол').selectOption('female')
  await page.getByLabel('Дата рождения').pressSequentially('17051990')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByText('Сохранено')).toBeVisible()

  await page.goto('/workouts/tests/cooper')
  await expect(page.getByRole('img', { name: 'Оценка: выше среднего' })).toBeVisible()
  await expect(page.getByText('По таблице Купера для женщин 30–39 лет')).toBeVisible()

  // Отжимания: у женщины по умолчанию — с колен, по ним и оценка.
  await page.getByRole('link', { name: 'Ко всем тестам' }).click()
  await page.getByRole('link', { name: /^Отжимания/ }).click()
  await page.getByRole('link', { name: 'Внести результат' }).click()
  await expect(page.getByRole('radio', { name: 'С колен' })).toBeChecked()
  await page.getByLabel('Повторы').fill('21')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('img', { name: 'Оценка: очень хорошо' })).toBeVisible()

  const tests = page.getByRole('list', { name: 'Тесты' })
  await page.getByRole('link', { name: 'Ко всем тестам' }).click()
  await expect(tests.getByRole('link', { name: /^Тест Купера/ })).toContainText('VO2max 40,1')
  await expect(tests.getByRole('link', { name: /^Отжимания/ })).toContainText('21 раз')
  await expect(tests.getByRole('link', { name: /^Подтягивания/ })).toContainText('Ещё не проходили')

  await page.goto('/workouts/exercises/push_up')
  await expect(page.getByRole('link', { name: /^Тест: 21 раз · / })).toBeVisible()
})
