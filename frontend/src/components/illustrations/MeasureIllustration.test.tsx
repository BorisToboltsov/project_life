import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { MeasureIllustration } from './MeasureIllustration'

describe('подсказки «как измерять»', () => {
  it.each(['weight', 'neck', 'waist', 'hips', 'biceps', 'body_fat', null] as const)(
    '%s: рисунок есть и скрыт от скринридера — его поясняет текст рядом',
    (preset) => {
      const { container } = render(<MeasureIllustration preset={preset} />)

      const svg = container.querySelector('svg.illus')
      expect(svg).toHaveAttribute('aria-hidden', 'true')
      expect(svg).toHaveAttribute('viewBox', '0 0 120 120')
    },
  )

  it.each(['neck', 'waist', 'hips'] as const)('%s: показана лента с делениями', (preset) => {
    const { container } = render(<MeasureIllustration preset={preset} />)

    expect(container.querySelectorAll('.illus-tape, .illus-ticks, .illus-tab')).toHaveLength(3)
  })

  it('вес: две ступни встают на весы со стрелкой', () => {
    const { container } = render(<MeasureIllustration preset="weight" />)

    expect(container.querySelectorAll('.illus-foot')).toHaveLength(2)
    expect(container.querySelector('.illus-needle')).not.toBeNull()
  })

  it.each(['chest', 'biceps', 'body_fat', null] as const)(
    '%s: своего рисунка нет — рулетка с разматывающейся лентой',
    (preset) => {
      const { container } = render(<MeasureIllustration preset={preset} />)
      const own = render(<MeasureIllustration preset={null} />)

      expect(container.querySelectorAll('circle')).toHaveLength(3)
      expect(container.querySelectorAll('.illus-tape, .illus-ticks, .illus-tab')).toHaveLength(3)
      expect(container.innerHTML).toBe(own.container.innerHTML)
    },
  )
})
