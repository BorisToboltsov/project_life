import { z } from 'zod'

import type { Schemas } from '@/api/client'
import type { User } from '@/auth/session'
import { message } from '@/components/form/validation'
import { isRealDate, today } from '@/lib/dates'
import { cmToFeetInches, feetInchesToCm } from '@/lib/units'

export type HeightMode = User['unit_system']

export const BIRTH_DATE_MIN = '1900-01-01'

const HEIGHT_MIN_CM = 30
const HEIGHT_MAX_CM = 275

function isNumberIn(text: string, min: number, max: number): boolean {
  const value = Number(text)
  return text.trim() !== '' && Number.isFinite(value) && value >= min && value <= max
}

/**
 * Значения формы — строки, как их отдаёт браузер. Рост вводится в единицах профиля:
 * сантиметры либо футы и дюймы; в API он всегда уходит в сантиметрах.
 */
export const profileSchema = z
  .object({
    display_name: z
      .string()
      .trim()
      .min(1, message('validation.required'))
      .max(80, message('validation.nameLength')),
    sex: z.enum(['', 'male', 'female']),
    birth_date: z
      .string()
      .refine(
        (value) =>
          value === '' || (isRealDate(value) && value >= BIRTH_DATE_MIN && value <= today()),
        message('validation.birthDate'),
      ),
    height_cm: z
      .string()
      .refine(
        (value) => value === '' || isNumberIn(value, HEIGHT_MIN_CM, HEIGHT_MAX_CM),
        message('validation.heightRange'),
      ),
    height_feet: z
      .string()
      .refine((value) => value === '' || isNumberIn(value, 1, 9), message('validation.feetRange')),
    height_inches: z
      .string()
      .refine(
        (value) => value === '' || isNumberIn(value, 0, 11),
        message('validation.inchesRange'),
      ),
    language: z.enum(['ru', 'en']),
    timezone: z.string().min(1),
    unit_system: z.enum(['metric', 'imperial']),
  })
  // Дюймы без футов — недописанный рост.
  .refine((values) => values.height_inches === '' || values.height_feet !== '', {
    path: ['height_feet'],
    message: message('validation.feetRange'),
  })

export type ProfileValues = z.infer<typeof profileSchema>

export function profileDefaults(user: User): ProfileValues {
  const imperial = user.height_cm == null ? null : cmToFeetInches(user.height_cm)
  return {
    display_name: user.display_name,
    sex: user.sex ?? '',
    birth_date: user.birth_date ?? '',
    height_cm: user.height_cm?.toString() ?? '',
    height_feet: imperial?.feet.toString() ?? '',
    height_inches: imperial?.inches.toString() ?? '',
    language: user.language,
    timezone: user.timezone,
    unit_system: user.unit_system,
  }
}

function heightFromForm(values: ProfileValues, mode: HeightMode): number | null {
  if (mode === 'metric') return values.height_cm === '' ? null : Number(values.height_cm)
  if (values.height_feet === '') return null
  return feetInchesToCm({
    feet: Number(values.height_feet),
    inches: Number(values.height_inches || 0),
  })
}

/**
 * Запрос на изменение профиля: только те поля, которые пользователь тронул. Так рост,
 * показанный в футах с округлением до дюйма, не перезаписывает точное значение в сантиметрах.
 */
export function buildProfilePatch(
  values: ProfileValues,
  dirty: Partial<Record<keyof ProfileValues, boolean>>,
  mode: HeightMode,
): Schemas['ProfilePatch'] {
  const patch: Schemas['ProfilePatch'] = {}
  if (dirty.display_name) patch.display_name = values.display_name
  if (dirty.sex) patch.sex = values.sex === '' ? null : values.sex
  if (dirty.birth_date) patch.birth_date = values.birth_date === '' ? null : values.birth_date
  if (dirty.height_cm || dirty.height_feet || dirty.height_inches) {
    patch.height_cm = heightFromForm(values, mode)
  }
  if (dirty.language) patch.language = values.language
  if (dirty.timezone) patch.timezone = values.timezone
  if (dirty.unit_system) patch.unit_system = values.unit_system
  return patch
}
