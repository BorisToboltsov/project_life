import { describe, expect, it } from 'vitest'

import { anna } from '@/test/fixtures'

import { buildProfilePatch, profileDefaults, profileSchema } from './profileValues'

const filled = { ...anna, sex: 'female' as const, birth_date: '1990-05-17', height_cm: 168.5 }

describe('значения формы профиля', () => {
  it('рост показывается и в сантиметрах, и в футах с дюймами', () => {
    expect(profileDefaults(filled)).toMatchObject({
      height_cm: '168.5',
      height_feet: '5',
      height_inches: '6',
      sex: 'female',
      birth_date: '1990-05-17',
    })
  })

  it('незаполненные поля — пустые строки', () => {
    expect(profileDefaults(anna)).toMatchObject({
      sex: '',
      birth_date: '',
      height_cm: '',
      height_feet: '',
      height_inches: '',
    })
  })
})

describe('запрос на изменение профиля', () => {
  it('содержит только тронутые поля', () => {
    const values = { ...profileDefaults(filled), display_name: 'Аня', timezone: 'Asia/Tokyo' }

    expect(buildProfilePatch(values, { display_name: true, timezone: true }, 'metric')).toEqual({
      display_name: 'Аня',
      timezone: 'Asia/Tokyo',
    })
  })

  it('не трогает точный рост, если в имперских единицах его не меняли', () => {
    const values = { ...profileDefaults(filled), language: 'en' as const }

    expect(buildProfilePatch(values, { language: true }, 'imperial')).toEqual({ language: 'en' })
  })

  it('переводит футы и дюймы в сантиметры', () => {
    const values = { ...profileDefaults(anna), height_feet: '6', height_inches: '' }

    expect(buildProfilePatch(values, { height_feet: true }, 'imperial')).toEqual({
      height_cm: 182.9,
    })
  })

  it('очищает необязательные поля значением null', () => {
    const values = { ...profileDefaults(filled), sex: '' as const, birth_date: '', height_cm: '' }
    const dirty = { sex: true, birth_date: true, height_cm: true }

    expect(buildProfilePatch(values, dirty, 'metric')).toEqual({
      sex: null,
      birth_date: null,
      height_cm: null,
    })
  })
})

describe('проверка формы профиля', () => {
  const valid = profileDefaults(filled)
  const messages = (values: object) =>
    profileSchema.safeParse({ ...valid, ...values }).error?.issues.map((issue) => issue.message)

  it('принимает заполненный профиль', () => {
    expect(profileSchema.safeParse(valid).success).toBe(true)
  })

  it.each([
    [{ display_name: '  ' }, 'validation.required'],
    [{ display_name: 'я'.repeat(81) }, 'validation.nameLength'],
    [{ height_cm: '20' }, 'validation.heightRange'],
    [{ height_cm: 'высокий' }, 'validation.heightRange'],
    [{ height_feet: '12' }, 'validation.feetRange'],
    [{ height_inches: '12' }, 'validation.inchesRange'],
    [{ height_feet: '', height_inches: '5' }, 'validation.feetRange'],
    [{ birth_date: '1850-01-01' }, 'validation.birthDate'],
    [{ birth_date: '1990-02-31' }, 'validation.birthDate'],
    [{ birth_date: '17/0' }, 'validation.birthDate'],
    [{ birth_date: '2999-01-01' }, 'validation.birthDate'],
  ])('%o → %s', (values, expected) => {
    expect(messages(values)).toEqual([expected])
  })
})
