import {
  cache,
  Enums,
  imageLoader,
  init,
  metaData,
  RenderingEngine,
  utilities,
  type Types,
} from '@cornerstonejs/core'
import { api } from '@/api/client'
import { errorKey, type ErrorKey } from '@/lib/errors'
import {
  displayFor,
  pixelsFrom,
  type FrameDisplay,
  type FrameMetadata,
  type WindowLevel,
} from './viewerData'

export class ViewerError extends Error {
  readonly key: ErrorKey
  constructor(key: ErrorKey) {
    super('frame unavailable')
    this.key = key
  }
}
const images = new Map<string, { image: Types.IImage; metadata: FrameMetadata }>()
let initialized = false

function initialize() {
  if (initialized) return
  // Two-dimensional CPU rendering applies the original signed pixels, linear
  // rescale and DICOM LINEAR VOI without allocating a volume/GPU texture pool.
  init({
    rendering: {
      // The generic STACK adapter uses planar.renderBackend and consistent
      // zoom/pan units. The legacy stack otherwise falls back to GPU settings.
      useGenericViewport: true,
      useCPURendering: true,
      planar: { renderBackend: Enums.RenderBackends.CPU },
    },
    debug: {},
  })
  cache.setMaxCacheSize(32 * 1024 ** 2)
  imageLoader.registerImageLoader('life', (id) => {
    const entry = images.get(id)
    return {
      promise: entry ? Promise.resolve(entry.image) : Promise.reject(new Error('frame expired')),
    }
  })
  metaData.addProvider((type: string, id: string) => {
    const entry = images.get(id)
    if (!entry) return
    const m = entry.metadata
    if (type === 'imagePixelModule')
      return {
        rows: m.rows,
        columns: m.columns,
        bitsAllocated: 16,
        bitsStored: 16,
        highBit: 15,
        pixelRepresentation: Number(m.signed),
        samplesPerPixel: 1,
        photometricInterpretation: m.photometric,
      }
    if (type === 'generalSeriesModule') return { modality: m.modality }
    if (type === 'imagePlaneModule')
      return {
        rows: m.rows,
        columns: m.columns,
        rowPixelSpacing: m.frame.spacing?.[0] ?? 1,
        columnPixelSpacing: m.frame.spacing?.[1] ?? 1,
        rowCosines: m.frame.orientation?.slice(0, 3),
        columnCosines: m.frame.orientation?.slice(3),
        imagePositionPatient: m.frame.position,
      }
  }, 1000)
  initialized = true
}

export function createViewer(element: HTMLDivElement) {
  initialize()
  const prefix = `life:${crypto.randomUUID()}:`
  const rendering = new RenderingEngine(prefix)
  rendering.enableElement({
    viewportId: prefix,
    type: Enums.ViewportType.STACK,
    element,
    defaultOptions: { background: [0, 0, 0] },
  })
  const viewport = rendering.getViewport(prefix) as Types.IStackViewport
  const abort = new AbortController()
  let revision = 0,
    destroyed = false
  let queue: Promise<unknown> = Promise.resolve()
  const held = new Set<string>()
  let previousSeries: number | undefined
  const observer = new ResizeObserver(() => {
    if (!destroyed) rendering.resize(true, false)
  })
  observer.observe(element)
  function release(id: string) {
    if (cache.getImageLoadObject(id)) cache.removeImageLoadObject(id)
    images.delete(id)
    held.delete(id)
  }
  return {
    show(study: string, series: number, number: number): Promise<FrameDisplay | undefined> {
      const current = ++revision
      const run = async () => {
        if (destroyed || current !== revision) return
        const params = { path: { study_id: study, series, number } }
        const [meta, raw] = await Promise.all([
          api.GET('/api/studies/{study_id}/viewer/{series}/{number}', {
            params,
            signal: abort.signal,
            cache: 'no-store',
          }),
          api.GET('/api/studies/{study_id}/viewer/{series}/{number}/pixels', {
            params,
            signal: abort.signal,
            parseAs: 'arrayBuffer',
            cache: 'no-store',
          }),
        ])
        if (destroyed || current !== revision) return
        if (meta.error) throw new ViewerError(errorKey(meta.error))
        if (raw.error) throw new ViewerError(errorKey(raw.error))
        if (!raw.data) throw new ViewerError('errors.imaging_unsupported')
        const m = meta.data
        const pixels = pixelsFrom(raw.data, m)
        const display = displayFor(pixels, m)
        let min = Infinity,
          max = -Infinity
        for (const value of pixels) {
          min = Math.min(min, value)
          max = Math.max(max, value)
        }
        const id = `${prefix}${current}`
        const image: Types.IImage = {
          imageId: id,
          minPixelValue: min,
          maxPixelValue: max,
          slope: m.frame.slope,
          intercept: m.frame.intercept,
          windowCenter: display.center,
          windowWidth: display.width,
          voiLUTFunction: Enums.VOILUTFunctionType.LINEAR,
          getPixelData: () => pixels,
          // Provide the manager directly: the generic loader otherwise expects a
          // decoder-specific imageFrame object that our raw-frame API does not use.
          voxelManager: utilities.VoxelManager.createImageVoxelManager({
            width: m.columns,
            height: m.rows,
            scalarData: pixels,
            numberOfComponents: 1,
          }),
          getCanvas: () => document.createElement('canvas'),
          rows: m.rows,
          columns: m.columns,
          height: m.rows,
          width: m.columns,
          color: false,
          rgba: false,
          numberOfComponents: 1,
          rowPixelSpacing: m.frame.spacing?.[0] ?? 1,
          columnPixelSpacing: m.frame.spacing?.[1] ?? 1,
          invert: m.photometric === 'MONOCHROME1',
          photometricInterpretation: m.photometric,
          sizeInBytes: pixels.byteLength,
          dataType: m.signed ? 'Int16Array' : 'Uint16Array',
        }
        images.set(id, { image, metadata: m })
        held.add(id)
        try {
          const zoom = previousSeries === series ? viewport.getZoom() : 1
          const pan = previousSeries === series ? viewport.getPan() : ([0, 0] as Types.Point2)
          await viewport.setStack([id])
          if (destroyed) {
            release(id)
            return
          }
          viewport.setProperties({
            voiRange: utilities.windowLevel.toLowHighRange(display.width, display.center),
            invert: image.invert,
          })
          viewport.setZoom(zoom)
          viewport.setPan(pan)
          viewport.render()
        } catch (error) {
          release(id)
          throw error
        }
        previousSeries = series
        // Retain just the displayed image, regardless of stack size. No persistent cache.
        for (const old of held) if (old !== id) release(old)
        return current === revision ? display : undefined
      }
      const next = queue.then(run)
      queue = next.catch(() => undefined)
      return next
    },
    window(value: WindowLevel) {
      viewport.setProperties({
        voiRange: utilities.windowLevel.toLowHighRange(value.width, value.center),
      })
      viewport.render()
    },
    zoom(value: number) {
      viewport.setZoom(value)
      viewport.render()
    },
    pan(dx: number, dy: number) {
      const [x, y] = viewport.getPan()
      viewport.setPan([x + dx, y + dy])
      viewport.render()
    },
    reset() {
      viewport.resetCamera()
      viewport.render()
    },
    destroy() {
      destroyed = true
      revision++
      abort.abort()
      observer.disconnect()
      rendering.destroy()
      for (const id of held) release(id)
    },
  }
}
export type Viewer = ReturnType<typeof createViewer>
