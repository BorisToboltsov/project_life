import { Link, type LinkProps } from '@tanstack/react-router'
import { ChevronRight, FlaskConical, type LucideIcon, ShieldCheck, UserRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { useUser } from '@/auth/useSession'
import type { Dictionary } from '@/i18n/ru'

interface Item {
  to: LinkProps['to']
  icon: LucideIcon
  label: `nav.${keyof Dictionary['nav']}`
}

/**
 * Разделы, которым не хватило места в нижней панели телефона: анализы, профиль и, у
 * администратора, управление.
 */
export function MorePage() {
  const { t } = useTranslation()
  const user = useUser()
  const items: Item[] = [
    { to: '/labs', icon: FlaskConical, label: 'nav.labs' },
    { to: '/profile', icon: UserRound, label: 'nav.profile' },
    ...(user.role === 'admin'
      ? [{ to: '/admin', icon: ShieldCheck, label: 'nav.admin' } satisfies Item]
      : []),
  ]
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold">{t('more.title')}</h1>
      <ul className="grid gap-2">
        {items.map(({ to, icon: Icon, label }) => (
          <li key={to}>
            <Link to={to} className="flex min-h-14 items-center gap-3 rounded-lg border p-3">
              <Icon className="size-5" aria-hidden="true" />
              <span className="flex-1 font-medium">{t(label)}</span>
              <ChevronRight className="size-5 text-muted-foreground" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
