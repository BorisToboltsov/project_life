import { useTranslation } from 'react-i18next'

import { useDiaryDay } from '@/api/nutrition'
import { useUser } from '@/auth/useSession'
import { today } from '@/lib/dates'

import { DiaryCard } from './diary/DiaryCard'
import { WaterCard } from './diary/WaterCard'
import { SummaryCard } from './measurements/SummaryCard'
import { WorkoutHomeCard } from './workouts/WorkoutHomeCard'

export function HomePage() {
  const { t } = useTranslation()
  const user = useUser()
  const date = today()
  // Тот же запрос, что у карточки питания: день приходит один раз.
  const day = useDiaryDay(date)

  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold">{t('home.greeting', { name: user.display_name })}</h1>
      <DiaryCard />
      <WorkoutHomeCard />
      <WaterCard date={date} day={day.data} title={t('water.todayTitle')} goalLink />
      <SummaryCard />
    </div>
  )
}
