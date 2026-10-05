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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { attempt, type ErrorKey } from '@/lib/errors'

const schema = z.object({
  current_password: z.string().min(1, message('validation.required')),
  new_password: z
    .string()
    .min(10, message('validation.passwordLength'))
    .max(128, message('validation.passwordLength')),
})

type Values = z.infer<typeof schema>

export function PasswordForm() {
  const { t } = useTranslation()
  const [failure, setFailure] = useState<ErrorKey>()
  const [done, setDone] = useState(false)
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { current_password: '', new_password: '' },
  })
  const { errors, isSubmitting } = form.formState

  async function submit(values: Values) {
    setFailure(undefined)
    setDone(false)
    const result = await attempt(() => api.POST('/api/auth/password', { body: values }))
    if (result.failure) {
      setFailure(result.failure)
      return
    }
    // Сервер закрыл все прежние сессии и выдал этому устройству новую.
    session.open(result.data)
    form.reset()
    setDone(true)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('profile.passwordTitle')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(event) => void form.handleSubmit(submit)(event)}
          noValidate
          className="grid gap-4"
        >
          <FormError failure={failure} />
          <TextField
            label={t('profile.passwordCurrent')}
            type="password"
            autoComplete="current-password"
            error={errors.current_password?.message}
            {...form.register('current_password')}
          />
          <TextField
            label={t('profile.passwordNew')}
            type="password"
            autoComplete="new-password"
            hint={t('invite.passwordHint')}
            error={errors.new_password?.message}
            {...form.register('new_password')}
          />
          <div className="flex items-center gap-3">
            <Button type="submit" variant="outline" className="h-11" disabled={isSubmitting}>
              {t('profile.passwordSubmit')}
            </Button>
            {done && (
              <p role="status" className="text-sm text-muted-foreground">
                {t('profile.passwordDone')}
              </p>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
