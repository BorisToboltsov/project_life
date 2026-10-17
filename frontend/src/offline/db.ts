import Dexie, { type EntityTable } from 'dexie'

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

/** Чего не узнать из самого запроса: к какой тренировке и упражнению он относится. */
export interface ChangeContext {
  kind: ChangeKind
  workoutId?: string
  startedAt?: string
  localDate?: string
  exerciseId?: string
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

interface CopyRow {
  key: string
  value: unknown
}

class OfflineDatabase extends Dexie {
  copy!: EntityTable<CopyRow, 'key'>
  queue!: EntityTable<Change, 'seq'>
  rejected!: EntityTable<Rejected, 'seq'>

  constructor() {
    super('life-offline')
    this.version(1).stores({ copy: 'key', queue: '++seq', rejected: 'seq' })
  }
}

/** Копия данных и очередь изменений на устройстве: одна база, один пользователь. */
export const db = new OfflineDatabase()

/** Путь изменения с подставленными ключами: по нему изменения одной записи схлопываются. */
export function recordPath(change: Change): string {
  return change.path.replace(/\{(\w+)\}/g, (_, name: string) => change.params[name] ?? '')
}
