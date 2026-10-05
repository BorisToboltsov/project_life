import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { session } from '@/auth/session'
import { callsTo, json, mockApi } from '@/test/api'
import { renderApp } from '@/test/app'
import { anna, sessionOf } from '@/test/fixtures'

const HEALTH = { 'GET /api/health': json(200, { status: 'ok', version: '0.1.0' }) }
const save = () => userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

describe('профиль', () => {
  it('сохраняет только изменённые поля', async () => {
    const updated = { ...anna, display_name: 'Аня', height_cm: 168.5 }
    const calls = mockApi({ ...HEALTH, 'PATCH /api/me': json(200, updated) })
    await renderApp('/profile', anna)

    const name = await screen.findByLabelText('Как к вам обращаться')
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled()
    await userEvent.clear(name)
    await userEvent.type(name, 'Аня')
    await userEvent.type(screen.getByLabelText('Рост, см'), '168.5')
    await save()

    expect(await screen.findByText('Сохранено')).toBeInTheDocument()
    expect(callsTo(calls, 'PATCH /api/me')[0].body).toEqual({
      display_name: 'Аня',
      height_cm: 168.5,
    })
    expect(session.getState().user?.display_name).toBe('Аня')
  })

  it('дата рождения — одно поле с календарём, показывает день/месяц/год', async () => {
    const calls = mockApi({
      ...HEALTH,
      'PATCH /api/me': json(200, { ...anna, birth_date: '1990-05-17' }),
    })
    await renderApp('/profile', anna)

    const field = await screen.findByLabelText('Дата рождения')
    await userEvent.type(field, '17051990')
    await save()

    expect(await screen.findByText('Сохранено')).toBeInTheDocument()
    expect(callsTo(calls, 'PATCH /api/me')[0].body).toEqual({ birth_date: '1990-05-17' })
    expect(field).toHaveValue('17/05/1990')
  })

  it('дату рождения можно выбрать в календаре', async () => {
    const calls = mockApi({
      ...HEALTH,
      'PATCH /api/me': json(200, { ...anna, birth_date: '1990-05-23' }),
    })
    await renderApp('/profile', { ...anna, birth_date: '1990-05-17' })

    await userEvent.click(await screen.findByRole('button', { name: 'Открыть календарь' }))
    await userEvent.click(await screen.findByRole('button', { name: /23 мая 1990/ }))
    await save()

    expect(await screen.findByText('Сохранено')).toBeInTheDocument()
    expect(callsTo(calls, 'PATCH /api/me')[0].body).toEqual({ birth_date: '1990-05-23' })
  })

  it.each([
    ['несуществующую', '31021990'],
    ['недописанную', '1705'],
  ])('%s дату рождения не отправляет', async (_name, typed) => {
    const calls = mockApi(HEALTH)
    await renderApp('/profile', anna)

    await userEvent.type(await screen.findByLabelText('Дата рождения'), typed)
    await save()

    expect(await screen.findByText('Проверьте дату рождения')).toBeInTheDocument()
    expect(callsTo(calls, 'PATCH /api/me')).toEqual([])
  })

  it('после смены единиц рост вводится в футах и дюймах', async () => {
    const imperial = { ...anna, unit_system: 'imperial' as const, height_cm: 168.5 }
    const calls = mockApi({ ...HEALTH, 'PATCH /api/me': json(200, imperial) })
    await renderApp('/profile', { ...anna, height_cm: 168.5 })

    await userEvent.selectOptions(await screen.findByLabelText('Единицы'), 'imperial')
    await save()

    expect(await screen.findByLabelText('Рост, футы')).toHaveValue('5')
    expect(screen.getByLabelText('Рост, дюймы')).toHaveValue('6')
    expect(callsTo(calls, 'PATCH /api/me')[0].body).toEqual({ unit_system: 'imperial' })
  })

  it('смена языка в профиле переключает интерфейс', async () => {
    mockApi({ ...HEALTH, 'PATCH /api/me': json(200, { ...anna, language: 'en' }) })
    await renderApp('/profile', anna)

    await userEvent.selectOptions(await screen.findByLabelText('Язык'), 'en')
    await save()

    expect(await screen.findByRole('heading', { name: 'Profile' })).toBeInTheDocument()
  })

  it('не отправляет рост вне допустимого диапазона', async () => {
    const calls = mockApi(HEALTH)
    await renderApp('/profile', anna)

    await userEvent.type(await screen.findByLabelText('Рост, см'), '400')
    await save()

    expect(await screen.findByText('Рост — от 30 до 275 см')).toBeInTheDocument()
    expect(callsTo(calls, 'PATCH /api/me')).toEqual([])
  })

  it('показывает отказ сервера при сохранении', async () => {
    mockApi({ ...HEALTH, 'PATCH /api/me': json(500, { detail: 'boom' }) })
    await renderApp('/profile', anna)

    await userEvent.type(await screen.findByLabelText('Рост, см'), '170')
    await save()

    expect(await screen.findByRole('alert')).toHaveTextContent('Что-то пошло не так.')
  })
})

describe('смена пароля', () => {
  async function change(current: string, next: string) {
    await userEvent.type(await screen.findByLabelText('Текущий пароль'), current)
    await userEvent.type(screen.getByLabelText('Новый пароль'), next)
    await userEvent.click(screen.getByRole('button', { name: 'Сменить пароль' }))
  }

  it('меняет пароль и применяет новую сессию', async () => {
    const calls = mockApi({
      ...HEALTH,
      'POST /api/auth/password': json(200, sessionOf(anna, 'access-2')),
      'GET /api/me': json(200, anna),
    })
    await renderApp('/profile', anna)

    await change('correct horse battery', 'a brand new passphrase')

    expect(
      await screen.findByText('Пароль изменён. На других устройствах выполнен выход.'),
    ).toBeInTheDocument()
    expect(callsTo(calls, 'POST /api/auth/password')[0].body).toEqual({
      current_password: 'correct horse battery',
      new_password: 'a brand new passphrase',
    })
    expect(screen.getByLabelText('Текущий пароль')).toHaveValue('')
  })

  it('сообщает о неверном текущем пароле', async () => {
    mockApi({ ...HEALTH, 'POST /api/auth/password': json(400, { detail: 'wrong_password' }) })
    await renderApp('/profile', anna)

    await change('not my password', 'a brand new passphrase')

    expect(await screen.findByRole('alert')).toHaveTextContent('Текущий пароль указан неверно.')
  })
})

describe('сеанс', () => {
  it.each([
    ['Выйти', 'POST /api/auth/logout'],
    ['Выйти на всех устройствах', 'POST /api/auth/logout-all'],
  ])('«%s» закрывает сессию и возвращает на вход', async (button, route) => {
    const calls = mockApi({ ...HEALTH, [route]: json(204) })
    await renderApp('/profile', anna)

    await userEvent.click(await screen.findByRole('button', { name: button }))

    expect(await screen.findByRole('heading', { name: 'Вход' })).toBeInTheDocument()
    expect(callsTo(calls, route)).toHaveLength(1)
  })
})
