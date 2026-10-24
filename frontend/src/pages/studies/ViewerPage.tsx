import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from '@tanstack/react-router'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '@/api/client'
import { Button } from '@/components/ui/button'
import { FormError } from '@/components/form/fields'
import { attempt, type ErrorKey } from '@/lib/errors'
import { isoToDisplay } from '@/lib/dates'
import { useOfflineState } from '@/offline/store'
import type { Viewer } from './viewerEngine'
import type { FrameDisplay, WindowLevel } from './viewerData'

const TOOLS = ['contrast', 'zoom', 'pan'] as const

function FrameView({
  id,
  series,
  number,
  navigation,
}: {
  id: string
  series: number
  number: number
  navigation: ReactNode
}) {
  const { t } = useTranslation()
  const host = useRef<HTMLDivElement>(null)
  const engine = useRef<Promise<Viewer> | null>(null)
  const [display, setDisplay] = useState<FrameDisplay>()
  const [window, setWindow] = useState<WindowLevel>()
  const customWindow = useRef<WindowLevel | undefined>(undefined)
  const [zoom, setZoom] = useState(1)
  const [tool, setTool] = useState<'contrast' | 'zoom' | 'pan'>('contrast')
  const [completed, setCompleted] = useState<string>()
  const [failure, setFailure] = useState<ErrorKey>()
  const [retry, setRetry] = useState(0)
  const request = `${id}/${series}/${number}/${retry}`
  const busy = completed !== request
  const drag = useRef<{ x: number; y: number; pointer: number } | null>(null)
  useEffect(() => {
    let disposed = false
    const pending = import('./viewerEngine').then(({ createViewer }) => {
      if (disposed || !host.current) throw new Error('viewer closed')
      return createViewer(host.current)
    })
    engine.current = pending
    void pending.catch(() => undefined)
    return () => {
      disposed = true
      engine.current = null
      void pending.then((viewer) => viewer.destroy()).catch(() => undefined)
    }
  }, [])
  useEffect(() => {
    let active = true
    // Coalesce slider movement before requesting a frame; engine also serializes loads.
    const timer = setTimeout(() => {
      setFailure(undefined)
      void engine.current
        ?.then((viewer) => viewer.show(id, series, number))
        .then((value) => {
          if (!active || !value) return
          setDisplay(value)
          setWindow(customWindow.current ?? value)
          if (customWindow.current)
            void engine.current?.then((viewer) => viewer.window(customWindow.current!))
          setCompleted(request)
        })
        .catch((error: unknown) => {
          if (!active) return
          setFailure(
            error && typeof error === 'object' && 'key' in error
              ? (error.key as ErrorKey)
              : 'errors.unknown',
          )
          setCompleted(request)
        })
    }, 100)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [id, series, number, request])
  const ready = !busy && !failure && !!display
  function changeWindow(value: WindowLevel) {
    customWindow.current = value
    setWindow(value)
    void engine.current?.then((viewer) => viewer.window(value))
  }
  return (
    <div className="grid gap-3">
      <div
        className="relative overflow-hidden rounded-xl bg-black"
        style={{ height: 'clamp(240px, 52svh, 680px)' }}
      >
        <div
          ref={host}
          data-testid="dicom-viewport"
          className="h-full w-full touch-none"
          style={{ visibility: ready ? 'visible' : 'hidden' }}
          onPointerDown={(event) => {
            if (ready && tool === 'pan') {
              drag.current = { x: event.clientX, y: event.clientY, pointer: event.pointerId }
              event.currentTarget.setPointerCapture(event.pointerId)
            }
          }}
          onPointerMove={(event) => {
            const p = drag.current
            if (!p || p.pointer !== event.pointerId) return
            const dx = event.clientX - p.x,
              dy = event.clientY - p.y
            drag.current = { x: event.clientX, y: event.clientY, pointer: p.pointer }
            void engine.current?.then((viewer) => viewer.pan(dx, dy))
          }}
          onPointerUp={() => {
            drag.current = null
          }}
          onPointerCancel={() => {
            drag.current = null
          }}
        />
        {ready &&
          display.orientation.map((label, index) => (
            <span
              key={index}
              className={
                [
                  'pointer-events-none absolute top-2 left-1/2 -translate-x-1/2 rounded bg-black/60 px-1 text-white',
                  'pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded bg-black/60 px-1 text-white',
                  'pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded bg-black/60 px-1 text-white',
                  'pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 rounded bg-black/60 px-1 text-white',
                ][index]
              }
            >
              {label}
            </span>
          ))}
        {(busy || failure) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-white">
            {busy ? (
              <p role="status">{t('common.loading')}</p>
            ) : (
              <>
                <p role="alert">{t(failure!)}</p>
                <Button variant="secondary" onClick={() => setRetry((value) => value + 1)}>
                  {t('common.retry')}
                </Button>
              </>
            )}
          </div>
        )}
      </div>
      {navigation}
      <div className="flex flex-wrap gap-2">
        {TOOLS.map((item) => (
          <Button
            key={item}
            variant={tool === item ? 'default' : 'outline'}
            aria-pressed={tool === item}
            onClick={() => setTool(item)}
          >
            {t(`viewer.${item}`)}
          </Button>
        ))}
        <Button
          variant="outline"
          disabled={!ready}
          onClick={() => {
            if (display) changeWindow(display)
            customWindow.current = undefined
            setZoom(1)
            void engine.current?.then((viewer) => viewer.reset())
          }}
        >
          {t('viewer.reset')}
        </Button>
      </div>
      {tool === 'contrast' && window && display && (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-sm">
            {t('viewer.width', { value: Math.round(window.width * 10) / 10 })}
            <input
              type="range"
              className="min-h-8 w-full"
              aria-label={t('viewer.windowWidth')}
              disabled={!ready}
              min="1"
              max={Math.max(display.width * 2, display.max - display.min + 1, window.width)}
              step="0.1"
              value={window.width}
              onChange={(event) => changeWindow({ ...window, width: Number(event.target.value) })}
            />
          </label>
          <label className="grid gap-1 text-sm">
            {t('viewer.level', { value: Math.round(window.center * 10) / 10 })}
            <input
              type="range"
              className="min-h-8 w-full"
              aria-label={t('viewer.windowLevel')}
              disabled={!ready}
              min={Math.min(display.min - display.width, window.center)}
              max={Math.max(display.max + display.width, window.center)}
              step="0.1"
              value={window.center}
              onChange={(event) => changeWindow({ ...window, center: Number(event.target.value) })}
            />
          </label>
        </div>
      )}
      {tool === 'zoom' && (
        <label className="grid gap-1 text-sm">
          {t('viewer.scale', { value: Math.round(zoom * 100) })}
          <input
            type="range"
            className="min-h-8 w-full"
            aria-label={t('viewer.zoom')}
            disabled={!ready}
            min="0.5"
            max="5"
            step="0.1"
            value={zoom}
            onChange={(event) => {
              const value = Number(event.target.value)
              setZoom(value)
              void engine.current?.then((viewer) => viewer.zoom(value))
            }}
          />
        </label>
      )}
      {tool === 'pan' && <p className="text-sm text-muted-foreground">{t('viewer.panHelp')}</p>}
    </div>
  )
}

export function ViewerPage() {
  const { id } = useParams({ from: '/app/studies/$id/viewer' })
  const { t } = useTranslation()
  const { online } = useOfflineState()
  const [series, setSeries] = useState(0)
  const [number, setNumber] = useState(0)
  const [failure, setFailure] = useState<ErrorKey>()
  const [downloading, setDownloading] = useState(false)
  const query = useQuery({
    queryKey: ['study-viewer', id],
    enabled: online,
    retry: false,
    gcTime: 0,
    queryFn: async ({ signal }) => {
      const [study, viewer] = await Promise.all([
        api.GET('/api/studies/{study_id}', { params: { path: { study_id: id } }, signal }),
        api.GET('/api/studies/{study_id}/viewer', { params: { path: { study_id: id } }, signal }),
      ])
      if (study.error || viewer.error) throw new Error('viewer unavailable')
      return { study: study.data, viewer: viewer.data }
    },
  })
  const selected = query.data?.viewer.series.find((item) => item.index === series)
  async function download() {
    setDownloading(true)
    setFailure(undefined)
    const result = await attempt(() =>
      api.POST('/api/studies/{study_id}/original-download', { params: { path: { study_id: id } } }),
    )
    setDownloading(false)
    if (result.failure) return setFailure(result.failure)
    // Native download streams to disk. No ZIP blob, token in URL, or service-worker cache.
    const link = document.createElement('a')
    link.href = `/api/studies/${encodeURIComponent(id)}/original`
    link.download = ''
    link.click()
  }
  return (
    <div className="mx-auto grid w-full max-w-5xl gap-4 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <Link to="/studies/$id" params={{ id }} className="text-sm underline">
          {t('viewer.back')}
        </Link>
        <Button
          variant="outline"
          disabled={!online || downloading || !query.data}
          onClick={() => void download()}
        >
          {t('viewer.original')}
        </Button>
      </header>
      <FormError failure={failure} />
      <div>
        <h1 className="break-words text-xl font-semibold">
          {query.data?.study.title ?? t('viewer.title')}
        </h1>
        {query.data && (
          <p className="text-sm text-muted-foreground">
            {isoToDisplay(query.data.study.local_date)}
          </p>
        )}
      </div>
      {!online && <p role="status">{t('studies.offline')}</p>}
      {online && query.isPending && <p role="status">{t('common.loading')}</p>}
      {query.isError && (
        <div role="alert">
          <p>{t('viewer.failed')}</p>
          <Button onClick={() => void query.refetch()}>{t('common.retry')}</Button>
        </div>
      )}
      {online && query.data && (
        <>
          <label className="grid min-w-0 gap-1 text-sm">
            {t('viewer.series')}
            <select
              className="w-full min-w-0 rounded-lg border bg-background p-3"
              value={series}
              onChange={(event) => {
                setSeries(Number(event.target.value))
                setNumber(0)
              }}
            >
              {query.data.viewer.series.map((item) => (
                <option key={item.index} value={item.index}>
                  {t('viewer.seriesOption', {
                    number: item.index + 1,
                    name: item.description || t('imaging.unnamed'),
                    count: item.frames,
                  })}
                </option>
              ))}
            </select>
          </label>
          {query.data.viewer.warnings.length > 0 && (
            <p role="status" className="text-sm text-muted-foreground">
              {query.data.viewer.warnings
                .map((code) =>
                  t(
                    code === 'fallback_order'
                      ? 'imaging.fallbackOrder'
                      : code === 'overlapping_positions'
                        ? 'imaging.overlapping'
                        : code === 'multiple_patients'
                          ? 'imaging.multiplePatients'
                          : 'imaging.warnings',
                  ),
                )
                .join(' ')}
            </p>
          )}
          {selected && (
            <>
              <FrameView
                key={`${id}:${series}`}
                id={id}
                series={series}
                number={number}
                navigation={
                  <div className="grid gap-2">
                    <div className="flex items-center justify-between gap-2">
                      <Button
                        variant="outline"
                        disabled={number === 0}
                        onClick={() => setNumber((n) => n - 1)}
                      >
                        {t('viewer.previous')}
                      </Button>
                      <p className="text-center text-sm tabular-nums">
                        {t('viewer.frame', { number: number + 1, total: selected.frames })}
                      </p>
                      <Button
                        variant="outline"
                        disabled={number + 1 >= selected.frames}
                        onClick={() => setNumber((n) => n + 1)}
                      >
                        {t('viewer.next')}
                      </Button>
                    </div>
                    <input
                      type="range"
                      className="min-h-8 w-full"
                      aria-label={t('viewer.slice')}
                      min="0"
                      max={selected.frames - 1}
                      value={number}
                      onChange={(event) => setNumber(Number(event.target.value))}
                    />
                  </div>
                }
              />
            </>
          )}
        </>
      )}
    </div>
  )
}
