import { RouterProvider } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { session } from '@/auth/session'
import { useSession } from '@/auth/useSession'
import { Button } from '@/components/ui/button'

import type { AppRouter } from './router'

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-svh max-w-sm flex-col items-center justify-center gap-4 p-6 text-center">
      {children}
    </div>
  )
}

export function App({ router }: { router: AppRouter }) {
  const { t } = useTranslation()
  const state = useSession()

  if (state.status === 'loading') {
    return (
      <Centered>
        <p role="status" className="text-muted-foreground">
          {t('common.loading')}
        </p>
      </Centered>
    )
  }

  if (state.status === 'offline') {
    return (
      <Centered>
        <h1 className="text-lg font-medium">{t('offline.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('offline.hint')}</p>
        <Button className="h-11" onClick={() => void session.bootstrap()}>
          {t('common.retry')}
        </Button>
      </Centered>
    )
  }

  return <RouterProvider router={router} />
}
