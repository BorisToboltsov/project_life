import '../illustrations.css'

import type { Schemas } from '@/api/client'

import { FRONT_BODY } from './rig'

type Muscle = Schemas['Muscle']

const DELTS =
  'M40.2 22.8C43.5 22.4 45.4 24.8 45.6 28C45.7 29.5 45.5 31 45.2 32C43.5 31 41.5 29.5 40.6 27Z'
const UPPER_ARM =
  'M41 32.5C43 33.5 45.5 33.5 45.9 33C46.4 36 46.6 39.5 46.8 42C45 43 42.8 42.5 42 41.5C41.6 38.5 41.2 35.5 41 32.5Z'
const FOREARM =
  'M42.6 45C44.5 45.8 46.6 45.6 47.6 45C48.4 49.5 49.2 54 49.5 58.5C48.4 59.2 46.6 59.2 45.4 58.6C44.6 54 43.4 49.5 42.6 45Z'

/** Область на силуэте: мышца, которую она показывает, или `null` — просто рельеф. */
type Region = readonly [muscle: Muscle | null, d: string]

// Правая половина тела; левая — зеркалом.
const FRONT: Region[] = [
  [
    'chest',
    'M30.6 24.5C34 23.5 38.5 24 40 26.5C40.6 29.5 39 32.5 36 33.5C33.5 34 31.2 33 30.6 32Z',
  ],
  ['delts', DELTS],
  ['biceps', UPPER_ARM],
  ['forearms', FOREARM],
  ['abs', 'M30 35C32.4 35 34 35.4 34.4 36.4C34.6 41 34.2 46 33.6 50C32.9 53.5 31.6 56 30 57Z'],
  [
    'obliques',
    'M35.6 36.6C37.2 37 38.6 38 39 39.4C38.6 43 37.2 45.6 36.9 48.6C36.8 50.4 37.3 52 38 53.6C36.9 54.4 35.6 54.4 34.9 53.4C35.4 48 35.7 42 35.6 36.6Z',
  ],
  [
    'quads',
    'M31.2 63C33 61 36.5 60 38.6 60.5C39.3 66 39 73 38 79C37.4 82.5 35 84 33.4 82.5C32.4 77 31.6 69 31.2 63Z',
  ],
  [
    null,
    'M33.2 89.5C34.5 88.8 36.4 89 37.4 89.8C37.8 93 38 96 37.6 99C37.2 102.5 36.4 105 36 107.5C35 108 33.6 107.8 33 107.2C32.8 103 32.6 99 32.8 96C32.9 93.5 33.1 91.5 33.2 89.5Z',
  ],
]

const BACK: Region[] = [
  ['traps', 'M30 19.5L33.2 20C35.5 20.6 38 21 39.6 21.6C37 23.6 33.6 25.6 30 31Z'],
  ['delts', DELTS],
  ['triceps', UPPER_ARM],
  ['forearms', FOREARM],
  ['lats', 'M31 30.5C34 27.5 38 26.8 40.4 28C40.6 32 39.4 37 38.6 41.5C37.6 45.5 35 48.5 31 50Z'],
  ['lower_back', 'M30 44C32 44 33.6 46 33.8 49C34 52 33.4 55 30 56.5Z'],
  [
    'glutes',
    'M30.4 57C33 55.5 37 56 38.8 58C39.6 62 38.6 66 36 67.6C33.6 68.4 31.2 67.4 30.5 65.5Z',
  ],
  [
    'hamstrings',
    'M31.4 69.5C33.5 70.5 36.6 70 38.6 68.6C38.9 72.5 38.6 76.5 38 80C37.4 83 35 84.2 33.4 82.8C32.6 78.5 31.8 74 31.4 69.5Z',
  ],
  [
    'calves',
    'M32.8 88.5C34.4 87.6 37 88 38 89.2C38.5 93 38.3 97 37.4 100.5C36 102 34 102 32.8 100.8C32.4 96.5 32.5 92.5 32.8 88.5Z',
  ],
]

const MIRROR = `translate(${2 * FRONT_BODY.axis} 0) scale(-1 1)`

function Silhouette() {
  const [cx, cy, rx, ry] = FRONT_BODY.head
  const half = (
    <>
      <path d={FRONT_BODY.half} />
      {/* Рука чуть отведена от корпуса: иначе контуры сливаются в толстую полосу. */}
      <path d={FRONT_BODY.arm} transform="translate(1.2 0)" />
    </>
  )
  return (
    <>
      {half}
      <g transform={MIRROR}>{half}</g>
      <ellipse cx={cx} cy={cy} rx={rx} ry={ry} />
      <path d={FRONT_BODY.neck} />
    </>
  )
}

function Side({ regions, main, help }: { regions: Region[]; main: Muscle[]; help: Muscle[] }) {
  const marks = regions.map(([muscle, d]) => {
    const role =
      muscle && main.includes(muscle) ? 'main' : muscle && help.includes(muscle) ? 'help' : 'rest'
    return <path key={d} className={`mm-${role}`} d={d} />
  })
  return (
    <>
      <g className="mm-outline">
        <Silhouette />
      </g>
      <g className="ex-fill">
        <Silhouette />
      </g>
      {marks}
      <g transform={MIRROR}>{marks}</g>
    </>
  )
}

/**
 * Карта мышц: силуэт спереди и сзади. Мышцы, которые делают основную работу, залиты
 * цветом бренда, помогающие — светлее.
 */
export function MuscleMap({ main, help = [] }: { main: Muscle[]; help?: Muscle[] }) {
  return (
    // Те же мышцы перечислены текстом рядом: рисунок их только показывает.
    <svg viewBox="0 0 120 120" className="illus" aria-hidden="true">
      <Side regions={FRONT} main={main} help={help} />
      <g transform={`translate(${2 * FRONT_BODY.axis} 0)`}>
        <Side regions={BACK} main={main} help={help} />
      </g>
    </svg>
  )
}
