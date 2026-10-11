import { useTranslation } from 'react-i18next'

/** На месте экрана, пока он подгружается: показывается, если это заняло заметное время. */
export function ScreenLoading() {
  const { t } = useTranslation()
  return (
    <p role="status" className="text-muted-foreground">
      {t('common.loading')}
    </p>
  )
}
