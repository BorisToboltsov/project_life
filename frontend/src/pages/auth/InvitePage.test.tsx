import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { callsTo, json, mockApi } from '@/test/api'
import { renderApp } from '@/test/app'
import { anna, sessionOf } from '@/test/fixtures'

const CHECK = 'POST /api/auth/invite/check'
const REGISTER = 'POST /api/auth/register'
const invite = { role: 'user', expires_at: '2026-10-12T10:00:00Z' }

async function fill(name: string, email: string, password: string) {
  await userEvent.type(await screen.findByLabelText('Как к вам обращаться'), name)
  await userEvent.type(screen.getByLabelText('Электронная почта'), email)
  await userEvent.type(screen.getByLabelText('Пароль'), password)
}

describe('регистрация по приглашению', () => {
  it('регистрирует и сразу открывает приложение', async () => {
    window.location.hash = '#invite-token'
    const calls = mockApi({ [CHECK]: json(200, invite), [REGISTER]: json(201, sessionOf(anna)) })
    await renderApp('/invite')

    await fill('Анна', 'anna@example.com', 'correct horse battery')
    await userEvent.click(screen.getByRole('checkbox'))
    await userEvent.click(screen.getByRole('button', { name: 'Зарегистрироваться' }))

    expect(await screen.findByRole('heading', { name: 'Здравствуйте, Анна!' })).toBeInTheDocument()
    expect(callsTo(calls, CHECK)[0].body).toEqual({ token: 'invite-token' })
    expect(callsTo(calls, REGISTER)[0].body).toEqual({
      token: 'invite-token',
      display_name: 'Анна',
      email: 'anna@example.com',
      password: 'correct horse battery',
      accept_disclaimer: true,
      language: 'ru',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    })
  })

  it('без согласия с дисклеймером и с коротким паролем не отправляет форму', async () => {
    window.location.hash = '#invite-token'
    const calls = mockApi({ [CHECK]: json(200, invite) })
    await renderApp('/invite')

    await fill('Анна', 'anna@example.com', 'short')
    await userEvent.click(screen.getByRole('button', { name: 'Зарегистрироваться' }))

    expect(await screen.findByText('Без согласия зарегистрироваться нельзя')).toBeInTheDocument()
    expect(screen.getByText('Пароль — от 10 до 128 символов')).toBeInTheDocument()
    expect(callsTo(calls, REGISTER)).toEqual([])
  })

  it('предупреждает, что приглашение даёт права администратора', async () => {
    window.location.hash = '#invite-token'
    mockApi({ [CHECK]: json(200, { ...invite, role: 'admin' }) })
    await renderApp('/invite')

    expect(
      await screen.findByText('Это приглашение даёт права администратора.'),
    ).toBeInTheDocument()
  })

  it('показывает отказ сервера, например занятый адрес', async () => {
    window.location.hash = '#invite-token'
    mockApi({ [CHECK]: json(200, invite), [REGISTER]: json(409, { detail: 'email_taken' }) })
    await renderApp('/invite')

    await fill('Анна', 'anna@example.com', 'correct horse battery')
    await userEvent.click(screen.getByRole('checkbox'))
    await userEvent.click(screen.getByRole('button', { name: 'Зарегистрироваться' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Этот адрес уже зарегистрирован.')
  })

  it.each([
    ['ссылка без токена', ''],
    ['токен не действует', '#used-token'],
  ])('%s — объясняет и ведёт ко входу', async (_name, hash) => {
    window.location.hash = hash
    mockApi({ [CHECK]: json(404, { detail: 'invite_invalid' }) })
    await renderApp('/invite')

    expect(
      await screen.findByRole('heading', { name: 'Приглашение не действует' }),
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('link', { name: 'Перейти ко входу' }))
    expect(await screen.findByRole('heading', { name: 'Вход' })).toBeInTheDocument()
  })
})
