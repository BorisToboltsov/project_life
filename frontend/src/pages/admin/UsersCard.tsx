import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { api } from '@/api/client'
import { CopyLink } from '@/components/CopyLink'
import { FormError } from '@/components/form/fields'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { attempt, type ErrorKey } from '@/lib/errors'

export function UsersCard() {
  const { t } = useTranslation()
  const [failure, setFailure] = useState<ErrorKey>()
  const [reset, setReset] = useState<{ name: string; url: string }>()

  const users = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: async () => (await api.GET('/api/admin/users')).data ?? [],
  })

  async function createReset(user_id: string, name: string) {
    setFailure(undefined)
    setReset(undefined)
    const result = await attempt(() =>
      api.POST('/api/admin/users/{user_id}/password-reset', { params: { path: { user_id } } }),
    )
    if (result.failure) setFailure(result.failure)
    else setReset({ name, url: `${window.location.origin}/reset#${result.data.token}` })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('admin.usersTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <FormError failure={failure} />
        {reset && (
          <CopyLink
            title={t('admin.resetLink', { name: reset.name })}
            hint={t('admin.resetLinkHint')}
            url={reset.url}
          />
        )}
        <ul className="grid gap-2">
          {users.data?.map((user) => (
            <li
              key={user.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{user.display_name}</p>
                <p className="truncate text-sm text-muted-foreground">
                  {user.email}
                  {' · '}
                  {t(`roles.${user.role}`)}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void createReset(user.id, user.display_name)}
              >
                {t('admin.resetCreate')}
              </Button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
