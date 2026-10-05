import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import { api } from '@/api/client'
import { session } from '@/auth/session'
import { FormError, TextField } from '@/components/form/fields'
import { message } from '@/components/form/validation'
import { Button } from '@/components/ui/button'
import { attempt, type ErrorKey } from '@/lib/errors'

const schema = z.object({
  email: z.email(message('validation.email')),
  password: z.string().min(1, message('validation.required')),
})

type Values = z.infer<typeof schema>

export function LoginPage() {
  const { t } = useTranslation()
  const [failure, setFailure] = useState<ErrorKey>()
  const form = useForm<Values>({ resolver: zodResolver(schema) })
  const { errors, isSubmitting } = form.formState

  async function submit(values: Values) {
    setFailure(undefined)
    const result = await attempt(() => api.POST('/api/auth/login', { body: values }))
    if (result.failure) setFailure(result.failure)
    // Маршрут сам уведёт вошедшего пользователя с экрана входа.
    else session.open(result.data)
  }

  return (
    <form
      onSubmit={(event) => void form.handleSubmit(submit)(event)}
      noValidate
      className="grid gap-4"
    >
      <h1 className="text-center text-lg font-medium">{t('login.title')}</h1>
      <FormError failure={failure} />
      <TextField
        label={t('login.email')}
        type="email"
        autoComplete="username"
        inputMode="email"
        error={errors.email?.message}
        {...form.register('email')}
      />
      <TextField
        label={t('login.password')}
        type="password"
        autoComplete="current-password"
        error={errors.password?.message}
        {...form.register('password')}
      />
      <Button type="submit" className="h-11" disabled={isSubmitting}>
        {t('login.submit')}
      </Button>
      <p className="text-center text-sm text-muted-foreground">{t('login.hint')}</p>
    </form>
  )
}
