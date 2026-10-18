import { describe, expect, it, vi } from 'vitest'

import { startSync } from './sync'

describe('остановленная отправка', () => {
  it('обновление копии, начатое до остановки, дальше ничего не запрашивает', async () => {
    let release!: () => void
    const held = new Promise<void>((resolve) => (release = resolve))
    const asked: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        asked.push(new URL(request.url).pathname)
        await held
        return new Response(null, { status: 404 })
      }),
    )

    const stop = startSync(() => {})
    await vi.waitFor(() => expect(asked).toContain('/api/workouts/recent'))
    // Выход посреди обновления: ответы на начатые запросы приходят уже после остановки.
    stop()
    release()
    for (let tick = 0; tick < 10; tick++) await new Promise((resolve) => setTimeout(resolve, 0))

    expect(asked).not.toContain('/api/products/catalog')
    expect(asked).not.toContain('/api/measurements/all')
  })
})
