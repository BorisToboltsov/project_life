import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

describe('ожидание в тестах', () => {
  // Секунды по умолчанию на загруженной машине не хватает: экран появляется позже.
  it('дожидается того, что появилось позже секунды', async () => {
    const late = document.createElement('output')
    late.dataset.testid = 'late'
    const timer = setTimeout(() => document.body.append(late), 1500)

    try {
      expect(await screen.findByTestId('late')).toBeInTheDocument()
    } finally {
      clearTimeout(timer)
      late.remove()
    }
  })
})
