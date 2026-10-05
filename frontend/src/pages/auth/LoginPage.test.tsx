import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { json, mockApi } from '@/test/api'
import { renderApp } from '@/test/app'
import { anna, sessionOf } from '@/test/fixtures'

async function fillAndSubmit(email: string, password: string) {
  if (email) await userEvent.type(await screen.findByLabelText('Электронная почта'), email)
  if (password) await userEvent.type(screen.getByLabelText('Пароль'), password)
  await userEvent.click(await screen.findByRole('button', { name: 'Войти' }))
}

describe('вход', () => {
  it('пускает с верными данными и открывает главную', async () => {
    const calls = mockApi({ 'POST /api/auth/login': json(200, sessionOf(anna)) })
    await renderApp('/login')

    await fillAndSubmit('anna@example.com', 'correct horse battery')

    expect(await screen.findByRole('heading', { name: 'Здравствуйте, Анна!' })).toBeInTheDocument()
    expect(calls[0].body).toEqual({ email: 'anna@example.com', password: 'correct horse battery' })
    expect(localStorage.getItem('life.session')).toBe('1')
  })

  it('не отправляет форму с пустыми полями', async () => {
    const calls = mockApi({})
    await renderApp('/login')

    await fillAndSubmit('', '')

    expect(await screen.findByText('Введите адрес электронной почты')).toBeInTheDocument()
    expect(screen.getByText('Заполните поле')).toBeInTheDocument()
    expect(screen.getByLabelText('Электронная почта')).toBeInvalid()
    expect(calls).toEqual([])
  })

  it.each([
    [json(401, { detail: 'invalid_credentials' }), 'Неверная почта или пароль.'],
    [
      json(429, { detail: 'too_many_attempts' }),
      'Слишком много попыток. Подождите немного и попробуйте снова.',
    ],
    [json(500, { detail: 'boom' }), 'Что-то пошло не так. Попробуйте ещё раз.'],
  ])('объясняет отказ сервера', async (response, text) => {
    mockApi({ 'POST /api/auth/login': response })
    await renderApp('/login')

    await fillAndSubmit('anna@example.com', 'wrong password')

    expect(await screen.findByRole('alert')).toHaveTextContent(text)
    expect(screen.getByRole('heading', { name: 'Вход' })).toBeInTheDocument()
  })

  it('сообщает, когда сервер недоступен', async () => {
    await renderApp('/login')
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    )

    await fillAndSubmit('anna@example.com', 'correct horse battery')

    expect(await screen.findByRole('alert')).toHaveTextContent('Нет связи с сервером.')
  })

  it('переключает язык до входа', async () => {
    await renderApp('/login')

    await userEvent.click(await screen.findByRole('button', { name: 'English' }))

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(localStorage.getItem('life.language')).toBe('en')
  })
})
