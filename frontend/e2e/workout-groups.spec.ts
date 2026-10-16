import { expect, test } from '@playwright/test'

import { adminInviteLink, register } from './steps.ts'

test('группа: расписание, порядок упражнений, запуск и удаление без потери тренировки', async ({
  page,
}, testInfo) => {
  await register(
    page,
    adminInviteLink(),
    'Борис',
    `groups-${testInfo.project.name}-${Date.now()}@example.com`,
  )
  await page.getByRole('link', { name: 'Тренировки', exact: true }).click()
  await page.getByRole('link', { name: 'Мои упражнения' }).click()
  await page.getByRole('button', { name: 'Добавить в список: Становая тяга' }).click()
  await page.getByRole('button', { name: 'Добавить в список: Планка', exact: true }).click()
  await page.getByRole('link', { name: 'Тренировки', exact: true }).click()
  await page.getByRole('button', { name: 'Создать группу' }).click()
  await page.getByLabel('Название группы').fill('Спина и пресс')
  for (const name of ['Становая тяга', 'Планка']) {
    await page.getByRole('combobox', { name: 'Выберите упражнение' }).selectOption({ label: name })
    await page.getByRole('button', { name: 'Добавить упражнение', exact: true }).click()
  }
  await page.getByRole('button', { name: 'Поднять Планка' }).click()
  await page.getByText('Пн', { exact: true }).click()
  await expect(page.getByRole('checkbox', { name: 'Пн', exact: true })).toBeChecked()
  const today = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Moscow' }).format(new Date())
  await page.getByLabel('Добавить на дату', { exact: true }).fill(today)
  await page.getByRole('button', { name: 'Добавить дату', exact: true }).click()
  await page.getByRole('button', { name: 'Сохранить группу' }).click()
  await expect(page.getByRole('heading', { name: `На сегодня · ${today}` })).toBeVisible()
  await page.getByRole('button', { name: 'Начать из группы' }).first().click()
  await expect(page.getByRole('heading', { name: 'Планка', exact: true })).toBeVisible()
  await expect(page.getByText('Подходов пока нет.')).toBeVisible()
  const workoutUrl = page.url()
  await page.getByRole('button', { name: 'Завершить тренировку' }).click()
  await expect(page.getByText('Завершена', { exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Тренировки', exact: true }).click()
  page.once('dialog', (dialog) => void dialog.accept())
  await page.getByRole('button', { name: 'Убрать группу', exact: true }).first().click()
  await expect(page.getByRole('heading', { name: 'Спина и пресс', exact: true })).toHaveCount(0)
  await page.goto(workoutUrl)
  await expect(page.getByRole('heading', { name: 'Планка', exact: true })).toBeVisible()
})
