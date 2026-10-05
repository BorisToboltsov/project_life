import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { callsTo, json, mockApi, sequence } from '@/test/api'
import { renderApp } from '@/test/app'
import { anna, boris } from '@/test/fixtures'

const USERS = 'GET /api/admin/users'
const INVITES = 'GET /api/admin/invites'
const pending = {
  id: '0199b7a0-0000-7000-8000-0000000000aa',
  role: 'user',
  note: 'для мамы',
  created_at: '2026-10-05T10:00:00Z',
  expires_at: '2026-10-12T10:00:00Z',
}
const users = [
  {
    ...boris,
    display_name: 'Борис',
    email: 'boris@example.com',
    created_at: '2026-10-01T10:00:00Z',
  },
  { ...anna, created_at: '2026-10-02T10:00:00Z' },
]

describe('приглашения', () => {
  it('создаёт приглашение и показывает ссылку, которую можно скопировать', async () => {
    const user = userEvent.setup()
    const calls = mockApi({
      [USERS]: json(200, []),
      [INVITES]: sequence(json(200, []), json(200, [pending])),
      'POST /api/admin/invites': json(201, { ...pending, token: 'fresh-token' }),
    })
    await renderApp('/admin', boris)
    expect(await screen.findByText('Действующих приглашений нет.')).toBeInTheDocument()

    await user.type(screen.getByLabelText('Для кого (необязательно)'), 'для мамы')
    await user.click(screen.getByRole('button', { name: 'Создать приглашение' }))

    const link = await screen.findByLabelText('Ссылка-приглашение')
    expect(link).toHaveValue(`${window.location.origin}/invite#fresh-token`)
    expect(callsTo(calls, 'POST /api/admin/invites')[0].body).toEqual({
      role: 'user',
      note: 'для мамы',
    })
    await user.click(screen.getByRole('button', { name: 'Копировать' }))
    expect(await screen.findByRole('button', { name: 'Скопировано' })).toBeInTheDocument()
    expect(await navigator.clipboard.readText()).toBe(
      `${window.location.origin}/invite#fresh-token`,
    )
    // Список перечитан: новое приглашение в нём, срок — в часовом поясе администратора.
    expect(await screen.findByText('для мамы')).toBeInTheDocument()
    expect(
      screen.getByText(/Пользователь · Действует до 12 окт\. 2026 г\., 13:00/),
    ).toBeInTheDocument()
  })

  it('приглашение администратора уходит с ролью и без пометки', async () => {
    const calls = mockApi({
      [USERS]: json(200, []),
      [INVITES]: json(200, []),
      'POST /api/admin/invites': json(201, { ...pending, role: 'admin', note: null, token: 't' }),
    })
    await renderApp('/admin', boris)

    await userEvent.selectOptions(await screen.findByLabelText('Роль'), 'admin')
    await userEvent.click(screen.getByRole('button', { name: 'Создать приглашение' }))

    await screen.findByLabelText('Ссылка-приглашение')
    expect(callsTo(calls, 'POST /api/admin/invites')[0].body).toEqual({ role: 'admin', note: null })
  })

  it('отзывает приглашение', async () => {
    const calls = mockApi({
      [USERS]: json(200, []),
      [INVITES]: sequence(json(200, [pending]), json(200, [])),
      [`DELETE /api/admin/invites/${pending.id}`]: json(204),
    })
    await renderApp('/admin', boris)

    await userEvent.click(await screen.findByRole('button', { name: 'Отозвать' }))

    expect(await screen.findByText('Действующих приглашений нет.')).toBeInTheDocument()
    expect(callsTo(calls, `DELETE /api/admin/invites/${pending.id}`)).toHaveLength(1)
  })

  it('показывает отказ сервера', async () => {
    mockApi({
      [USERS]: json(200, []),
      [INVITES]: json(200, []),
      'POST /api/admin/invites': json(403, { detail: 'forbidden' }),
    })
    await renderApp('/admin', boris)

    await userEvent.click(await screen.findByRole('button', { name: 'Создать приглашение' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Недостаточно прав.')
  })
})

describe('пользователи', () => {
  it('выдаёт ссылку для сброса пароля выбранному пользователю', async () => {
    const calls = mockApi({
      [USERS]: json(200, users),
      [INVITES]: json(200, []),
      [`POST /api/admin/users/${anna.id}/password-reset`]: json(200, {
        token: 'reset-token',
        expires_at: '2026-10-06T10:00:00Z',
      }),
    })
    await renderApp('/admin', boris)

    const row = (await screen.findByText('anna@example.com · Пользователь')).closest('li')!
    expect(screen.getByText('boris@example.com · Администратор')).toBeInTheDocument()
    await userEvent.click(within(row).getByRole('button', { name: 'Ссылка для сброса пароля' }))

    expect(await screen.findByLabelText('Ссылка для сброса пароля: Анна')).toHaveValue(
      `${window.location.origin}/reset#reset-token`,
    )
    expect(calls.at(-1)?.authorization).toBe('Bearer access-1')
  })
})
