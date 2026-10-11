import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'

/**
 * Экран сбоя: встаёт на место экрана, упавшего при отрисовке. Что именно сломалось,
 * пользователю не показывается — об этом администратор узнаёт из отчёта (errorReporting.ts).
 *
 * «Обновить» перезагружает страницу, а не сбрасывает границу ошибок: перезагрузка заодно
 * забирает свежую сборку и данные, а причина сбоя нередко в устаревших.
 */
export function CrashScreen() {
  const { t } = useTranslation()

  return (
    <div
      role="alert"
      className="mx-auto flex min-h-[50svh] max-w-sm flex-col items-center justify-center gap-4 p-6 text-center"
    >
      <h1 className="text-lg font-medium">{t('crash.title')}</h1>
      <p className="text-sm text-muted-foreground">{t('crash.hint')}</p>
      <Button className="h-11" onClick={() => window.location.reload()}>
        {t('crash.reload')}
      </Button>
    </div>
  )
}
