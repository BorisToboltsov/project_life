import { useTranslation } from 'react-i18next'

import { useHealth } from '@/api/health'
import { LanguageSwitch } from '@/components/LanguageSwitch'

const APP_NAME = 'project_life'

export function HomePage() {
  const { t } = useTranslation()
  const health = useHealth()

  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col items-center justify-center gap-6 p-6 text-center">
      <img src="/logo.svg" alt="" className="size-20 rounded-2xl" />
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">{APP_NAME}</h1>
        <p className="text-muted-foreground">{t('app.tagline')}</p>
      </div>
      <p role="status" className="text-sm">
        {health.isPending && t('server.checking')}
        {health.isSuccess && t('server.ok', { version: health.data.version })}
        {health.isError && <span className="text-destructive">{t('server.down')}</span>}
      </p>
      <LanguageSwitch />
    </main>
  )
}
