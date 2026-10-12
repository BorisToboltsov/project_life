import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { WaterGlass } from './WaterGlass'

/** На какой высоте рамки стоит поверхность воды. */
function surface(container: HTMLElement): string | undefined {
  return container.querySelector<SVGGElement>('.illus-level')?.style.transform
}

describe('стакан воды', () => {
  it('рисунок той же рамки, что подсказки замеров, и скрыт от скринридера', () => {
    const { container } = render(<WaterGlass label="Выпито из цели" level={0.5} />)

    const svg = container.querySelector('svg.illus')
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg).toHaveAttribute('viewBox', '0 0 120 120')
  })

  it.each([
    [0, 'translateY(113px)', '0'],
    [0.5, 'translateY(65.5px)', '50'],
    [0.45, 'translateY(70.3px)', '45'],
    [1, 'translateY(18px)', '100'],
  ])('доля цели %s: вода стоит на своём уровне', (level, transform, percent) => {
    const { container } = render(<WaterGlass label="Выпито из цели" level={level} />)

    expect(surface(container)).toBe(transform)
    expect(screen.getByRole('progressbar', { name: 'Выпито из цели' })).toHaveAttribute(
      'aria-valuenow',
      percent,
    )
    expect(container.querySelector('.illus-water')).not.toBeNull()
  })

  it('вода не выходит за стенки: она обрезана контуром стакана', () => {
    const { container } = render(<WaterGlass label="Выпито из цели" level={0.5} />)

    const clip = container.querySelector('clipPath')!
    const clipped = container.querySelector('.illus-level')!.parentElement!
    expect(clipped).toHaveAttribute('clip-path', `url(#${clip.id})`)
  })

  it('без цели стакан пуст: ни воды, ни делений, ни шкалы', () => {
    const { container } = render(<WaterGlass label="Выпито из цели" />)

    expect(container.querySelector('svg.illus')).not.toBeNull()
    expect(container.querySelector('.illus-water')).toBeNull()
    expect(container.querySelectorAll('.illus-line')).toHaveLength(0)
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('выполненная цель отмечена на краю стакана', () => {
    const { container, rerender } = render(<WaterGlass label="Выпито из цели" level={0.9} />)
    expect(container.querySelector('.illus-done')).toBeNull()

    rerender(<WaterGlass label="Выпито из цели" level={1} done />)

    expect(container.querySelectorAll('.illus-done, .illus-check')).toHaveLength(2)
  })

  it('два стакана на странице не делят один контур обрезки', () => {
    const { container } = render(
      <>
        <WaterGlass label="Выпито из цели" level={0.2} />
        <WaterGlass label="Выпито из цели" level={0.8} />
      </>,
    )

    const ids = [...container.querySelectorAll('clipPath')].map((clip) => clip.id)
    expect(new Set(ids).size).toBe(2)
  })
})
