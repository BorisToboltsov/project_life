import { useTranslation } from 'react-i18next'

import { useUser } from '@/auth/useSession'

import { SummaryCard } from './measurements/SummaryCard'

export function HomePage() {
  const { t } = useTranslation()
  const user = useUser()

  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold">{t('home.greeting', { name: user.display_name })}</h1>
      <SummaryCard />
      <p className="text-sm text-muted-foreground">{t('home.empty')}</p>
    </div>
  )
}
