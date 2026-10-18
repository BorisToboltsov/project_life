import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { api } from '@/api/client'
import { session } from '@/auth/session'
import { useUser } from '@/auth/useSession'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useOfflineState } from '@/offline/store'

import { PasswordForm } from './PasswordForm'
import { ProfileForm } from './ProfileForm'

export function ProfilePage() {
  const { t } = useTranslation()
  const user = useUser()
  const health = useQuery({
    queryKey: ['health'],
    queryFn: async () => (await api.GET('/api/health')).data ?? null,
  })

  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold">{t('profile.title')}</h1>
      <ProfileForm user={user} />
      <PasswordForm />
      <Card>
        <CardHeader>
          <CardTitle>{t('profile.sessionTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          <SessionActions />
        </CardContent>
      </Card>
      <footer className="grid gap-1 text-sm text-muted-foreground">
        <p>{t('disclaimer.text')}</p>
        {health.data && <p>{t('profile.version', { version: health.data.version })}</p>}
      </footer>
    </div>
  )
}

/**
 * Выход. Если на телефоне есть неотправленное, сначала вопрос в той же строке: выход стирает
 * копию и очередь (ADR 0020).
 */
function SessionActions() {
  const { t } = useTranslation()
  const { queued, rejected, deferred } = useOfflineState()
  const unsent = queued + rejected.length + deferred.length
  const [asking, setAsking] = useState<'logout' | 'everywhere' | null>(null)
  const leave = (how: 'logout' | 'everywhere') =>
    void (how === 'logout' ? session.logout() : session.logoutEverywhere())

  if (asking)
    return (
      <div className="grid gap-3">
        <p role="alert">{t('profile.logoutUnsent', { count: unsent })}</p>
        <div className="flex flex-wrap gap-3">
          <Button variant="destructive" className="h-11" onClick={() => leave(asking)}>
            {t('profile.logoutConfirm')}
          </Button>
          <Button variant="ghost" className="h-11" onClick={() => setAsking(null)}>
            {t('profile.logoutCancel')}
          </Button>
        </div>
      </div>
    )

  const ask = (how: 'logout' | 'everywhere') => (unsent > 0 ? setAsking(how) : leave(how))
  return (
    <div className="flex flex-wrap gap-3">
      <Button variant="outline" className="h-11" onClick={() => ask('logout')}>
        {t('profile.logout')}
      </Button>
      <Button variant="ghost" className="h-11" onClick={() => ask('everywhere')}>
        {t('profile.logoutEverywhere')}
      </Button>
    </div>
  )
}
