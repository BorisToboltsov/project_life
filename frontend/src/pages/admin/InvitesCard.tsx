import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import { api } from '@/api/client'
import { useUser } from '@/auth/useSession'
import { CopyLink } from '@/components/CopyLink'
import { FormError, SelectField, TextField } from '@/components/form/fields'
import { message } from '@/components/form/validation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { attempt, type ErrorKey } from '@/lib/errors'
import { formatDateTime } from '@/lib/dates'

const schema = z.object({
  note: z.string().trim().max(120, message('validation.noteLength')),
  role: z.enum(['user', 'admin']),
})

type Values = z.infer<typeof schema>

const INVITES = ['admin', 'invites']

export function InvitesCard() {
  const { t, i18n } = useTranslation()
  const user = useUser()
  const queryClient = useQueryClient()
  const [failure, setFailure] = useState<ErrorKey>()
  const [link, setLink] = useState<string>()
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { note: '', role: 'user' },
  })
  const { errors, isSubmitting } = form.formState

  const invites = useQuery({
    queryKey: INVITES,
    queryFn: async () => (await api.GET('/api/admin/invites')).data ?? [],
  })

  const revoke = useMutation({
    mutationFn: (invite_id: string) =>
      api.DELETE('/api/admin/invites/{invite_id}', { params: { path: { invite_id } } }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: INVITES }),
  })

  async function create(values: Values) {
    setFailure(undefined)
    setLink(undefined)
    const result = await attempt(() =>
      api.POST('/api/admin/invites', { body: { role: values.role, note: values.note || null } }),
    )
    if (result.failure) {
      setFailure(result.failure)
      return
    }
    setLink(`${window.location.origin}/invite#${result.data.token}`)
    form.reset()
    await queryClient.invalidateQueries({ queryKey: INVITES })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('admin.invitesTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <form
          onSubmit={(event) => void form.handleSubmit(create)(event)}
          noValidate
          className="grid gap-4"
        >
          <FormError failure={failure} />
          <TextField
            label={t('admin.inviteNote')}
            error={errors.note?.message}
            {...form.register('note')}
          />
          <SelectField label={t('admin.inviteRole')} {...form.register('role')}>
            <option value="user">{t('roles.user')}</option>
            <option value="admin">{t('roles.admin')}</option>
          </SelectField>
          <Button type="submit" className="h-11 justify-self-start" disabled={isSubmitting}>
            {t('admin.inviteCreate')}
          </Button>
        </form>

        {link && (
          <CopyLink title={t('admin.inviteLink')} hint={t('admin.inviteLinkHint')} url={link} />
        )}

        {invites.data?.length === 0 && (
          <p className="text-sm text-muted-foreground">{t('admin.invitesEmpty')}</p>
        )}
        <ul className="grid gap-2">
          {invites.data?.map((invite) => (
            <li
              key={invite.id}
              className="flex items-center justify-between gap-3 rounded-lg border p-3"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{invite.note ?? t('admin.inviteUnnamed')}</p>
                <p className="text-sm text-muted-foreground">
                  {t(`roles.${invite.role}`)}
                  {' · '}
                  {t('admin.inviteExpires', {
                    date: formatDateTime(invite.expires_at, i18n.language, user.timezone),
                  })}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={revoke.isPending}
                onClick={() => revoke.mutate(invite.id)}
              >
                {t('admin.inviteRevoke')}
              </Button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
