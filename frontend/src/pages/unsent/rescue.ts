import {
  addWorkoutExercise,
  saveWorkout,
  saveWorkoutSet,
  type WorkoutSetInput,
} from '@/api/workouts'
import { today } from '@/lib/dates'
import type { ErrorKey } from '@/lib/errors'
import { uuidv7 } from '@/lib/uuid'
import type { Rejected } from '@/offline/db'
import { forget } from '@/offline/queue'

/** Последнее значение каждого отклонённого подхода: правки одного подхода — одна запись. */
export function rejectedSets(changes: readonly Rejected[]): Rejected[] {
  const latest = new Map<string, Rejected>()
  for (const change of changes) {
    if (change.context.kind === 'set' && change.method === 'PUT' && change.context.exerciseId)
      latest.set(change.params.set_id!, change)
  }
  return [...latest.values()]
}

/**
 * Переносит отклонённые подходы в новую тренировку — с тем же временем начала, по одной
 * строке на упражнение (ADR 0020). Без сети перенос тоже встаёт в очередь.
 */
export async function moveToNewWorkout(
  changes: readonly Rejected[],
): Promise<{ id: string } | { failure: ErrorKey }> {
  const sets = rejectedSets(changes)
  const context = changes[0]?.context
  const id = uuidv7()
  const started = await saveWorkout(id, {
    started_at: context?.startedAt ?? new Date().toISOString(),
    local_date: context?.localDate ?? today(),
  })
  if (started.failure) return { failure: started.failure }
  const items = new Map<string, string>()
  for (const change of sets) {
    const exerciseId = change.context.exerciseId!
    let itemId = items.get(exerciseId)
    if (!itemId) {
      itemId = uuidv7()
      const added = await addWorkoutExercise(id, itemId, exerciseId)
      if (added.failure) return { failure: added.failure }
      items.set(exerciseId, itemId)
    }
    const saved = await saveWorkoutSet(id, itemId, uuidv7(), change.body as WorkoutSetInput)
    if (saved.failure) return { failure: saved.failure }
  }
  await forget(changes.map((change) => change.seq))
  return { id }
}
