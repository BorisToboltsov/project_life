import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { api } from '@/api/client'
import { useUser } from '@/auth/useSession'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatDateTime } from '@/lib/dates'

const ERRORS = ['admin', 'errors']

export function ErrorsCard() {
  const { t, i18n } = useTranslation()
  const user = useUser()
  const queryClient = useQueryClient()

  const reports = useQuery({
    queryKey: ERRORS,
    queryFn: async () => (await api.GET('/api/admin/errors')).data ?? [],
  })

  const remove = useMutation({
    mutationFn: (report_id: string) =>
      api.DELETE('/api/admin/errors/{report_id}', { params: { path: { report_id } } }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ERRORS }),
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('admin.errorsTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <p className="text-sm text-muted-foreground">{t('admin.errorsHint')}</p>
        {reports.data?.length === 0 && (
          <p className="text-sm text-muted-foreground">{t('admin.errorsEmpty')}</p>
        )}
        <ul className="grid gap-2">
          {reports.data?.map((report) => (
            <li key={report.id} className="grid gap-2 rounded-lg border p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium break-words">{report.kind}</p>
                  <p className="text-sm break-words text-muted-foreground">
                    {t(`errorSources.${report.source}`)}
                    {report.place && (
                      <>
                        {' · '}
                        {report.place}
                      </>
                    )}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {t('admin.errorSeen', {
                      date: formatDateTime(report.last_seen, i18n.language, user.timezone),
                      times: report.count,
                      version: report.version,
                    })}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(report.id)}
                >
                  {t('admin.errorDelete')}
                </Button>
              </div>
              {report.stack && (
                <details>
                  <summary className="cursor-pointer text-sm">{t('admin.errorStack')}</summary>
                  <pre className="mt-2 overflow-x-auto rounded-md bg-muted p-2 text-xs">
                    {report.stack}
                  </pre>
                </details>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
