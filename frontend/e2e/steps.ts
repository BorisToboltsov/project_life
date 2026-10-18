import { execSync } from 'node:child_process'

import { expect, type Page } from '@playwright/test'

export const PASSWORD = 'correct horse battery'
// Стенд уже запущен; имени проекта достаточно, чтобы найти его контейнеры.
const COMPOSE = 'docker compose -p life-e2e'

/** Первого администратора заводят из командной строки сервера — так же, как на живом стенде. */
export function adminInviteLink(): string {
  return execSync(`${COMPOSE} exec -T backend python -m app.cli invite --admin`).toString().trim()
}

export async function register(page: Page, link: string, name: string, email: string) {
  await page.goto(link)
  await page.getByLabel('Как к вам обращаться').fill(name)
  await page.getByLabel('Электронная почта').fill(email)
  await page.getByLabel('Пароль').fill(PASSWORD)
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Зарегистрироваться' }).click()
  await expect(page.getByRole('heading', { name: `Здравствуйте, ${name}!` })).toBeVisible()
}

export async function login(page: Page, email: string, password = PASSWORD) {
  await page.goto('/login')
  await page.getByLabel('Электронная почта').fill(email)
  await page.getByLabel('Пароль').fill(password)
  await page.getByRole('button', { name: 'Войти' }).click()
}

/**
 * Профиль и управление: на компьютере они стоят в колонке разделов, на телефоне — под
 * «Ещё» в нижней панели.
 */
export async function openUnderMore(page: Page, name: 'Профиль' | 'Управление') {
  const more = page.getByRole('link', { name: 'Ещё' })
  if (await more.isVisible()) await more.click()
  await page.getByRole('link', { name }).click()
}

export async function logout(page: Page) {
  await openUnderMore(page, 'Профиль')
  await page.getByRole('button', { name: 'Выйти', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Вход' })).toBeVisible()
}

/**
 * Заводит продукт. Калории `null` — их не вводят: поле считается по белкам, жирам и
 * углеводам, и в нём ждём `expected`.
 */
export async function createProduct(
  page: Page,
  name: string,
  [kcal, protein, fat, carbs]: [string | null, string, string, string],
  { unit, expected }: { unit?: string; expected?: string } = {},
) {
  await page.getByRole('link', { name: 'Создать продукт' }).click()
  await page.getByLabel('Название').fill(name)
  if (unit) await page.getByLabel('В чём измеряется').selectOption({ label: unit })
  if (kcal !== null) await page.getByLabel('Калории, ккал').fill(kcal)
  await page.getByLabel('Белки, г').fill(protein)
  await page.getByLabel('Жиры, г', { exact: true }).fill(fat)
  await page.getByLabel('Углеводы, г').fill(carbs)
  if (expected) await expect(page.getByLabel('Калории, ккал')).toHaveValue(expected)
  await page.getByRole('button', { name: 'Сохранить' }).click()
}
