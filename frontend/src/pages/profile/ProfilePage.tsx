import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { api } from '@/api/client'
import { session } from '@/auth/session'
import { useUser } from '@/auth/useSession'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

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
        <CardContent className="flex flex-wrap gap-3">
          <Button variant="outline" className="h-11" onClick={() => void session.logout()}>
            {t('profile.logout')}
          </Button>
          <Button variant="ghost" className="h-11" onClick={() => void session.logoutEverywhere()}>
            {t('profile.logoutEverywhere')}
          </Button>
        </CardContent>
      </Card>
      <footer className="grid gap-1 text-sm text-muted-foreground">
        <p>{t('disclaimer.text')}</p>
        {health.data && <p>{t('profile.version', { version: health.data.version })}</p>}
      </footer>
    </div>
  )
}
