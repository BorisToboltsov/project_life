import { useQuery, useQueryClient } from '@tanstack/react-query'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { api, type Schemas } from '@/api/client'
import { FormError } from '@/components/form/fields'
import { Button } from '@/components/ui/button'
import { attempt, type ErrorKey } from '@/lib/errors'
import { uuidv7 } from '@/lib/uuid'
import { useOfflineState } from '@/offline/store'

const FilePreview = lazy(() => import('./FilePreview'))
type Attachment = Schemas['AttachmentOut']
const MAX_BYTES = 50 * 1024 * 1024

export function FilesPanel({ reportId, studyId }: { reportId?: string; studyId?: string }) {
  const parentId = studyId ?? reportId ?? ''
  const { t } = useTranslation()
  const { online, pending } = useOfflineState()
  const enabled = online && !pending.has(parentId)
  const queryClient = useQueryClient()
  const [failure, setFailure] = useState<ErrorKey>()
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<number>()
  const [preview, setPreview] = useState<{
    url: string
    mime: string
    name: string
    id: string
    data?: Uint8Array
  }>()
  const [confirmDelete, setConfirmDelete] = useState<string>()
  const abort = useRef<AbortController | null>(null)
  const queryKey = [studyId ? 'study-files' : 'lab-files', parentId]
  const files = useQuery({
    queryKey,
    enabled,
    retry: false,
    queryFn: async () => {
      const result = studyId
        ? await api.GET('/api/studies/{study_id}/files', {
            params: { path: { study_id: studyId } },
          })
        : await api.GET('/api/lab-reports/{report_id}/files', {
            params: { path: { report_id: parentId } },
          })
      if (result.error) throw new Error('file list unavailable')
      return result.data
    },
  })
  useEffect(() => () => abort.current?.abort(), [])
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview.url)
    },
    [preview],
  )

  async function upload(file: File) {
    setFailure(undefined)
    if (file.size <= 0 || file.size > MAX_BYTES) {
      setFailure('errors.file_invalid')
      return
    }
    const controller = new AbortController()
    abort.current = controller
    setBusy(true)
    setProgress(0)
    try {
      const bytes = await file.arrayBuffer()
      const digest = await crypto.subtle.digest('SHA-256', bytes)
      const sha256 = [...new Uint8Array(digest)]
        .map((v) => v.toString(16).padStart(2, '0'))
        .join('')
      const previous = files.data?.find(
        (item) =>
          item.state === 'uploading' &&
          item.name === file.name &&
          item.sha256 === sha256 &&
          item.size === file.size &&
          Date.parse(item.expires_at) > Date.now(),
      )
      const id = previous?.id ?? uuidv7()
      const created = await attempt(() =>
        studyId
          ? api.PUT('/api/studies/{study_id}/files/{file_id}', {
              params: { path: { study_id: studyId, file_id: id } },
              body: { name: file.name, size: file.size, sha256 },
              signal: controller.signal,
            })
          : api.PUT('/api/lab-reports/{report_id}/files/{file_id}', {
              params: { path: { report_id: parentId, file_id: id } },
              body: { name: file.name, size: file.size, sha256 },
              signal: controller.signal,
            }),
      )
      if (created.failure) {
        setFailure(created.failure)
        return
      }
      const plan = await attempt(() =>
        api.POST('/api/files/{file_id}/parts', {
          params: { path: { file_id: id } },
          signal: controller.signal,
        }),
      )
      if (plan.failure) {
        setFailure(plan.failure)
        return
      }
      let sent = 0
      for (const [index, url] of plan.data.urls.entries()) {
        const chunk = file.slice(index * plan.data.part_size, (index + 1) * plan.data.part_size)
        if (!plan.data.uploaded.some((p) => p.number === index + 1 && p.size === chunk.size)) {
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
        api.POST('/api/files/{file_id}/complete', {
          params: { path: { file_id: id } },
          signal: controller.signal,
        }),
      )
      if (done.failure) setFailure(done.failure)
    } catch {
      if (!controller.signal.aborted) setFailure('errors.network')
    } finally {
      setBusy(false)
      setProgress(undefined)
      abort.current = null
      await queryClient.invalidateQueries({ queryKey })
    }
  }

  async function open(item: Attachment, download: boolean) {
    setFailure(undefined)
    setBusy(true)
    const result = await attempt(() =>
      api.GET('/api/files/{file_id}/content', {
        params: { path: { file_id: item.id } },
        parseAs: 'blob',
      }),
    )
    setBusy(false)
    if (result.failure) {
      setFailure(result.failure)
      return
    }
    const url = URL.createObjectURL(result.data as Blob)
    if (download) {
      const link = document.createElement('a')
      link.href = url
      link.download = item.name
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 30_000)
    } else {
      const data =
        item.content_type === 'application/pdf'
          ? new Uint8Array(await (result.data as Blob).arrayBuffer())
          : undefined
      setPreview({ id: item.id, url, mime: item.content_type ?? '', name: item.name, data })
    }
  }

  async function remove(id: string) {
    const result = await attempt(() =>
      api.DELETE('/api/files/{file_id}', { params: { path: { file_id: id } } }),
    )
    setConfirmDelete(undefined)
    if (result.failure) setFailure(result.failure)
    else {
      if (preview?.id === id) setPreview(undefined)
      await queryClient.invalidateQueries({ queryKey })
    }
  }

  return (
    <section className="grid gap-3" aria-label={t('files.title')}>
      <h2 className="text-lg font-semibold">{t('files.title')}</h2>
      {!enabled ? (
        <p className="text-sm text-muted-foreground">
          {t(online ? 'files.syncFirst' : 'files.onlineOnly')}
        </p>
      ) : (
        <>
          {files.isError && <p role="alert">{t('files.listError')}</p>}
          {files.isLoading && <p>{t('common.loading')}</p>}
          {files.data?.map((item) => (
            <div key={item.id} className="grid gap-2 rounded-lg border p-3">
              <p className="break-all font-medium">{item.name}</p>
              <p className="text-sm text-muted-foreground">
                {t('files.size', { size: (item.size / 1024 / 1024).toFixed(1) })} ·{' '}
                {t(`files.${item.state}`)}
              </p>
              {item.state === 'uploading' && <p className="text-sm">{t('files.resume')}</p>}
              <div className="flex flex-wrap gap-2">
                {item.state === 'ready' && (
                  <>
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => void open(item, false)}
                    >
                      {t('files.open')}
                    </Button>
                    <Button variant="outline" disabled={busy} onClick={() => void open(item, true)}>
                      {t('files.download')}
                    </Button>
                  </>
                )}
                <Button variant="ghost" disabled={busy} onClick={() => setConfirmDelete(item.id)}>
                  {t('files.remove')}
                </Button>
                {confirmDelete === item.id && (
                  <>
                    <span>{t('files.confirmDelete')}</span>
                    <Button variant="destructive" onClick={() => void remove(item.id)}>
                      {t('files.confirm')}
                    </Button>
                    <Button variant="ghost" onClick={() => setConfirmDelete(undefined)}>
                      {t('files.cancel')}
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))}
          <label className="grid cursor-pointer gap-2 rounded-lg border p-3 text-sm focus-within:ring-2">
            {t('files.add')}
            <input
              type="file"
              accept="application/pdf,image/png,image/jpeg"
              disabled={busy}
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void upload(file)
                event.target.value = ''
              }}
            />
          </label>
          <p className="text-sm text-muted-foreground">{t('files.formats')}</p>
          {busy && (
            <p role="status">
              {progress === undefined
                ? t('common.loading')
                : t('files.progress', { percent: progress })}
            </p>
          )}
        </>
      )}
      <FormError failure={failure} />
      {preview && (
        <div className="grid gap-2">
          <Button variant="outline" onClick={() => setPreview(undefined)}>
            {t('files.close')}
          </Button>
          <Suspense fallback={<p>{t('common.loading')}</p>}>
            <FilePreview key={preview.url} {...preview} />
          </Suspense>
        </div>
      )}
    </section>
  )
}
