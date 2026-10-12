import './illustrations.css'

import { useId } from 'react'

import { Frame } from './MeasureIllustration'

/** Контур стакана: шире у края, дно скруглено. */
const GLASS = 'M20 10H100L91 104Q90.5 110 85 110H35Q29.5 110 29 104Z'
/** Деления на четверти цели — у правой стенки. */
const MARKS = 'M80.5 89.25h8M82.5 65.5h8M85 41.75h8'
/** Поверхность воды: волна длиной 60 единиц, шире стакана на сдвиг анимации. */
const WAVE = 'M-60 0q15-5 30 0t30 0 30 0 30 0 30 0 30 0 30 0 30 0V130H-60z'
/** Где стоит поверхность воды в пустом и в полном стакане. */
const EMPTY_Y = 113
const FULL_Y = 18

/**
 * Стакан, который заполняется по мере выпитого: `level` — доля цели от 0 до 1. Без цели
 * (`level` не задан) стакан пуст и без делений: заполнять его не до чего.
 */
export function WaterGlass({
  label,
  level,
  done = false,
}: {
  /** Что показывает стакан — для скринридера. */
  label: string
  level?: number
  /** Цель выполнена: на краю стакана появляется отметка. */
  done?: boolean
}) {
  const clip = useId()
  // До десятой единицы рамки: мельче глаз не видит, а в разметке нет хвостов дроби.
  const surface = Math.round((EMPTY_Y - (level ?? 0) * (EMPTY_Y - FULL_Y)) * 10) / 10
  const glass = (
    <Frame>
      <clipPath id={clip}>
        <path d={GLASS} />
      </clipPath>
      <path className="illus-body" d={GLASS} />
      {level !== undefined && (
        <>
          <path className="illus-line" d={MARKS} />
          <g clipPath={`url(#${clip})`}>
            <g className="illus-level" style={{ transform: `translateY(${surface}px)` }}>
              <path className="illus-water" d={WAVE} />
            </g>
          </g>
          {/* Контур поверх воды: стенки стакана остаются видны. */}
          <path className="illus-line" d={GLASS} />
        </>
      )}
      {done && (
        <>
          <circle className="illus-done" cx={101} cy={16} r={11} />
          <path className="illus-check" d="M96 16l4 4 7-8" />
        </>
      )}
    </Frame>
  )
  if (level === undefined) return glass
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(level * 100)}
    >
      {glass}
    </div>
  )
}
