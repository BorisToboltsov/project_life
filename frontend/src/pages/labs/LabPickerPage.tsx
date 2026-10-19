import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { Check, ChevronRight, Plus } from 'lucide-react'
import { useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { LAB_ANALYTES_KEY, saveLabAnalyte, useLabAnalytes, useLabReports } from '@/api/labs'
import { FormError, TextField } from '@/components/form/fields'
import { Button } from '@/components/ui/button'
import type { ErrorKey } from '@/lib/errors'
import { keyOf, type LabGroup } from '@/lib/labs'
import { uuidv7 } from '@/lib/uuid'

import { ReportMissing } from './LabReportFormPage'
import { ownAnalyteSchema, type OwnAnalyteValues } from './labValues'

interface Choice {
  key: string
  name: string
}

const ROW =
  'flex min-h-11 w-full items-center justify-between gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-muted/50'

/**
 * Выбор показателя для бланка: поиск по названию, справочник по группам, свои показатели
 * отдельной группой и «+ Свой показатель». Показатель, который уже есть в бланке, не
 * выбирается второй раз.
 */
export function LabPickerPage() {
  const { t } = useTranslation()
  const { id } = useParams({ from: '/app/labs/$id/add' })
  const reports = useLabReports()
  const analytes = useLabAnalytes()
  const [query, setQuery] = useState('')

  if (reports.isPending || analytes.isPending)
    return <p className="text-muted-foreground">{t('common.loading')}</p>
  const report = reports.data?.find((item) => item.id === id)
  if (!report) return <ReportMissing />
  const taken = new Set(report.values.map(keyOf))
  const needle = query.trim().toLocaleLowerCase()
  const matches = (name: string) => needle === '' || name.toLocaleLowerCase().includes(needle)
  const groups = new Map<LabGroup | 'own', Choice[]>()
  for (const item of analytes.data?.catalog ?? []) {
    const name = t(`labAnalytes.${item.code}`)
    if (matches(name))
      groups.set(item.group, [...(groups.get(item.group) ?? []), { key: item.code, name }])
  }
  const own = (analytes.data?.analytes ?? [])
    .filter((item) => !item.archived && matches(item.name))
    .map((item) => ({ key: item.id, name: item.name }))
  if (own.length > 0) groups.set('own', own)

  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold">{t('labs.pickTitle')}</h1>
      <TextField
        label={t('labs.search')}
        type="search"
        autoComplete="off"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {groups.size === 0 && <p className="text-muted-foreground">{t('labs.nothingFound')}</p>}
      {[...groups].map(([group, choices]) => (
        <section key={group} className="grid gap-2">
          <h2 className="text-sm font-medium text-muted-foreground">
            {group === 'own' ? t('labs.own') : t(`labGroups.${group}`)}
          </h2>
          <ul className="grid gap-2">
            {choices.map((choice) => (
              <li key={choice.key}>
                {taken.has(choice.key) ? (
                  <span className={`${ROW} text-muted-foreground`} aria-disabled="true">
                    <span>{choice.name}</span>
                    <span className="flex items-center gap-1 text-sm">
                      <Check className="size-4" aria-hidden="true" />
                      {t('labs.alreadyAdded')}
                    </span>
                  </span>
                ) : (
                  <Link
                    to="/labs/$id/add/$key"
                    params={{ id: report.id, key: choice.key }}
                    className={ROW}
                  >
                    <span className="font-medium">{choice.name}</span>
                    <ChevronRight className="size-5 text-muted-foreground" aria-hidden="true" />
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
      <Link
        to="/labs/$id/add/own"
        params={{ id: report.id }}
        className="flex min-h-11 items-center justify-center gap-2 rounded-lg border border-dashed border-muted-foreground/50 p-3 text-sm text-muted-foreground transition-colors hover:bg-muted/50"
      >
        <Plus aria-hidden="true" className="size-5" />
        {t('labs.addOwn')}
      </Link>
      <Button asChild variant="ghost" className="h-11 justify-self-start">
        <Link to="/labs/$id" params={{ id: report.id }}>
          {t('labs.cancel')}
        </Link>
      </Button>
    </div>
  )
}

/** Свой показатель: название и единица; после него сразу открывается форма значения. */
export function LabOwnAnalytePage() {
  const { t } = useTranslation()
  const { id } = useParams({ from: '/app/labs/$id/add/own' })
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [failure, setFailure] = useState<ErrorKey>()
  // Ключ живёт, пока открыта форма: повторная отправка после сбоя не создаст дубль.
  const key = useRef(uuidv7())
  const form = useForm<OwnAnalyteValues>({
    resolver: zodResolver(ownAnalyteSchema),
    defaultValues: { name: '', unit: '' },
  })
  const { errors, isSubmitting } = form.formState

  async function submit(values: OwnAnalyteValues) {
    setFailure(undefined)
    const result = await saveLabAnalyte(key.current, values)
    await queryClient.invalidateQueries({ queryKey: LAB_ANALYTES_KEY })
    if (result.failure) return setFailure(result.failure)
    await navigate({ to: '/labs/$id/add/$key', params: { id, key: key.current } })
  }

  return (
    <form
      onSubmit={(event) => void form.handleSubmit(submit)(event)}
      noValidate
      className="grid gap-4"
    >
      <h1 className="text-2xl font-semibold">{t('labs.ownTitle')}</h1>
      <FormError failure={failure} />
      <TextField
        label={t('labs.ownName')}
        autoComplete="off"
        hint={t('labs.ownNameHint')}
        error={errors.name?.message}
        {...form.register('name')}
      />
      <TextField
        label={t('labs.ownUnit')}
        autoComplete="off"
        hint={t('labs.ownUnitHint')}
        error={errors.unit?.message}
        {...form.register('unit')}
      />
      <Button type="submit" className="h-11" disabled={isSubmitting}>
        {t('labs.ownCreate')}
      </Button>
      <Button asChild variant="ghost" className="h-11 justify-self-start">
        <Link to="/labs/$id/add" params={{ id }}>
          {t('labs.cancel')}
        </Link>
      </Button>
    </form>
  )
}
