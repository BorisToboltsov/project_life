import { archiveHash } from './archiveHash'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from '@tanstack/react-router'
import { api, type Schemas } from '@/api/client'
import { Button } from '@/components/ui/button'
import { FormError } from '@/components/form/fields'
import { attempt, type ErrorKey } from '@/lib/errors'
import { uuidv7 } from '@/lib/uuid'
import { useOfflineState } from '@/offline/store'

type Import = Schemas['ImportOut']

function Selection({
  item,
  studyId,
  online,
  refresh,
}: {
  item: Import
  studyId: string
  online: boolean
  refresh: () => Promise<unknown>
}) {
  const { t } = useTranslation()
  const [selected, setSelected] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<ErrorKey>()
  const request = useRef<{ signature: string; studies: Record<string, string> } | null>(null)
  async function confirm() {
    const signature = [...selected].sort().join(',')
    if (request.current?.signature !== signature) {
      request.current = {
        signature,
        studies: Object.fromEntries(
          selected.map((uid, index) => [uid, index === 0 ? studyId : uuidv7()]),
        ),
      }
    }
    setBusy(true)
    const result = await attempt(() =>
      api.POST('/api/imaging-imports/{import_id}/confirm', {
        params: { path: { import_id: item.id } },
        body: { studies: request.current!.studies },
      }),
    )
    setBusy(false)
    setFailure(result.failure)
    await refresh()
  }
  return (
    <div className="grid gap-3">
      <p>{t('imaging.choose')}</p>
      {item.skipped > 0 && <p role="status">{t('imaging.skipped', { count: item.skipped })}</p>}
      {item.candidates.map((candidate) => (
        <label key={candidate.uid} className="flex items-start gap-3 rounded-lg border p-3">
          <input
            type="checkbox"
            disabled={!online || busy}
            checked={selected.includes(candidate.uid)}
            onChange={(event) =>
              setSelected((current) =>
                event.target.checked
                  ? [...current, candidate.uid]
                  : current.filter((uid) => uid !== candidate.uid),
              )
            }
          />
          <span className="grid min-w-0 gap-1 break-words">
            <strong>{candidate.description || t('imaging.unnamed')}</strong>
            <span>{candidate.modalities.join(' · ')}</span>
            {candidate.patients.map((patient) => (
              <span key={patient}>{patient}</span>
            ))}
            <span>
              {t('imaging.counts', { series: candidate.series, frames: candidate.frames })}
            </span>
            {candidate.warnings.length > 0 && (
              <span>
                {candidate.warnings
                  .map((code) =>
                    t(
                      code === 'multiple_patients'
                        ? 'imaging.multiplePatients'
                        : code === 'fallback_order'
                          ? 'imaging.fallbackOrder'
                          : code === 'overlapping_positions'
                            ? 'imaging.overlapping'
                            : 'imaging.warnings',
                    ),
                  )
                  .join(' ')}
              </span>
            )}
          </span>
        </label>
      ))}
      <FormError failure={failure} />
      <Button disabled={!online || busy || selected.length === 0} onClick={() => void confirm()}>
        {t('imaging.confirm')}
      </Button>
    </div>
  )
}

export function ImagingPanel({ studyId }: { studyId: string }) {
  const { t } = useTranslation()
  const { online } = useOfflineState()
  const cache = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<number>()
  const [failure, setFailure] = useState<ErrorKey>()
  const [removing, setRemoving] = useState<string>()
  const [uploading, setUploading] = useState(false)
  const abort = useRef<AbortController | null>(null)
  const queryKey = ['study-imports', studyId]
  const imports = useQuery({
    queryKey,
    enabled: online,
    retry: false,
    queryFn: async () => {
      const result = await api.GET('/api/studies/{study_id}/imports', {
        params: { path: { study_id: studyId } },
      })
      if (result.error) throw new Error('imports unavailable')
      return result.data
    },
    refetchInterval: (query) =>
      online && query.state.data?.some((item) => ['inspecting', 'importing'].includes(item.state))
        ? 2000
        : false,
  })
  useEffect(() => () => abort.current?.abort(), [])
  async function refresh() {
    await cache.invalidateQueries({ queryKey })
    await cache.invalidateQueries({ queryKey: ['studies'] })
  }
  async function upload(file: File) {
    if (file.size <= 0 || file.size > 2 * 1024 ** 3) return setFailure('errors.file_invalid')
    const controller = new AbortController()
    abort.current = controller
    setUploading(true)
    setBusy(true)
    setFailure(undefined)
    setProgress(undefined)
    try {
      const digest = await archiveHash(file, controller.signal)
      const previous = imports.data?.find(
        (item) =>
          item.state === 'uploading' &&
          item.name === file.name &&
          item.size === file.size &&
          item.sha256 === digest,
      )
      const id = previous?.id ?? uuidv7()
      const created = await attempt(() =>
        api.PUT('/api/studies/{study_id}/imports/{import_id}', {
          params: { path: { study_id: studyId, import_id: id } },
          body: { name: file.name, size: file.size, sha256: digest },
          signal: controller.signal,
        }),
      )
      if (created.failure) return setFailure(created.failure)
      const plan = await attempt(() =>
        api.POST('/api/imaging-imports/{import_id}/parts', {
          params: { path: { import_id: id } },
          signal: controller.signal,
        }),
      )
      if (plan.failure) return setFailure(plan.failure)
      let sent = 0
      for (const [index, url] of plan.data.urls.entries()) {
        const chunk = file.slice(index * plan.data.part_size, (index + 1) * plan.data.part_size)
        if (
          !plan.data.uploaded.some((part) => part.number === index + 1 && part.size === chunk.size)
        ) {
          if (!url.startsWith('/life-uploads/')) throw new Error('invalid upload destination')
          const response = await fetch(url, {
            method: 'PUT',
            body: chunk,
            credentials: 'omit',
            signal: controller.signal,
          })
          if (!response.ok) throw new Error('upload failed')
        }
        sent += chunk.size
        setProgress(Math.round((sent / file.size) * 100))
      }
      const done = await attempt(() =>
        api.POST('/api/imaging-imports/{import_id}/complete', {
          params: { path: { import_id: id } },
          signal: controller.signal,
        }),
      )
      setFailure(done.failure)
    } catch {
      if (!controller.signal.aborted) setFailure('errors.network')
    } finally {
      setBusy(false)
      setProgress(undefined)
      abort.current = null
      setUploading(false)
      await refresh()
    }
  }
  async function remove(id: string) {
    setBusy(true)
    const result = await attempt(() =>
      api.DELETE('/api/imaging-imports/{import_id}', { params: { path: { import_id: id } } }),
    )
    setBusy(false)
    setFailure(result.failure)
    setRemoving(undefined)
    await refresh()
  }
  const hasImaging = imports.data?.some((item) => ['importing', 'ready'].includes(item.state))
  return (
    <section className="grid gap-3">
      <h2 className="text-lg font-semibold">{t('imaging.title')}</h2>
      <p className="text-sm text-muted-foreground">{t('imaging.help')}</p>
      {!online && <p role="status">{t('studies.offline')}</p>}
      {imports.isError && (
        <div role="alert">
          <p>{t('imaging.failed')}</p>
          <Button onClick={() => void refresh()}>{t('common.retry')}</Button>
        </div>
      )}
      {!hasImaging && (
        <label className="grid cursor-pointer gap-2 rounded-lg border p-3 focus-within:ring-2 focus-within:ring-ring">
          {t('imaging.upload')}
          <input
            type="file"
            className="sr-only"
            accept=".zip,application/zip"
            disabled={!online || busy || !imports.data}
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) void upload(file)
            }}
          />
        </label>
      )}
      {busy && (
        <p role="status">
          {progress === undefined ? t('imaging.preparing') : t('imaging.progress', { progress })}
        </p>
      )}
      {uploading && (
        <Button variant="outline" onClick={() => abort.current?.abort()}>
          {t('imaging.pause')}
        </Button>
      )}
      <FormError failure={failure} />
      {imports.data?.map((item) => (
        <article key={item.id} className="grid gap-3 rounded-lg border p-4">
          <h3 className="break-all font-medium">{item.name}</h3>
          <p role="status">
            {t(
              item.state === 'uploading'
                ? 'imaging.uploading'
                : item.state === 'inspecting'
                  ? 'imaging.inspecting'
                  : item.state === 'awaiting_confirmation'
                    ? 'imaging.awaiting'
                    : item.state === 'importing'
                      ? 'imaging.importing'
                      : item.state === 'ready'
                        ? 'imaging.ready'
                        : 'imaging.invalid',
            )}
          </p>
          {item.state === 'awaiting_confirmation' && (
            <Selection item={item} studyId={studyId} online={online} refresh={refresh} />
          )}
          {item.state === 'ready' &&
            Object.values(item.selection ?? {}).includes(studyId) &&
            online && (
              <Link
                className="rounded-lg bg-primary p-3 text-center text-primary-foreground"
                to="/studies/$id/viewer"
                params={{ id: studyId }}
              >
                {t('viewer.open')}
              </Link>
            )}
          {item.state === 'ready' &&
            Object.entries(item.selection ?? {})
              .filter(([, id]) => id !== studyId)
              .map(([uid, id]) => (
                <Link key={id} to="/studies/$id" params={{ id }}>
                  {item.candidates.find((candidate) => candidate.uid === uid)?.description ||
                    t('imaging.unnamed')}
                </Link>
              ))}
          {!['ready', 'importing'].includes(item.state) &&
            (removing === item.id ? (
              <div className="grid gap-2">
                <p>{t('imaging.removeConfirm')}</p>
                <Button
                  variant="destructive"
                  disabled={!online || busy}
                  onClick={() => void remove(item.id)}
                >
                  {t('imaging.remove')}
                </Button>
                <Button variant="outline" onClick={() => setRemoving(undefined)}>
                  {t('studies.cancel')}
                </Button>
              </div>
            ) : (
              <Button
                variant="outline"
                disabled={!online || busy}
                onClick={() => setRemoving(item.id)}
              >
                {t('imaging.remove')}
              </Button>
            ))}
        </article>
      ))}
    </section>
  )
}
