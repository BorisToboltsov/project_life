import Dexie, { type EntityTable } from 'dexie'

import type { Schemas } from '@/api/client'
import type { ErrorKey } from '@/lib/errors'

/** Что меняет изменение — по этому строится строка на экране «Не отправлено». */
export type ChangeKind =
  | 'workout'
  | 'workoutFinish'
  | 'workoutDelete'
  | 'workoutRepeat'
  | 'groupStart'
  | 'workoutExercise'
  | 'workoutExerciseRemove'
  | 'set'
  | 'setRemove'
  | 'rest'
  | 'entry'
  | 'entryRemove'
  | 'water'
  | 'waterRemove'

/** Чего не узнать из самого запроса: к какой тренировке и упражнению он относится. */
export interface ChangeContext {
  kind: ChangeKind
  workoutId?: string
  startedAt?: string
  localDate?: string
  exerciseId?: string
  /** Запись дневника: что, сколько и в какой приём пищи — для строки «Не отправлено». */
  food?: {
    productName: string
    amount: number
    unit: Schemas['ProductUnit']
    portion: Schemas['PortionOut'] | null
    mealId: string
  }
  waterMl?: number
}

/** Изменение для сервера, отложенное до связи (ADR 0020). */
export interface Change {
  seq?: number
  method: 'PUT' | 'POST' | 'DELETE'
  /** Шаблон пути из схемы API: `/api/workouts/{workout_id}`. */
  path: string
  params: Record<string, string>
  body?: unknown
  context: ChangeContext
}

/** Изменение, которое сервер не принял, и почему. */
export interface Rejected extends Change {
  seq: number
  failure: ErrorKey
}

/** Сколько внесли по незнакомому штрихкоду: единица и размер упаковки ещё неизвестны. */
export type DeferredAmount = { packages: number } | { units: number }

/**
 * Запись по штрихкоду, которого нет на телефоне (ADR 0020): ждёт, пока приложение найдёт
 * продукт, а затем — согласия человека. Сервер о ней не знает, поэтому в очередь она не
 * идёт. Ключ становится ключом записи дневника, когда продукт внесут.
 */
export interface Deferred {
  id: string
  barcode: string
  localDate: string
  mealId: string
  amount: DeferredAmount
  /** Ждёт поиска, найден и ждёт согласия или не найден. */
  status: 'waiting' | 'found' | 'missing'
  productId?: string
  /** Чем кончился поиск ненайденного и что о продукте известно. */
  missing?: { status: 'not_found' | 'draft'; draft: Schemas['ProductDraftOut'] | null }
  createdAt: number
}

interface CopyRow {
  key: string
  value: unknown
}

class OfflineDatabase extends Dexie {
  copy!: EntityTable<CopyRow, 'key'>
  queue!: EntityTable<Change, 'seq'>
  rejected!: EntityTable<Rejected, 'seq'>
  deferred!: EntityTable<Deferred, 'id'>

  constructor() {
    super('life-offline')
    this.version(1).stores({ copy: 'key', queue: '++seq', rejected: 'seq' })
    this.version(2).stores({ deferred: 'id' })
  }
}

/** Копия данных и очередь изменений на устройстве: одна база, один пользователь. */
export const db = new OfflineDatabase()

/** Путь изменения с подставленными ключами: по нему изменения одной записи схлопываются. */
export function recordPath(change: Change): string {
  return change.path.replace(/\{(\w+)\}/g, (_, name: string) => change.params[name] ?? '')
}
