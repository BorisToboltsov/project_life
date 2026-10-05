import type { Schemas } from '@/api/client'
import type { User } from '@/auth/session'

export const anna: User = {
  id: '0199b7a0-0000-7000-8000-000000000001',
  email: 'anna@example.com',
  display_name: 'Анна',
  role: 'user',
  language: 'ru',
  timezone: 'Europe/Moscow',
  unit_system: 'metric',
  sex: null,
  birth_date: null,
  height_cm: null,
}

export const boris: User = { ...anna, id: '0199b7a0-0000-7000-8000-000000000002', role: 'admin' }

export function sessionOf(user: User, token = 'access-1'): Schemas['SessionOut'] {
  return { access_token: token, expires_in: 900, user }
}
