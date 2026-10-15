import { Link, type LinkProps, Outlet, useRouterState } from '@tanstack/react-router'
import {
  Dumbbell,
  Ellipsis,
  House,
  type LucideIcon,
  Ruler,
  ShieldCheck,
  UserRound,
  Utensils,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { UserContext, useSession, useUser } from '@/auth/useSession'
import type { Dictionary } from '@/i18n/ru'
import { cn } from '@/lib/utils'

import { APP_NAME } from './brand'

interface NavItem {
  to: LinkProps['to']
  icon: LucideIcon
  label: `nav.${keyof Dictionary['nav']}`
  /** Где пункт виден: в нижней панели телефона, в колонке компьютера или везде. */
  on?: 'phone' | 'desktop'
}

/** Разделы, которые на телефоне живут под «Ещё». */
const UNDER_MORE = ['/more', '/profile', '/admin']

/**
 * Рамка приложения после входа. На телефоне разделы — в панели внизу экрана,
 * на компьютере — в колонке слева. В нижней панели пять мест: профиль и управление
 * собраны под «Ещё», в колонке они стоят сами.
 */
export function AppShell() {
  const { user } = useSession()
  // Сессия закрывается раньше перехода роутера. Всё защищённое дерево получает
  // пользователя через контекст и размонтируется целиком, не читая пустую сессию.
  if (!user) return null
  return (
    <UserContext value={user}>
      <AuthenticatedShell />
    </UserContext>
  )
}

function AuthenticatedShell() {
  const { t } = useTranslation()
  const user = useUser()
  const path = useRouterState({ select: (state) => state.location.pathname })

  const items: NavItem[] = [
    { to: '/', icon: House, label: 'nav.home' },
    { to: '/diary', icon: Utensils, label: 'nav.diary' },
    { to: '/workouts', icon: Dumbbell, label: 'nav.workouts' },
    { to: '/measurements', icon: Ruler, label: 'nav.measurements' },
    { to: '/more', icon: Ellipsis, label: 'nav.more', on: 'phone' },
    { to: '/profile', icon: UserRound, label: 'nav.profile', on: 'desktop' },
    ...(user.role === 'admin'
      ? [{ to: '/admin', icon: ShieldCheck, label: 'nav.admin', on: 'desktop' } satisfies NavItem]
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
          {items.map(({ to, icon: Icon, label, on }) => {
            // «Ещё» остаётся отмеченным и на экранах, которые под ним собраны.
            const underMore = to === '/more' && UNDER_MORE.some((prefix) => path.startsWith(prefix))
            return (
              <li
                key={to}
                className={cn(
                  'flex-1 md:flex-none',
                  on === 'phone' && 'md:hidden',
                  on === 'desktop' && 'hidden md:block',
                )}
              >
                <Link
                  to={to}
                  // Главная активна только на своём адресе, разделы — и на вложенных экранах.
                  activeOptions={{ exact: to === '/' }}
                  className={cn(
                    'flex min-h-14 flex-col items-center justify-center gap-1 text-xs md:min-h-10 md:flex-row md:justify-start md:gap-3 md:rounded-lg md:px-3 md:text-sm',
                    underMore && 'font-medium text-primary',
                  )}
                  aria-current={underMore ? 'page' : undefined}
                  activeProps={{ className: 'font-medium text-primary md:bg-muted' }}
                  inactiveProps={{ className: underMore ? '' : 'text-muted-foreground' }}
                >
                  <Icon className="size-5" aria-hidden="true" />
                  {t(label)}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>
      <main className="mx-auto w-full max-w-2xl p-4 pb-24 md:p-8">
        <Outlet />
      </main>
    </div>
  )
}
