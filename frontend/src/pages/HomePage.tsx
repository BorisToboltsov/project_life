import { useTranslation } from 'react-i18next'

import { useUser } from '@/auth/useSession'

import { DiaryCard } from './diary/DiaryCard'
import { SummaryCard } from './measurements/SummaryCard'

export function HomePage() {
  const { t } = useTranslation()
  const user = useUser()

  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold">{t('home.greeting', { name: user.display_name })}</h1>
      <DiaryCard />
      <SummaryCard />
    </div>
  )
}
