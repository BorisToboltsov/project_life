import './illustrations.css'

import type { ComponentProps, ReactNode } from 'react'

import type { Schemas } from '@/api/client'

type Metric = Schemas['Metric']

function Frame({ children, ...props }: ComponentProps<'svg'>) {
  // Рисунок поясняет соседний текст и сам по себе ничего не сообщает скринридеру.
  return (
    <svg viewBox="0 0 120 120" className="illus" aria-hidden="true" {...props}>
      {children}
    </svg>
  )
}

/** Лента вокруг тела: видимая спереди дуга и свободный конец. */
function Tape({ d, tab }: { d: string; tab: { x: number; y: number } }) {
  return (
    <>
      <path className="illus-tape" pathLength={1} d={d} />
      <path className="illus-ticks" pathLength={1} d={d} />
      <rect className="illus-tab" x={tab.x} y={tab.y} width={9} height={13} rx={2} />
    </>
  )
}

/** Вес: вид сверху — ступни по очереди встают на весы, стрелка качается и замирает. */
function Weight() {
  return (
    <Frame>
      <g className="illus-scale">
        <rect className="illus-body" x={12} y={12} width={96} height={98} rx={16} />
        <circle className="illus-paper" cx={60} cy={33} r={13} />
        <path className="illus-line" d="M51 27.5l2 2M60 23.5v3M69 27.5l-2 2" strokeWidth={1.8} />
      </g>
      <line className="illus-needle" x1={60} y1={33} x2={60} y2={23.5} />
      <circle cx={60} cy={33} r={2} fill="var(--illus-accent)" />
      <path
        className="illus-foot"
        d="M42 54c8 0 11 8 10 19-1 9-1 16-2 21-1 6-4 9-8 9s-7-3-8-9c-1-5-2-12-3-21-1-11 3-19 11-19z"
      />
      <path
        className="illus-foot illus-foot-second"
        d="M78 54c-8 0-11 8-10 19 1 9 1 16 2 21 1 6 4 9 8 9s7-3 8-9c1-5 2-12 3-21 1-11-3-19-11-19z"
      />
    </Frame>
  )
}

/** Шея: лента горизонтально под кадыком. */
function Neck() {
  return (
    <Frame>
      <path
        className="illus-body"
        d="M4 120C4 100 12 92 34 86c8-2 12-6 12-13V46h28v27c0 7 4 11 12 13 22 6 30 14 30 34z"
      />
      <ellipse className="illus-body" cx={60} cy={28} rx={23} ry={26} />
      <Tape d="M45 66q15 9 30 0" tab={{ x: 72, y: 60 }} />
    </Frame>
  )
}

/** Талия: лента на уровне пупка. */
function Waist() {
  return (
    <Frame>
      <path
        className="illus-body"
        d="M26 2c-2 18 6 34 10 50 3 12-10 26-10 46v22h68V98c0-20-13-34-10-46 4-16 12-32 10-50z"
      />
      <path className="illus-line" d="M60 62v3.5" />
      <Tape d="M33 60q27 14 54 0" tab={{ x: 83, y: 53 }} />
    </Frame>
  )
}

/** Бёдра: вид сзади, ноги вместе, лента чуть ниже ягодиц. */
function Hips() {
  return (
    <Frame>
      <path
        className="illus-body"
        d="M36 0c-8 14-14 28-14 46 0 24 8 46 14 74h48c6-28 14-50 14-74 0-18-6-32-14-46z"
      />
      <path className="illus-line" d="M60 24v96" />
      <path className="illus-line" d="M27 60q16 12 33 3M93 60q-16 12-33 3" strokeWidth={2} />
      <Tape d="M23 72q37 16 74 0" tab={{ x: 93, y: 65 }} />
    </Frame>
  )
}

const ILLUSTRATIONS: Record<Metric, () => ReactNode> = {
  weight: Weight,
  neck: Neck,
  waist: Waist,
  hips: Hips,
}

/** Анимированная подсказка, как измерять показатель. */
export function MeasureIllustration({ metric }: { metric: Metric }) {
  const Illustration = ILLUSTRATIONS[metric]
  return <Illustration />
}
