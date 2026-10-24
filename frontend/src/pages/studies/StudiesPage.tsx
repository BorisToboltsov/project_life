import { ImagingPanel } from './ImagingPanel'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { api, type Schemas } from '@/api/client'
import { DateField } from '@/components/form/DateField'
import { FormError, TextField } from '@/components/form/fields'
import { Button } from '@/components/ui/button'
import { isRealDate, isoToDisplay, today } from '@/lib/dates'
import { attempt, type ErrorKey } from '@/lib/errors'
import { uuidv7 } from '@/lib/uuid'
import { useOfflineState } from '@/offline/store'
import { FilesPanel } from '@/pages/labs/FilesPanel'

type Study = Schemas['StudyOut']
const STUDIES = ['studies']

function StudyForm({ item }: { item?: Study }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const cache = useQueryClient()
  const { online } = useOfflineState()
  const id = useRef(item?.id ?? uuidv7())
  const [title, setTitle] = useState(item?.title ?? '')
  const [date, setDate] = useState(item?.local_date ?? today())
  const [institution, setInstitution] = useState(item?.institution ?? '')
  const [note, setNote] = useState(item?.note ?? '')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<ErrorKey>()
  async function save() {
    setBusy(true)
    setFailure(undefined)
    const result = await attempt(() =>
      api.PUT('/api/studies/{study_id}', {
        params: { path: { study_id: id.current } },
        body: { title, local_date: date, institution: institution || null, note: note || null },
      }),
    )
    setBusy(false)
    if (result.failure) return setFailure(result.failure)
    await cache.invalidateQueries({ queryKey: STUDIES })
    await cache.invalidateQueries({ queryKey: ['study', id.current] })
    await navigate({ to: '/studies/$id', params: { id: id.current } })
  }
  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      <FormError failure={failure} />
      <TextField
        label={t('studies.name')}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        required
        maxLength={120}
      />
      <DateField label={t('studies.date')} value={date} onChange={setDate} />
      <TextField
        label={t('studies.institution')}
        value={institution}
        onChange={(e) => setInstitution(e.target.value)}
        maxLength={120}
      />
      <TextField
        label={t('studies.note')}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={2000}
      />
      <Button type="submit" disabled={!online || busy || !title.trim() || !isRealDate(date)}>
        {t('common.save')}
      </Button>
    </form>
  )
}

export function StudiesPage() {
  const { t } = useTranslation()
  const { online } = useOfflineState()
  const [adding, setAdding] = useState(false)
  const query = useQuery({
    queryKey: STUDIES,
    enabled: online,
    retry: false,
    queryFn: async () => {
      const result = await api.GET('/api/studies')
      if (result.error) throw new Error('studies unavailable')
      return result.data
    },
  })
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold">{t('studies.title')}</h1>
      {!online && <p role="status">{t('studies.offline')}</p>}
      {online && query.isPending && <p role="status">{t('common.loading')}</p>}
      {query.isError && (
        <div role="alert">
          <p>{t('studies.failed')}</p>
          <Button onClick={() => void query.refetch()}>{t('common.retry')}</Button>
        </div>
      )}
      <Button disabled={!online} onClick={() => setAdding(!adding)}>
        {t(adding ? 'studies.cancel' : 'studies.new')}
      </Button>
      {adding && <StudyForm />}
      {query.data?.length === 0 && <p>{t('studies.empty')}</p>}
      {query.data?.map((study) => (
        <Link
          key={study.id}
          to="/studies/$id"
          params={{ id: study.id }}
          className="grid gap-1 rounded-lg border p-4"
        >
          <span className="font-medium">{study.title}</span>
          <span className="text-sm text-muted-foreground">
            {isoToDisplay(study.local_date)}
            {study.institution && ` · ${study.institution}`}
          </span>
        </Link>
      ))}
    </div>
  )
}

export function StudyPage() {
  const { id } = useParams({ from: '/app/studies/$id' })
  const { t } = useTranslation()
  const { online } = useOfflineState()
  const navigate = useNavigate()
  const cache = useQueryClient()
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<ErrorKey>()
  const query = useQuery({
    queryKey: ['study', id],
    enabled: online,
    retry: false,
    queryFn: async () => {
      const result = await api.GET('/api/studies/{study_id}', {
        params: { path: { study_id: id } },
      })
      if (result.error) throw new Error('study unavailable')
      return result.data
    },
  })
  async function remove() {
    setBusy(true)
    const result = await attempt(() =>
      api.DELETE('/api/studies/{study_id}', { params: { path: { study_id: id } } }),
    )
    setBusy(false)
    if (result.failure) return setFailure(result.failure)
    cache.removeQueries({ queryKey: ['study', id] })
    cache.removeQueries({ queryKey: ['study-files', id] })
    await cache.invalidateQueries({ queryKey: STUDIES })
    await navigate({ to: '/studies' })
  }
  return (
    <div className="grid gap-5">
      <Link to="/studies" className="text-sm underline">
        {t('studies.title')}
      </Link>
      {!online && <p role="status">{t('studies.offline')}</p>}
      {online && query.isPending && <p role="status">{t('common.loading')}</p>}
      {query.isError && (
        <div role="alert">
          <p>{t('studies.failed')}</p>
          <Button onClick={() => void query.refetch()}>{t('common.retry')}</Button>
        </div>
      )}
      {query.data && (
        <>
          <h1 className="text-2xl font-semibold">{query.data.title}</h1>
          <StudyForm key={id} item={query.data} />
          <ImagingPanel key={`imaging-${id}`} studyId={id} />
          <section className="grid gap-3">
            <h2 className="text-lg font-semibold">{t('studies.conclusion')}</h2>
            <FilesPanel studyId={id} />
          </section>
          <FormError failure={failure} />
          {confirm ? (
            <div className="grid gap-3">
              <p>{t('studies.deleteConfirm')}</p>
              <Button
                variant="destructive"
                disabled={!online || busy}
                onClick={() => void remove()}
              >
                {t('studies.delete')}
              </Button>
              <Button variant="outline" onClick={() => setConfirm(false)}>
                {t('studies.cancel')}
              </Button>
            </div>
          ) : (
            <Button variant="outline" disabled={!online} onClick={() => setConfirm(true)}>
              {t('studies.delete')}
            </Button>
          )}
        </>
      )}
    </div>
  )
}
