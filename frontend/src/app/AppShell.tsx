import { Link, type LinkProps, Outlet } from '@tanstack/react-router'
import { House, type LucideIcon, ShieldCheck, UserRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { useUser } from '@/auth/useSession'
import type { Dictionary } from '@/i18n/ru'

import { APP_NAME } from './brand'

interface NavItem {
  to: LinkProps['to']
  icon: LucideIcon
  label: `nav.${keyof Dictionary['nav']}`
}

/**
 * Рамка приложения после входа. На телефоне разделы — в панели внизу экрана,
 * на компьютере — в колонке слева.
 */
export function AppShell() {
  const { t } = useTranslation()
  const user = useUser()

  const items: NavItem[] = [
    { to: '/', icon: House, label: 'nav.home' },
    { to: '/profile', icon: UserRound, label: 'nav.profile' },
    ...(user.role === 'admin'
      ? [{ to: '/admin', icon: ShieldCheck, label: 'nav.admin' } satisfies NavItem]
      : []),
  ]

  return (
    <div className="min-h-svh md:grid md:grid-cols-[14rem_1fr]">
      <nav
        aria-label={t('nav.label')}
        className="fixed inset-x-0 bottom-0 z-10 border-t bg-background pb-[env(safe-area-inset-bottom)] md:static md:border-t-0 md:border-r md:p-4"
      >
        <p className="hidden px-3 pb-4 text-lg font-semibold md:block">{APP_NAME}</p>
        <ul className="flex md:flex-col md:gap-1">
          {items.map(({ to, icon: Icon, label }) => (
            <li key={to} className="flex-1 md:flex-none">
              <Link
                to={to}
                activeOptions={{ exact: true }}
                className="flex min-h-14 flex-col items-center justify-center gap-1 text-xs md:min-h-10 md:flex-row md:justify-start md:gap-3 md:rounded-lg md:px-3 md:text-sm"
                activeProps={{ className: 'font-medium text-primary md:bg-muted' }}
                inactiveProps={{ className: 'text-muted-foreground' }}
              >
                <Icon className="size-5" aria-hidden="true" />
                {t(label)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <main className="mx-auto w-full max-w-2xl p-4 pb-24 md:p-8">
        <Outlet />
      </main>
    </div>
  )
}
