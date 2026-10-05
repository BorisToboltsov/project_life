import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import { api } from '@/api/client'
import { session } from '@/auth/session'
import { FormError, TextField } from '@/components/form/fields'
import { message, type ValidationKey } from '@/components/form/validation'
import { Button } from '@/components/ui/button'
import type { Language } from '@/i18n'
import { attempt, type ErrorKey } from '@/lib/errors'

import { LinkProblem } from './LinkProblem'
import { tokenFromHash } from './token'

const schema = z.object({
  display_name: z
    .string()
    .trim()
    .min(1, message('validation.required'))
    .max(80, message('validation.nameLength')),
  email: z.email(message('validation.email')),
  password: z
    .string()
    .min(10, message('validation.passwordLength'))
    .max(128, message('validation.passwordLength')),
  accept_disclaimer: z.boolean().refine((accepted) => accepted, message('validation.disclaimer')),
})

type Values = z.infer<typeof schema>

export function InvitePage() {
  const { t, i18n } = useTranslation()
  const [token] = useState(tokenFromHash)
  const [failure, setFailure] = useState<ErrorKey>()
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { accept_disclaimer: false },
  })
  const { errors, isSubmitting } = form.formState

  const invite = useQuery({
    queryKey: ['invite', token],
    enabled: token !== '',
    retry: false,
    queryFn: async () => {
      const { data } = await api.POST('/api/auth/invite/check', { body: { token } })
      return data ?? null
    },
  })

  async function submit(values: Values) {
    setFailure(undefined)
    const result = await attempt(() =>
      api.POST('/api/auth/register', {
        body: {
          ...values,
          accept_disclaimer: true,
          token,
          language: i18n.language as Language,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      }),
    )
    if (result.failure) setFailure(result.failure)
    else session.open(result.data)
  }

  if (invite.isPending && token !== '') {
    return <p className="text-center text-sm text-muted-foreground">{t('common.loading')}</p>
  }
  if (invite.isError) return <FormError failure="errors.network" />
  if (!invite.data) {
    return <LinkProblem title={t('invite.invalidTitle')} text={t('invite.invalidText')} />
  }

  return (
    <form
      onSubmit={(event) => void form.handleSubmit(submit)(event)}
      noValidate
      className="grid gap-4"
    >
      <h1 className="text-center text-lg font-medium">{t('invite.title')}</h1>
      {invite.data.role === 'admin' && (
        <p className="text-center text-sm text-muted-foreground">{t('invite.admin')}</p>
      )}
      <FormError failure={failure} />
      <TextField
        label={t('invite.name')}
        autoComplete="name"
        error={errors.display_name?.message}
        {...form.register('display_name')}
      />
      <TextField
        label={t('invite.email')}
        type="email"
        autoComplete="username"
        inputMode="email"
        error={errors.email?.message}
        {...form.register('email')}
      />
      <TextField
        label={t('invite.password')}
        type="password"
        autoComplete="new-password"
        hint={t('invite.passwordHint')}
        error={errors.password?.message}
        {...form.register('password')}
      />
      <div className="grid gap-1.5">
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 size-5 shrink-0 accent-primary"
            aria-invalid={errors.accept_disclaimer ? true : undefined}
            {...form.register('accept_disclaimer')}
          />
          {t('disclaimer.accept')}
        </label>
        {errors.accept_disclaimer?.message && (
          <p className="text-sm text-destructive">
            {t(errors.accept_disclaimer.message as ValidationKey)}
          </p>
        )}
      </div>
      <Button type="submit" className="h-11" disabled={isSubmitting}>
        {t('invite.submit')}
      </Button>
    </form>
  )
}
