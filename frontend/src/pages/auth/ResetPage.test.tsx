import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { callsTo, json, mockApi } from '@/test/api'
import { renderApp } from '@/test/app'

const CHECK = 'POST /api/auth/password-reset/check'
const RESET = 'POST /api/auth/password-reset'
const info = { display_name: 'Анна', expires_at: '2026-10-06T10:00:00Z' }

describe('сброс пароля по ссылке', () => {
  it('задаёт новый пароль и ведёт ко входу', async () => {
    window.location.hash = '#reset-token'
    const calls = mockApi({ [CHECK]: json(200, info), [RESET]: json(204) })
    await renderApp('/reset')

    expect(await screen.findByText('Новый пароль для пользователя Анна')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Новый пароль'), 'a brand new passphrase')
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить пароль' }))

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Пароль изменён. Теперь можно войти.',
    )
    expect(callsTo(calls, RESET)[0].body).toEqual({
      token: 'reset-token',
      new_password: 'a brand new passphrase',
    })
    await userEvent.click(screen.getByRole('link', { name: 'Перейти ко входу' }))
    expect(await screen.findByRole('heading', { name: 'Вход' })).toBeInTheDocument()
  })

  it('не принимает короткий пароль', async () => {
    window.location.hash = '#reset-token'
    const calls = mockApi({ [CHECK]: json(200, info) })
    await renderApp('/reset')

    await userEvent.type(await screen.findByLabelText('Новый пароль'), 'short')
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить пароль' }))

    expect(await screen.findByText('Пароль — от 10 до 128 символов')).toBeInTheDocument()
    expect(callsTo(calls, RESET)).toEqual([])
  })

  it('недействительная ссылка — объясняет, что делать', async () => {
    window.location.hash = '#old-token'
    mockApi({ [CHECK]: json(404, { detail: 'reset_invalid' }) })
    await renderApp('/reset')

    expect(await screen.findByRole('heading', { name: 'Ссылка не действует' })).toBeInTheDocument()
  })

  it('ссылка устарела, пока пользователь вводил пароль', async () => {
    window.location.hash = '#reset-token'
    mockApi({ [CHECK]: json(200, info), [RESET]: json(404, { detail: 'reset_invalid' }) })
    await renderApp('/reset')

    await userEvent.type(await screen.findByLabelText('Новый пароль'), 'a brand new passphrase')
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить пароль' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Ссылка для сброса не действует.')
  })
})
