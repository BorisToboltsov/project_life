import { Outlet } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { LanguageSwitch } from '@/components/LanguageSwitch'

import { APP_NAME } from './brand'

/** Рамка экранов до входа: логотип, содержимое, выбор языка. */
export function AuthLayout() {
  const { t } = useTranslation()

  return (
    <div className="mx-auto flex min-h-svh max-w-sm flex-col justify-center gap-6 p-6">
      <header className="flex flex-col items-center gap-2 text-center">
        <img src="/logo.svg" alt="" className="size-16 rounded-2xl" />
        <p className="text-xl font-semibold">{APP_NAME}</p>
        <p className="text-sm text-muted-foreground">{t('app.tagline')}</p>
      </header>
      <main>
        <Outlet />
      </main>
      <footer>
        <LanguageSwitch />
      </footer>
    </div>
  )
}
