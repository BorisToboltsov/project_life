import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import { api } from '@/api/client'
import { FormError, TextField } from '@/components/form/fields'
import { message } from '@/components/form/validation'
import { Button } from '@/components/ui/button'
import { attempt, type ErrorKey } from '@/lib/errors'

import { LinkProblem } from './LinkProblem'
import { tokenFromHash } from './token'

const schema = z.object({
  new_password: z
    .string()
    .min(10, message('validation.passwordLength'))
    .max(128, message('validation.passwordLength')),
})

type Values = z.infer<typeof schema>

export function ResetPage() {
  const { t } = useTranslation()
  const [token] = useState(tokenFromHash)
  const [failure, setFailure] = useState<ErrorKey>()
  const [done, setDone] = useState(false)
  const form = useForm<Values>({ resolver: zodResolver(schema) })
  const { errors, isSubmitting } = form.formState

  const reset = useQuery({
    queryKey: ['password-reset', token],
    enabled: token !== '',
    retry: false,
    queryFn: async () => {
      const { data } = await api.POST('/api/auth/password-reset/check', { body: { token } })
      return data ?? null
    },
  })

  async function submit(values: Values) {
    setFailure(undefined)
    const result = await attempt(() =>
      api.POST('/api/auth/password-reset', { body: { ...values, token } }),
    )
    if (result.failure) setFailure(result.failure)
    else setDone(true)
  }

  if (done) {
    return (
      <div className="grid gap-4 text-center">
        <p role="status">{t('reset.done')}</p>
        <Button asChild className="h-11">
          <Link to="/login">{t('invite.toLogin')}</Link>
        </Button>
      </div>
    )
  }
  if (reset.isPending && token !== '') {
    return <p className="text-center text-sm text-muted-foreground">{t('common.loading')}</p>
  }
  if (reset.isError) return <FormError failure="errors.network" />
  if (!reset.data) {
    return <LinkProblem title={t('reset.invalidTitle')} text={t('reset.invalidText')} />
  }

  return (
    <form
      onSubmit={(event) => void form.handleSubmit(submit)(event)}
      noValidate
      className="grid gap-4"
    >
      <h1 className="text-center text-lg font-medium">{t('reset.title')}</h1>
      <p className="text-center text-sm text-muted-foreground">
        {t('reset.forUser', { name: reset.data.display_name })}
      </p>
      <FormError failure={failure} />
      <TextField
        label={t('reset.password')}
        type="password"
        autoComplete="new-password"
        hint={t('invite.passwordHint')}
        error={errors.new_password?.message}
        {...form.register('new_password')}
      />
      <Button type="submit" className="h-11" disabled={isSubmitting}>
        {t('reset.submit')}
      </Button>
    </form>
  )
}
