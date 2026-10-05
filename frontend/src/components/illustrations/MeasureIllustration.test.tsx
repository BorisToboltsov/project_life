import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { METRICS } from '@/api/measurements'

import { MeasureIllustration } from './MeasureIllustration'

describe('подсказки «как измерять»', () => {
  it.each(METRICS)(
    '%s: рисунок есть и скрыт от скринридера — его поясняет текст рядом',
    (metric) => {
      const { container } = render(<MeasureIllustration metric={metric} />)

      const svg = container.querySelector('svg.illus')
      expect(svg).toHaveAttribute('aria-hidden', 'true')
      expect(svg).toHaveAttribute('viewBox', '0 0 120 120')
    },
  )

  it.each(['neck', 'waist', 'hips'] as const)('%s: показана лента с делениями', (metric) => {
    const { container } = render(<MeasureIllustration metric={metric} />)

    expect(container.querySelectorAll('.illus-tape, .illus-ticks, .illus-tab')).toHaveLength(3)
  })

  it('вес: две ступни встают на весы со стрелкой', () => {
    const { container } = render(<MeasureIllustration metric="weight" />)

    expect(container.querySelectorAll('.illus-foot')).toHaveLength(2)
    expect(container.querySelector('.illus-needle')).not.toBeNull()
  })
})
