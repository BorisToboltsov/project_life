import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { useDiaryDay } from '@/api/nutrition'
import { useUser } from '@/auth/useSession'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { today } from '@/lib/dates'

import { Measure } from './Measure'

/** Сегодняшние калории на главной и самый короткий путь в дневник. */
export function DiaryCard() {
  const { t } = useTranslation()
  const user = useUser()
  const date = today()
  const day = useDiaryDay(date)

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('diary.todayTitle')}</CardTitle>
        <CardAction>
          <Button asChild className="h-11">
            <Link to="/diary/$date" params={{ date }}>
              {t('diary.open')}
            </Link>
          </Button>
        </CardAction>
      </CardHeader>
      {day.data && (
        <CardContent>
          <Measure
            label={t('nutrients.kcal')}
            unit="kcal"
            eaten={day.data.totals.kcal}
            goal={day.data.goal?.kcal ?? undefined}
            prominent
          />
          <Button asChild variant="ghost" className="mt-3 h-11">
            <Link to="/diary/stats" search={{ date: today(user.timezone), period: 'week' }}>
              {t('statistics.open')}
            </Link>
          </Button>
        </CardContent>
      )}
    </Card>
  )
}
