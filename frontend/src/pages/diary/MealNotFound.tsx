import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'

/** В адресе приём пищи, которого в этом дне нет: незнакомый ключ или приём убран из списка. */
export function MealNotFound({ date }: { date: string }) {
  const { t } = useTranslation()
  return (
    <div className="grid gap-4">
      <p>{t('meal.notFound')}</p>
      <Button asChild variant="outline" className="h-11 justify-self-start">
        <Link to="/diary/$date" params={{ date }}>
          {t('meal.back')}
        </Link>
      </Button>
    </div>
  )
}
