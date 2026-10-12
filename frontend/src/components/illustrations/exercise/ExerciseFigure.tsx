import '../illustrations.css'

import { type CSSProperties, type ReactNode, useId } from 'react'

import type { Schemas } from '@/api/client'
import { cn } from '@/lib/utils'

import { DRAWINGS } from './drawings'
import type { Figure, Joint, Layer, Shape } from './rig'

type ExercisePreset = Schemas['ExercisePreset']

/** Проход по фигуре: контур, заливка или снаряд. */
type Pass = 'outline' | 'fill' | 'gear'

function draw(shape: Shape, key: number, pass: Pass, mask: string): ReactNode {
  const props = {
    key,
    ...(shape.shift && { transform: `translate(${shape.shift[0]} ${shape.shift[1]})` }),
    ...(pass === 'gear' && { className: `ex-${shape.gear}` }),
    ...(pass === 'outline' && shape.fade && { mask: `url(#${mask})` }),
  }
  if (shape.d) return <path {...props} d={shape.d} />
  if (shape.ellipse) {
    const [cx, cy, rx, ry] = shape.ellipse
    return <ellipse {...props} cx={cx} cy={cy} rx={rx} ry={ry} />
  }
  const [cx, cy, r] = shape.circle ?? [0, 0, 0]
  return <circle {...props} cx={cx} cy={cy} r={r} />
}

/** Что из части рисуется в этом проходе: снаряд — только своим проходом, тело — двумя. */
function drawn(shape: Shape, layer: Layer, pass: Pass): boolean {
  return shape.layer === layer && (pass === 'gear') === Boolean(shape.gear)
}

function shapes(list: Shape[], layer: Layer, pass: Pass, mask: string): ReactNode[] {
  return list
    .filter((shape) => drawn(shape, layer, pass))
    .map((shape, i) => draw(shape, i, pass, mask))
}

function limb(joint: Joint, key: number, layer: Layer, pass: Pass, mask: string): ReactNode {
  const own = shapes(joint.shapes, layer, pass, mask)
  const kids = joint.kids.map((kid, i) => limb(kid, i, layer, pass, mask)).filter(Boolean)
  if (own.length === 0 && kids.length === 0) return null
  const [from, to] = joint.turn
  // Неподвижный сустав обходится без анимации.
  const turning =
    from === to
      ? { transform: `rotate(${to})` }
      : {
          className: 'ex-j',
          style: {
            '--a': `${from}deg`,
            '--b': `${to}deg`,
            animationDelay: `${joint.delay ?? 0}ms`,
          } as CSSProperties,
        }
  const place = `translate(${joint.at[0]} ${joint.at[1]})${joint.flip ? ' scale(-1 1)' : ''}`
  const body = (
    <g {...turning}>
      {own}
      {kids}
    </g>
  )
  if (!joint.move) {
    return (
      <g key={key} transform={place}>
        {body}
      </g>
    )
  }
  const [[xa, ya], [xb, yb]] = joint.move
  return (
    <g
      key={key}
      className="ex-m"
      style={
        {
          '--xa': `${xa}px`,
          '--ya': `${ya}px`,
          '--xb': `${xb}px`,
          '--yb': `${yb}px`,
        } as CSSProperties
      }
    >
      {body}
    </g>
  )
}

/**
 * Рисунок техники: слитный силуэт человека, который переходит из одной позы в другую.
 * `still` — неподвижный кадр в конечной позе, для миниатюры в списке.
 */
export function FigureDrawing({ figure, still }: { figure: Figure; still?: boolean }) {
  // Идентификатор маски — без двоеточий: они не годятся в ссылке `url(#…)`.
  const mask = `ex-fade-${useId().replaceAll(':', '')}`
  const tree = (layer: Layer, pass: Pass) => limb(figure.root, 0, layer, pass, mask)
  const world = (layer: Layer) => shapes(figure.world, layer, 'gear', mask)
  // Порядок слоёв: обстановка и снаряд за телом, тело, рука поверх корпуса, снаряд спереди.
  const behind = { world: world(0), gear: tree(0, 'gear') }
  const body = { outline: tree(1, 'outline'), fill: tree(1, 'fill') }
  const arm = { outline: tree(2, 'outline'), fill: tree(2, 'fill') }
  const front = { gear: tree(3, 'gear'), world: world(3) }
  return (
    // Рисунок поясняет соседний текст и сам по себе ничего не сообщает скринридеру.
    <svg
      viewBox={figure.viewBox}
      className={cn('illus ex', still && 'ex-still')}
      aria-hidden="true"
    >
      <defs>
        <linearGradient
          id={`${mask}-ramp`}
          gradientUnits="userSpaceOnUse"
          x1={0}
          y1={0}
          x2={0}
          y2={-figure.upperArm}
        >
          <stop offset={0.12} stopColor="#000" />
          <stop offset={0.62} stopColor="#fff" />
        </linearGradient>
        <mask id={mask} maskUnits="userSpaceOnUse" x={-12} y={-40} width={24} height={52}>
          <rect x={-12} y={-40} width={24} height={52} fill={`url(#${mask}-ramp)`} />
        </mask>
      </defs>
      {behind.world}
      {behind.gear}
      <g className="ex-outline">{body.outline}</g>
      <g className="ex-fill">{body.fill}</g>
      <g className="ex-outline ex-inner">{arm.outline}</g>
      <g className="ex-fill">{arm.fill}</g>
      {front.gear}
      {front.world}
    </svg>
  )
}

/** Общий рисунок: гантель. У своего упражнения и у штатного, которое ещё не нарисовано. */
function Dumbbell() {
  return (
    <svg viewBox="0 0 120 120" className="illus ex" aria-hidden="true">
      <g transform="rotate(-25 60 60)">
        <line className="ex-handle" x1={38} y1={60} x2={82} y2={60} />
        <rect className="illus-body" x={26} y={39} width={12} height={42} rx={4} />
        <rect className="illus-body" x={82} y={39} width={12} height={42} rx={4} />
        <rect className="illus-body" x={15} y={46} width={11} height={28} rx={4} />
        <rect className="illus-body" x={94} y={46} width={11} height={28} rx={4} />
      </g>
    </svg>
  )
}

/**
 * Рисунок упражнения: техника штатного либо общий рисунок — у своего упражнения
 * (`preset` пуст) и у штатного без собственного.
 */
export function ExerciseFigure({
  preset,
  still,
}: {
  preset: ExercisePreset | null
  still?: boolean
}) {
  const figure = preset ? DRAWINGS[preset] : undefined
  return figure ? <FigureDrawing figure={figure} still={still} /> : <Dumbbell />
}
