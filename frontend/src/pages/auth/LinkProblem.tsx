import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'

/** Одноразовая ссылка не действует: объясняем и отправляем ко входу. */
export function LinkProblem({ title, text }: { title: string; text: string }) {
  const { t } = useTranslation()

  return (
    <div className="grid gap-4 text-center">
      <h1 className="text-lg font-medium">{title}</h1>
      <p className="text-sm text-muted-foreground">{text}</p>
      <Button asChild variant="outline" className="h-11">
        <Link to="/login">{t('invite.toLogin')}</Link>
      </Button>
    </div>
  )
}
