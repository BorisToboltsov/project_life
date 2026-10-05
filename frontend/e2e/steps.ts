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

export async function logout(page: Page) {
  await page.getByRole('link', { name: 'Профиль' }).click()
  await page.getByRole('button', { name: 'Выйти', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Вход' })).toBeVisible()
}
