import { Link } from '@tanstack/react-router'
import { ChevronRight, FlaskConical, ScanLine } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export function HealthCard() {
  const { t } = useTranslation()
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('files.health')}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2">
        <Link to="/labs" className="flex min-h-11 items-center gap-3 rounded-lg border p-3">
          <FlaskConical className="size-5" aria-hidden="true" />
          <span className="flex-1 font-medium">{t('nav.labs')}</span>
          <ChevronRight className="size-5 text-muted-foreground" aria-hidden="true" />
        </Link>
        <Link to="/studies" className="flex min-h-11 items-center gap-3 rounded-lg border p-3">
          <ScanLine className="size-5" aria-hidden="true" />
          <span className="flex-1 font-medium">{t('studies.title')}</span>
          <ChevronRight className="size-5 text-muted-foreground" aria-hidden="true" />
        </Link>
      </CardContent>
    </Card>
  )
}
