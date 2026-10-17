import type { Schemas } from '@/api/client'

import { copy } from './copy'

type Detail = Schemas['WorkoutDetailOut']
type Summary = Schemas['WorkoutOut']
type Item = Schemas['WorkoutExerciseOut']
type SetOut = Schemas['WorkoutSetOut']
type SetIn = Schemas['WorkoutSetIn']
type Latest = Schemas['ExerciseLatestOut']
type Groups = Schemas['WorkoutGroupListOut']

/** Ключи копии журнала тренировок (ADR 0020). */
export const WORKOUT_COPY = {
  list: 'workouts',
  exercises: 'exercises',
  groups: 'groups',
  latest: 'latest',
  detailPrefix: 'workout:',
  detail: (id: string) => `workout:${id}`,
} as const

const KG_PER_LB = 0.45359237
const KM_PER_MI = 1.609344

const byStartDesc = (a: Summary, b: Summary) =>
  Date.parse(b.started_at) - Date.parse(a.started_at) || b.id.localeCompare(a.id)

function summaryOf({ exercises, ...workout }: Detail): Summary {
  return {
    ...workout,
    exercise_count: exercises.length,
    set_count: exercises.reduce((count, item) => count + item.sets.length, 0),
  }
}

/** Сохраняет тренировку в копию вместе с её строкой в истории. */
async function store(detail: Detail): Promise<void> {
  const next = { ...detail, ...summaryOf(detail) }
  await copy.put(WORKOUT_COPY.detail(detail.id), next)
  await copy.update<Schemas['WorkoutListOut']>(WORKOUT_COPY.list, (list) => ({
    workouts: [
      ...(list?.workouts ?? []).filter((row) => row.id !== detail.id),
      summaryOf(next),
    ].sort(byStartDesc),
  }))
}

async function change(id: string, edit: (detail: Detail) => Detail): Promise<void> {
  const detail = await copy.get<Detail>(WORKOUT_COPY.detail(id))
  if (detail) await store(edit(structuredClone(detail)))
}

function editItem(itemId: string, edit: (item: Item) => Item) {
  return (detail: Detail): Detail => ({
    ...detail,
    exercises: detail.exercises.map((item) => (item.id === itemId ? edit(item) : item)),
  })
}

async function exerciseOf(exerciseId: string) {
  const list = await copy.get<Schemas['ExerciseListOut']>(WORKOUT_COPY.exercises)
  const exercise = list?.exercises.find((value) => value.id === exerciseId)
  if (!exercise) throw new Error('exercise is not in the copy')
  return exercise
}

/**
 * «В прошлый раз» для упражнения новой строки — как у сервера: подходы последней
 * завершённой тренировки до этой. Ищутся в тренировках копии и в последних подходах,
 * которые сервер отдал вместе с ней.
 */
async function previousSets(exerciseId: string, workout: Summary): Promise<SetOut[]> {
  const start = Date.parse(workout.started_at)
  let best: { at: number; sets: SetOut[] } | undefined
  const consider = (startedAt: string, sets: SetOut[]) => {
    const at = Date.parse(startedAt)
    if (sets.length > 0 && at < start && (!best || at > best.at)) best = { at, sets }
  }
  for (const detail of await copy.list<Detail>(WORKOUT_COPY.detailPrefix)) {
    if (detail.id === workout.id || detail.finished_at === null) continue
    const item = detail.exercises.find((value) => value.exercise.id === exerciseId)
    if (item) consider(detail.started_at, item.sets)
  }
  for (const row of (await copy.get<Latest[]>(WORKOUT_COPY.latest)) ?? []) {
    if (row.exercise_id === exerciseId && row.workout_id !== workout.id)
      consider(row.started_at, row.sets)
  }
  return best?.sets ?? []
}

async function itemsFor(
  workout: Summary,
  rows: { id: string; exerciseId: string }[],
): Promise<Item[]> {
  return Promise.all(
    rows.map(async (row, position) => ({
      id: row.id,
      exercise: await exerciseOf(row.exerciseId),
      position,
      sets: [],
      previous: await previousSets(row.exerciseId, workout),
    })),
  )
}

function fresh(id: string, body: Schemas['WorkoutIn']): Detail {
  return {
    id,
    started_at: body.started_at,
    local_date: body.local_date,
    finished_at: null,
    exercise_count: 0,
    set_count: 0,
    exercises: [],
  }
}

const number = (value: number | string | null | undefined) =>
  value === null || value === undefined ? null : Number(value)

/** Подход так, как его вернул бы сервер: исходные значения и канонические единицы. */
export function setOf(id: string, kind: SetOut['kind'], body: SetIn): SetOut {
  const weight = number(body.weight_value)
  const distance = number(body.distance_value)
  return {
    id,
    kind,
    reps: body.reps ?? null,
    weight_value: weight,
    weight_unit: body.weight_unit ?? null,
    weight_kg: weight === null ? null : body.weight_unit === 'lb' ? weight * KG_PER_LB : weight,
    duration_seconds: body.duration_seconds ?? null,
    distance_value: distance,
    distance_unit: body.distance_unit ?? null,
    distance_km:
      distance === null ? null : body.distance_unit === 'mi' ? distance * KM_PER_MI : distance,
    incline_percent: number(body.incline_percent),
    level: body.level ?? null,
  }
}

/**
 * Изменения журнала в копии — те же, что делает сервер. Ими очередь без сети показывает
 * записанное на своих местах, пока оно не отправлено.
 */
export const workoutCopy = {
  async save(id: string, body: Schemas['WorkoutIn']): Promise<void> {
    const detail = (await copy.get<Detail>(WORKOUT_COPY.detail(id))) ?? fresh(id, body)
    await store({ ...detail, started_at: body.started_at, local_date: body.local_date })
  },

  finish(id: string, finishedAt: string): Promise<void> {
    return change(id, (detail) => ({ ...detail, finished_at: detail.finished_at ?? finishedAt }))
  },

  async remove(id: string): Promise<void> {
    await copy.remove(WORKOUT_COPY.detail(id))
    await copy.update<Schemas['WorkoutListOut']>(WORKOUT_COPY.list, (list) =>
      list ? { workouts: list.workouts.filter((row) => row.id !== id) } : undefined,
    )
  },

  async addExercise(id: string, itemId: string, exerciseId: string): Promise<void> {
    const detail = await copy.get<Detail>(WORKOUT_COPY.detail(id))
    if (!detail || detail.exercises.some((item) => item.id === itemId)) return
    const [item] = await itemsFor(detail, [{ id: itemId, exerciseId }])
    const last = Math.max(0, ...detail.exercises.map((value) => value.position))
    await store({ ...detail, exercises: [...detail.exercises, { ...item!, position: last + 1 }] })
  },

  removeExercise(id: string, itemId: string): Promise<void> {
    return change(id, (detail) => ({
      ...detail,
      exercises: detail.exercises.filter((item) => item.id !== itemId),
    }))
  },

  saveSet(id: string, itemId: string, setId: string, body: SetIn): Promise<void> {
    return change(
      id,
      editItem(itemId, (item) => {
        const value = setOf(setId, item.exercise.kind, body)
        const known = item.sets.some((set) => set.id === setId)
        return {
          ...item,
          sets: known
            ? item.sets.map((set) => (set.id === setId ? value : set))
            : [...item.sets, value],
        }
      }),
    )
  },

  removeSet(id: string, itemId: string, setId: string): Promise<void> {
    return change(
      id,
      editItem(itemId, (item) => ({ ...item, sets: item.sets.filter((set) => set.id !== setId) })),
    )
  },

  /** Повтор: упражнения прошлой тренировки, кроме убранных из списка, без подходов. */
  async repeat(sourceId: string, body: Schemas['WorkoutRepeatIn']): Promise<void> {
    const source = await copy.get<Detail>(WORKOUT_COPY.detail(sourceId))
    if (!source) throw new Error('workout is not in the copy')
    const kept = source.exercises.filter((item) => !item.exercise.archived)
    const detail = fresh(body.id, body)
    const rows = kept.map((item, index) => ({
      id: body.item_ids[index]!,
      exerciseId: item.exercise.id,
    }))
    await store({ ...detail, exercises: await itemsFor(detail, rows) })
  },

  /** Запуск группы: её упражнения по порядку, без подходов. */
  async startGroup(groupId: string, body: Schemas['WorkoutRepeatIn']): Promise<void> {
    const groups = await copy.get<Groups>(WORKOUT_COPY.groups)
    const group = groups?.groups.find((value) => value.id === groupId)
    if (!group) throw new Error('group is not in the copy')
    const detail = fresh(body.id, body)
    const rows = group.exercise_ids.map((exerciseId, index) => ({
      id: body.item_ids[index]!,
      exerciseId,
    }))
    await store({ ...detail, exercises: await itemsFor(detail, rows) })
  },

  /** Отдых между подходами — свойство упражнения: меняется и в списке, и в тренировках. */
  async rest(exerciseId: string, seconds: number): Promise<void> {
    await copy.update<Schemas['ExerciseListOut']>(WORKOUT_COPY.exercises, (list) =>
      list
        ? {
            ...list,
            exercises: list.exercises.map((exercise) =>
              exercise.id === exerciseId ? { ...exercise, rest_seconds: seconds } : exercise,
            ),
          }
        : undefined,
    )
    for (const key of await copy.keys(WORKOUT_COPY.detailPrefix)) {
      await copy.update<Detail>(key, (detail) =>
        detail?.exercises.some((item) => item.exercise.id === exerciseId)
          ? {
              ...detail,
              exercises: detail.exercises.map((item) =>
                item.exercise.id === exerciseId
                  ? { ...item, exercise: { ...item.exercise, rest_seconds: seconds } }
                  : item,
              ),
            }
          : undefined,
      )
    }
  },

  /** Тренировки последних дней и последние подходы — как их отдал сервер. */
  async replace(recent: Schemas['WorkoutRecentOut']): Promise<void> {
    const keep = new Set(recent.workouts.map((detail) => WORKOUT_COPY.detail(detail.id)))
    for (const key of await copy.keys(WORKOUT_COPY.detailPrefix)) {
      if (!keep.has(key)) await copy.remove(key)
    }
    for (const detail of recent.workouts) await copy.put(WORKOUT_COPY.detail(detail.id), detail)
    await copy.put(WORKOUT_COPY.latest, recent.latest)
  },
}

/**
 * «По плану сегодня» в копии групп: сервер считал его на день, когда копию брали, а без
 * сети она бывает и вчерашней. Правило то же, что у сервера; понедельник — день 0.
 */
export function plannedOn(list: Groups, day: string): Groups {
  if (list.date === day) return list
  const weekday = (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7
  return {
    date: day,
    groups: list.groups.map((group) => ({
      ...group,
      scheduled:
        group.dates.includes(day) ||
        (group.start_date != null &&
          day >= group.start_date &&
          (group.end_date == null || day <= group.end_date) &&
          group.weekdays.includes(weekday)),
    })),
  }
}
