import { beforeEach, expect, it, vi } from 'vitest'
import type { Types } from '@cornerstonejs/core'
import { mockApi, json } from '@/test/api'

const core = vi.hoisted(() => {
  const stored = new Map<string, Types.IImage>()
  let loader: (id: string) => { promise: Promise<Types.IImage> }
  let provider: (type: string, id: string) => unknown
  const viewport = {
    setStack: vi.fn<(ids: string[]) => Promise<void>>(async (ids) => {
      const image = await loader(ids[0]).promise
      stored.set(ids[0], image)
    }),
    getZoom: () => 1,
    getPan: () => [0, 0],
    setZoom: vi.fn<(value: number) => void>(),
    setPan: vi.fn<(point: number[]) => void>(),
    setProperties: vi.fn<(value: unknown) => void>(),
    render: vi.fn<() => void>(),
    resetCamera: vi.fn<() => void>(),
  }
  return {
    stored,
    init: vi.fn<(configuration: unknown) => boolean>(() => true),
    viewport,
    getMetadata: (id: string) => provider('imagePixelModule', id),
    register: (_scheme: string, value: typeof loader) => {
      loader = value
    },
    addProvider: (value: typeof provider) => {
      provider = value
    },
    remove: vi.fn<(id: string) => void>((id) => {
      stored.delete(id)
    }),
    max: vi.fn<(size: number) => void>(),
    destroy: vi.fn<() => void>(),
  }
})
vi.mock('@cornerstonejs/core', () => ({
  init: core.init,
  Enums: {
    RenderBackends: { CPU: 'cpu' },
    ViewportType: { STACK: 'stack' },
    VOILUTFunctionType: { LINEAR: 'LINEAR' },
  },
  RenderingEngine: class {
    enableElement() {}
    getViewport() {
      return core.viewport
    }
    resize() {}
    destroy() {
      core.destroy()
    }
  },
  imageLoader: { registerImageLoader: core.register },
  metaData: { addProvider: core.addProvider },
  cache: {
    setMaxCacheSize: core.max,
    getImageLoadObject: (id: string) => core.stored.get(id),
    removeImageLoadObject: core.remove,
  },
  utilities: {
    VoxelManager: {
      createImageVoxelManager: ({ scalarData }: { scalarData: Int16Array | Uint16Array }) => ({
        getScalarData: () => scalarData,
      }),
    },
    windowLevel: {
      toLowHighRange: (width: number, center: number) => ({
        lower: center - width / 2,
        upper: center + width / 2,
      }),
    },
  },
}))
const meta = {
  rows: 2,
  columns: 2,
  signed: true,
  photometric: 'MONOCHROME1',
  modality: 'MR',
  frame: {
    number: 0,
    slope: 3,
    intercept: -100,
    spacing: [0.5, 0.7],
    orientation: [1, 0, 0, 0, 1, 0],
    position: [0, 0, 0],
    window_width: [400],
    window_center: [40],
  },
}
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
  vi.resetModules()
  core.stored.clear()
  core.remove.mockClear()
  core.destroy.mockClear()
  core.viewport.setStack.mockClear()
})
it('I26: browsing many frames retains one signed frame and destroys all pixels/metadata on exit', async () => {
  mockApi({
    'GET /api/studies/study/viewer/*': (call) =>
      call.path.endsWith('/pixels')
        ? new Response(new Int16Array([-2048, -1, 0, 2047]))
        : json(200, meta)(call),
  })
  const { createViewer } = await import('./viewerEngine')
  const viewer = createViewer(document.createElement('div'))
  let previous: string | undefined
  for (let number = 0; number < 30; number++) {
    await viewer.show('study', 0, number)
    expect(core.stored.size).toBe(1)
    expect(core.getMetadata(previous ?? 'missing')).toBeUndefined()
    previous = [...core.stored.keys()][0]
    const image = core.stored.get(previous)!
    expect(image.voxelManager?.getScalarData()).toBe(image.getPixelData())
    expect([...image.getPixelData()]).toEqual([-2048, -1, 0, 2047])
    expect([image.slope, image.intercept, image.invert]).toEqual([3, -100, true])
  }
  expect(core.init).toHaveBeenCalledWith(
    expect.objectContaining({
      rendering: expect.objectContaining({
        useGenericViewport: true,
        useCPURendering: true,
        planar: { renderBackend: 'cpu' },
      }),
    }),
  )
  expect(core.max).toHaveBeenCalledWith(32 * 1024 ** 2)
  viewer.destroy()
  expect(core.stored.size).toBe(0)
  expect(core.getMetadata(previous!)).toBeUndefined()
  expect(core.destroy).toHaveBeenCalledTimes(1)
})
it('serializes loads and skips obsolete queued positions', async () => {
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const urls: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input) => {
      const request = input as Request
      urls.push(request.url)
      if (request.url.includes('/0/0')) await gate
      return request.url.endsWith('/pixels')
        ? new Response(new Int16Array([-1, 0, 1, 2]))
        : json(
            200,
            meta,
          )({ method: 'GET', path: '', query: {}, body: undefined, authorization: null })
    }),
  )
  const { createViewer } = await import('./viewerEngine')
  const viewer = createViewer(document.createElement('div'))
  const first = viewer.show('study', 0, 0)
  await vi.waitFor(() => expect(urls).toHaveLength(2))
  const skipped = viewer.show('study', 0, 1),
    last = viewer.show('study', 0, 2)
  release()
  expect(await first).toBeUndefined()
  expect(await skipped).toBeUndefined()
  expect(await last).toMatchObject({ width: 400, center: 40 })
  expect(urls).toHaveLength(4)
  expect(urls.some((url) => url.includes('/0/1'))).toBe(false)
  expect(core.viewport.setStack).toHaveBeenCalledTimes(1)
  viewer.destroy()
})
it('releases a failed rendering attempt before retrying', async () => {
  mockApi({
    'GET /api/studies/study/viewer/*': (call) =>
      call.path.endsWith('/pixels')
        ? new Response(new Int16Array([-2048, -1, 0, 2047]))
        : json(200, meta)(call),
  })
  const { createViewer } = await import('./viewerEngine')
  const viewer = createViewer(document.createElement('div'))
  core.viewport.setProperties.mockImplementationOnce(() => {
    throw new Error('render failure')
  })
  await expect(viewer.show('study', 0, 0)).rejects.toThrow('render failure')
  const id = core.viewport.setStack.mock.calls[0][0][0]
  expect(core.stored.size).toBe(0)
  expect(core.getMetadata(id)).toBeUndefined()
  await viewer.show('study', 0, 0)
  expect(core.stored.size).toBe(1)
  viewer.destroy()
})
