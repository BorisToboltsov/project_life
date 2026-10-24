import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'

export default function FilePreview({
  url,
  mime,
  name,
  data,
}: {
  url: string
  mime: string
  name: string
  data?: Uint8Array
}) {
  const { t } = useTranslation()
  const canvas = useRef<HTMLCanvasElement>(null)
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(1)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (mime !== 'application/pdf') return
    let cancelled = false
    let dispose: (() => void) | undefined
    async function render() {
      try {
        const pdfjs = await import('pdfjs-dist')
        const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
        if (cancelled) return
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default
        const assets = `/pdfjs/${pdfjs.version}/`
        const task = pdfjs.getDocument({
          data: data?.slice(),
          disableFontFace: true,
          standardFontDataUrl: `${assets}standard_fonts/`,
          cMapUrl: `${assets}cmaps/`,
          cMapPacked: true,
          wasmUrl: `${assets}wasm/`,
          iccUrl: `${assets}iccs/`,
        })
        dispose = () => {
          void task.destroy()
        }
        const document = await task.promise
        if (cancelled) return
        setPages(document.numPages)
        const current = await document.getPage(page)
        if (cancelled || !canvas.current) return
        const base = current.getViewport({ scale: 1 })
        const viewport = current.getViewport({
          scale: Math.min(1.5, 1200 / Math.max(base.width, base.height)),
        })
        canvas.current.width = viewport.width
        canvas.current.height = viewport.height
        await current.render({ canvas: canvas.current, viewport }).promise
      } catch {
        if (!cancelled) setFailed(true)
      }
    }
    void render()
    return () => {
      cancelled = true
      dispose?.()
    }
  }, [mime, page, data])
  if (mime !== 'application/pdf')
    return <img src={url} alt={name} className="max-h-[70vh] max-w-full object-contain" />
  return (
    <div className="grid gap-2">
      {failed ? (
        <p role="alert">{t('files.previewError')}</p>
      ) : (
        <canvas ref={canvas} aria-label={name} className="max-w-full" />
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>
          {t('files.previous')}
        </Button>
        <span>{t('files.page', { page, pages })}</span>
        <Button variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>
          {t('files.next')}
        </Button>
      </div>
    </div>
  )
}
