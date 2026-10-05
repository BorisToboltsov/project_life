import { describe, expect, it } from 'vitest'

import { uuidv7 } from './uuid'

describe('uuidv7', () => {
  it('имеет вид UUID версии 7 с вариантом RFC', () => {
    expect(uuidv7()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
  })

  it('начинается с времени создания в миллисекундах', () => {
    const id = uuidv7(Date.UTC(2026, 9, 5, 12, 0, 0))

    expect(parseInt(id.replaceAll('-', '').slice(0, 12), 16)).toBe(Date.UTC(2026, 9, 5, 12, 0, 0))
  })

  it('упорядочен по времени и не повторяется', () => {
    const earlier = uuidv7(1_000_000)
    const later = uuidv7(2_000_000)

    expect(earlier < later).toBe(true)
    expect(new Set(Array.from({ length: 200 }, () => uuidv7())).size).toBe(200)
  })
})
