import { Clock } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/** Отметка у записи, которая ещё не дошла до сервера (ADR 0020). */
export function PendingMark() {
  const { t } = useTranslation()
  return (
    <Clock
      role="img"
      aria-label={t('unsent.pending')}
      className="size-4 shrink-0 text-muted-foreground"
    />
  )
}
