import { expect, test } from '@playwright/test'

import { adminInviteLink, login, logout, PASSWORD, register } from './steps.ts'

test('администратор приглашает пользователя, тот регистрируется и ведёт профиль', async ({
  page,
}, testInfo) => {
  const suffix = `${testInfo.project.name}-${Date.now()}`
  const adminEmail = `admin-${suffix}@example.com`
  const memberEmail = `member-${suffix}@example.com`

  // Администратор регистрируется по ссылке из командной строки и создаёт приглашение.
  await register(page, adminInviteLink(), 'Борис', adminEmail)
  await page.getByRole('link', { name: 'Управление' }).click()
  await page.getByLabel('Для кого (необязательно)').fill(`для ${suffix}`)
  await page.getByRole('button', { name: 'Создать приглашение' }).click()
  const inviteLink = await page.getByLabel('Ссылка-приглашение').inputValue()
  expect(inviteLink).toContain('/invite#')
  await logout(page)

  // Приглашённый регистрируется и заполняет профиль.
  await register(page, inviteLink, 'Анна', memberEmail)
  await expect(page.getByRole('link', { name: 'Управление' })).toHaveCount(0)
  await page.getByRole('link', { name: 'Профиль' }).click()
  await page.getByLabel('Рост, см').fill('168.5')
  await page.getByLabel('Пол').selectOption('female')
  // Дата набирается одними цифрами и показывается как день/месяц/год.
  const birthDate = page.getByLabel('Дата рождения')
  await birthDate.pressSequentially('17051990')
  await expect(birthDate).toHaveValue('17/05/1990')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByText('Сохранено')).toBeVisible()

  // Перезагрузка не разлогинивает: сессия восстанавливается по refresh-cookie.
  await page.reload()
  await expect(page.getByLabel('Рост, см')).toHaveValue('168.5')
  await expect(page.getByLabel('Пол')).toHaveValue('female')
  await expect(birthDate).toHaveValue('17/05/1990')

  // Тот же день можно сменить в календаре: он открывается на сохранённом месяце.
  await page.getByRole('button', { name: 'Открыть календарь' }).click()
  await expect(page.getByLabel('Выберите год')).toHaveValue('1990')
  await page.getByRole('button', { name: /23 мая 1990/ }).click()
  await expect(birthDate).toHaveValue('23/05/1990')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByText('Сохранено')).toBeVisible()

  // Управление закрыто и по прямому адресу, и на уровне API.
  await page.goto('/admin')
  await expect(page.getByRole('heading', { name: 'Здравствуйте, Анна!' })).toBeVisible()

  // Использованное приглашение второй раз не работает.
  await logout(page)
  await page.goto(inviteLink)
  await expect(page.getByRole('heading', { name: 'Приглашение не действует' })).toBeVisible()

  // Вход по паролю.
  await login(page, memberEmail)
  await expect(page.getByRole('heading', { name: 'Здравствуйте, Анна!' })).toBeVisible()
})

test('администратор выдаёт ссылку для сброса пароля', async ({ page }, testInfo) => {
  const suffix = `${testInfo.project.name}-${Date.now()}`
  const email = `reset-${suffix}@example.com`
  const newPassword = 'a brand new passphrase'

  await register(page, adminInviteLink(), 'Вера', email)
  await page.getByRole('link', { name: 'Управление' }).click()
  const row = page.getByRole('listitem').filter({ hasText: email })
  await row.getByRole('button', { name: 'Ссылка для сброса пароля' }).click()
  const resetLink = await page.getByLabel('Ссылка для сброса пароля: Вера').inputValue()
  await logout(page)

  await page.goto(resetLink)
  await expect(page.getByText('Новый пароль для пользователя Вера')).toBeVisible()
  await page.getByLabel('Новый пароль').fill(newPassword)
  await page.getByRole('button', { name: 'Сохранить пароль' }).click()
  await expect(page.getByText('Пароль изменён. Теперь можно войти.')).toBeVisible()

  await login(page, email, PASSWORD)
  await expect(page.getByRole('alert')).toHaveText('Неверная почта или пароль.')
  await login(page, email, newPassword)
  await expect(page.getByRole('heading', { name: 'Здравствуйте, Вера!' })).toBeVisible()
})
