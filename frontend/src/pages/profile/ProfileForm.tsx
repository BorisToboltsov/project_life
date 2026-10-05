import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { api } from '@/api/client'
import { session, type User } from '@/auth/session'
import { DateField } from '@/components/form/DateField'
import { FormError, SelectField, TextField } from '@/components/form/fields'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { LANGUAGE_NAMES, LANGUAGES } from '@/i18n'
import { today } from '@/lib/dates'
import { attempt, type ErrorKey } from '@/lib/errors'

import {
  BIRTH_DATE_MIN,
  buildProfilePatch,
  profileDefaults,
  profileSchema,
  type ProfileValues,
} from './profileValues'

function timezones(current: string): string[] {
  return [...new Set([current, 'UTC', ...Intl.supportedValuesOf('timeZone')])].sort()
}

export function ProfileForm({ user }: { user: User }) {
  const { t } = useTranslation()
  const [failure, setFailure] = useState<ErrorKey>()
  const [saved, setSaved] = useState(false)
  const zones = useMemo(() => timezones(user.timezone), [user.timezone])
  const form = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: profileDefaults(user),
  })
  const { errors, isSubmitting, isDirty, dirtyFields } = form.formState

  async function submit(values: ProfileValues) {
    setFailure(undefined)
    setSaved(false)
    const body = buildProfilePatch(values, dirtyFields, user.unit_system)
    const result = await attempt(() => api.PATCH('/api/me', { body }))
    if (result.failure) {
      setFailure(result.failure)
      return
    }
    session.updateUser(result.data)
    // Форма перечитывает профиль: рост пересчитывается в единицы, выбранные только что.
    form.reset(profileDefaults(result.data))
    setSaved(true)
  }

  return (
    <form
      onSubmit={(event) => void form.handleSubmit(submit)(event)}
      noValidate
      className="grid gap-4"
    >
      <Card>
        <CardHeader>
          <CardTitle>{t('profile.about')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <TextField
            label={t('profile.name')}
            autoComplete="name"
            error={errors.display_name?.message}
            {...form.register('display_name')}
          />
          <TextField label={t('profile.email')} value={user.email} readOnly disabled />
          <SelectField label={t('profile.sex')} {...form.register('sex')}>
            <option value="">{t('common.notSet')}</option>
            <option value="male">{t('sex.male')}</option>
            <option value="female">{t('sex.female')}</option>
          </SelectField>
          <Controller
            name="birth_date"
            control={form.control}
            render={({ field }) => (
              <DateField
                label={t('profile.birthDate')}
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                min={BIRTH_DATE_MIN}
                max={today()}
                error={errors.birth_date?.message}
              />
            )}
          />
          {user.unit_system === 'metric' ? (
            <TextField
              label={t('profile.heightCm')}
              inputMode="decimal"
              error={errors.height_cm?.message}
              {...form.register('height_cm')}
            />
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <TextField
                label={t('profile.heightFeet')}
                inputMode="numeric"
                error={errors.height_feet?.message}
                {...form.register('height_feet')}
              />
              <TextField
                label={t('profile.heightInches')}
                inputMode="numeric"
                error={errors.height_inches?.message}
                {...form.register('height_inches')}
              />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('profile.settings')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <SelectField label={t('language.label')} {...form.register('language')}>
            {LANGUAGES.map((language) => (
              <option key={language} value={language}>
                {LANGUAGE_NAMES[language]}
              </option>
            ))}
          </SelectField>
          <SelectField label={t('profile.timezone')} {...form.register('timezone')}>
            {zones.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </SelectField>
          <SelectField label={t('profile.units')} {...form.register('unit_system')}>
            <option value="metric">{t('units.metric')}</option>
            <option value="imperial">{t('units.imperial')}</option>
          </SelectField>
        </CardContent>
      </Card>

      <FormError failure={failure} />
      <div className="flex items-center gap-3">
        <Button type="submit" className="h-11" disabled={isSubmitting || !isDirty}>
          {t('common.save')}
        </Button>
        {saved && !isDirty && (
          <p role="status" className="text-sm text-muted-foreground">
            {t('common.saved')}
          </p>
        )}
      </div>
    </form>
  )
}
