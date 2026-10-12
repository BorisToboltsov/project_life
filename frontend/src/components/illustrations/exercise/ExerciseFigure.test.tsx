import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ru } from '@/i18n/ru'

import { DRAWINGS } from './drawings'
import { ExerciseFigure } from './ExerciseFigure'
import { MuscleMap } from './MuscleMap'

const drawn = Object.keys(DRAWINGS) as (keyof typeof DRAWINGS)[]

describe('рисунок упражнения', () => {
  it.each(drawn)('%s: силуэт собран из двух проходов и скрыт от скринридера', (preset) => {
    const { container } = render(<ExerciseFigure preset={preset} />)

    const svg = container.querySelector('svg.illus.ex')
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    // Контур и заливка рисуют одни и те же части: иначе внутри силуэта остались бы линии.
    const parts = (pass: string) =>
      [...container.querySelectorAll(pass)].reduce(
        (total, group) => total + group.querySelectorAll('path, circle, ellipse').length,
        0,
      )
    expect(parts('.ex-outline')).toBeGreaterThan(5)
    expect(parts('.ex-fill')).toBe(parts('.ex-outline'))
  })

  it('движение — это углы двух поз в переменных сустава', () => {
    const { container } = render(<ExerciseFigure preset="barbell_squat" />)

    const joint = container.querySelector<SVGGElement>('.ex-j')!
    expect(joint.style.getPropertyValue('--a')).toMatch(/deg$/)
    expect(joint.style.getPropertyValue('--b')).toMatch(/deg$/)
    expect(joint.style.getPropertyValue('--a')).not.toBe(joint.style.getPropertyValue('--b'))
  })

  it('неподвижная поза обходится без анимации', () => {
    const { container } = render(<ExerciseFigure preset="plank" />)

    expect(container.querySelectorAll('.ex-j')).toHaveLength(0)
  })

  it('миниатюра стоит на месте', () => {
    const { container } = render(<ExerciseFigure preset="deadlift" still />)

    expect(container.querySelector('svg')).toHaveClass('ex-still')
  })

  it('линии руки у плеча проявляются по маске, своей у каждого рисунка', () => {
    const { container } = render(
      <>
        <ExerciseFigure preset="barbell_squat" />
        <ExerciseFigure preset="deadlift" />
      </>,
    )

    const masks = [...container.querySelectorAll('mask')].map((mask) => mask.id)
    expect(new Set(masks).size).toBe(2)
    for (const id of masks) {
      expect(id).not.toContain(':')
      expect(container.querySelector(`[mask="url(#${id})"]`)).not.toBeNull()
    }
  })

  it('подтягивания: тело и руки идут по шагам пути со своими ключевыми кадрами', () => {
    const { container } = render(<ExerciseFigure preset="pull_up" />)

    const stepped = [...container.querySelectorAll<SVGGElement>('.ex-t')]
    const names = new Set(stepped.map((joint) => joint.style.animationName))
    const css = container.querySelector('style')!.textContent
    // Корень фигуры, плечо и предплечье; зеркальная рука берёт те же кадры по своему имени.
    expect(names.size).toBe(5)
    for (const name of names) expect(css).toContain(`@keyframes ${name}{`)
    expect(css).toContain('40%{transform:')
    expect(css).toContain('49%{transform:')
    // Без анимации виден кадр в верхней точке.
    expect(stepped.every((joint) => joint.style.transform !== '')).toBe(true)
  })

  it('миниатюре подтягиваний свои ключевые кадры не нужны', () => {
    const { container } = render(<ExerciseFigure preset="pull_up" still />)

    expect(container.querySelector('style')).toBeNull()
  })

  it('обычный рисунок обходится общими ключевыми кадрами', () => {
    const { container } = render(<ExerciseFigure preset="deadlift" />)

    expect(container.querySelector('style')).toBeNull()
    expect(container.querySelectorAll('.ex-t')).toHaveLength(0)
  })

  it('снаряд — цветом бренда, обстановка — контуром', () => {
    const { container } = render(<ExerciseFigure preset="dumbbell_bench_press" />)

    expect(container.querySelector('.ex-plate')).not.toBeNull()
    expect(container.querySelector('.ex-pad')).not.toBeNull()
    expect(container.querySelectorAll('.ex-steel').length).toBeGreaterThan(1)
  })

  it('вид спереди: вторая рука и половина тела — зеркалом', () => {
    const { container } = render(<ExerciseFigure preset="lateral_raise" />)

    // В слое тела зеркалом стоят половина корпуса и рука.
    const body = container.querySelector('.ex-fill')!
    expect(body.querySelectorAll('g[transform*="scale(-1 1)"]')).toHaveLength(2)
    expect(container.querySelectorAll('.ex-plate')).toHaveLength(2)
  })

  it('у своего упражнения — общий рисунок, гантель', () => {
    const { container } = render(<ExerciseFigure preset={null} />)

    expect(container.querySelector('.ex-handle')).not.toBeNull()
    expect(container.querySelector('.ex-outline')).toBeNull()
  })

  it('рисунок есть у каждого штатного упражнения из словаря', () => {
    expect(drawn.toSorted()).toEqual(Object.keys(ru.exerciseNames).toSorted())
    expect(drawn).toHaveLength(40)
  })

  it('дальняя нога рисуется своим силуэтом за телом', () => {
    const { container } = render(<ExerciseFigure preset="treadmill_walk" />)

    // Два силуэта: дальняя нога и тело; у руки поверх корпуса — третий.
    expect(container.querySelectorAll('.ex-outline')).toHaveLength(3)
    expect(container.querySelectorAll('.ex-fill')).toHaveLength(3)
  })

  it('трос тянется от блока к кисти и идёт по тем же шагам, что и рука', () => {
    const { container } = render(<ExerciseFigure preset="rope_pushdown" />)

    const cable = container.querySelector<SVGPathElement>('.ex-cable')!
    const css = container.querySelector('style')!.textContent
    expect(cable.style.strokeDasharray).toMatch(/^[\d.]+ 400$/)
    expect(css).toContain(`@keyframes ${cable.style.animationName}{`)
    expect(css).toContain('stroke-dasharray:')
    // Суставы такого рисунка идут по шагам: общих ключевых кадров со сдвигами у него нет.
    expect(container.querySelectorAll('.ex-j')).toHaveLength(0)
    expect(container.querySelectorAll('.ex-t').length).toBeGreaterThan(2)
  })

  it('неподвижному кадру с тросом хватает его длины в конечной позе', () => {
    const { container } = render(<ExerciseFigure preset="lat_pulldown" still />)

    expect(container.querySelector('style')).toBeNull()
    expect(container.querySelector<SVGPathElement>('.ex-cable')!.style.strokeDasharray).not.toBe('')
  })
})

describe('карта мышц', () => {
  it('основные мышцы залиты, помогающие — светлее, остальные едва намечены', () => {
    const { container } = render(<MuscleMap main={['quads', 'glutes']} help={['abs']} />)

    // Каждая область нарисована на обеих половинах тела.
    expect(container.querySelectorAll('.mm-main')).toHaveLength(4)
    expect(container.querySelectorAll('.mm-help')).toHaveLength(2)
    expect(container.querySelectorAll('.mm-rest').length).toBeGreaterThan(20)
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })

  it('дельты и предплечья видны и спереди, и сзади', () => {
    const { container } = render(<MuscleMap main={['delts']} help={['forearms']} />)

    expect(container.querySelectorAll('.mm-main')).toHaveLength(4)
    expect(container.querySelectorAll('.mm-help')).toHaveLength(4)
  })

  it('без мышц на карте только рельеф', () => {
    const { container } = render(<MuscleMap main={[]} />)

    expect(container.querySelectorAll('.mm-main, .mm-help')).toHaveLength(0)
  })
})
