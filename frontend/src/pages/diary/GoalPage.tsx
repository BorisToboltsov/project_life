import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { type Control, useForm, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { type Measurement, useMeasurementSummary, useMetrics } from '@/api/measurements'
import { DIARY_KEY, type NutritionGoal, saveGoal, useNutritionGoal } from '@/api/nutrition'
import type { User } from '@/auth/session'
import { useUser } from '@/auth/useSession'
import { FormError, SelectField, TextField } from '@/components/form/fields'
import { useAutoKcal } from '@/components/form/useAutoKcal'
import { optionalNumberOf } from '@/components/form/validation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { isoToDisplay, today } from '@/lib/dates'
import type { ErrorKey } from '@/lib/errors'
import { formatNumber, parseDecimal } from '@/lib/numbers'
import {
  ACTIVITIES,
  type Activity,
  ageOn,
  type Aim,
  AIMS,
  type Body,
  formatKcal,
  formatMl,
  macrosEnergy,
  suggestTargets,
  suggestWater,
  type Targets,
} from '@/lib/nutrition'
import { displayUnit, measuredIn } from '@/lib/units'

import { goalSchema, type GoalValues } from './values'

/** Всё, что нужно формуле: пол, возраст, рост и последний вес. Чего-то нет — расчёта нет. */
function bodyOf(user: User, weightKg: number | undefined): Body | null {
  if (!user.sex || !user.birth_date || !user.height_cm || !weightKg) return null
  return {
    sex: user.sex,
    age: ageOn(user.birth_date, today()),
    heightCm: user.height_cm,
    weightKg,
  }
}

function Hint({ body, onApply }: { body: Body | null; onApply: (targets: Targets) => void }) {
  const { t, i18n } = useTranslation()
  const [activity, setActivity] = useState<Activity>('light')
  const [aim, setAim] = useState<Aim>('maintain')

  if (!body) {
    return <p className="text-sm text-muted-foreground">{t('goal.hintMissing')}</p>
  }
  const targets = suggestTargets(body, activity, aim)

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label={t('goal.activity')}
          value={activity}
          onChange={(event) => setActivity(event.target.value as Activity)}
        >
          {ACTIVITIES.map((option) => (
            <option key={option} value={option}>
              {t(`activity.${option}`)}
            </option>
          ))}
        </SelectField>
        <SelectField
          label={t('goal.aim')}
          value={aim}
          onChange={(event) => setAim(event.target.value as Aim)}
        >
          {AIMS.map((option) => (
            <option key={option} value={option}>
              {t(`aims.${option}`)}
            </option>
          ))}
        </SelectField>
      </div>
      <p className="font-medium">
        {t('goal.suggestion', {
          kcal: formatKcal(targets.kcal, i18n.language),
          protein: targets.protein_g,
          fat: targets.fat_g,
          carbs: targets.carbs_g,
        })}
      </p>
      <Button
        type="button"
        variant="outline"
        className="h-11 justify-self-start"
        onClick={() => onApply(targets)}
      >
        {t('goal.apply')}
      </Button>
      <p className="text-sm text-muted-foreground">{t('goal.hintNote')}</p>
    </>
  )
}

/**
 * Строка под полями: сколько калорий из цели уже занято белками, жирами и углеводами, а
 * пока сравнивать нечего — как калории и БЖУ связаны.
 */
function Budget({ control }: { control: Control<GoalValues> }) {
  const { t, i18n } = useTranslation()
  const values = useWatch({ control })
  const kcal = parseDecimal(values.kcal ?? '')
  const used = macrosEnergy({
    protein: values.protein ?? '',
    fat: values.fat ?? '',
    carbs: values.carbs ?? '',
  })

  // Без калорий предела нет, а без БЖУ считать нечего.
  if (kcal === null || used === 0) {
    return <p className="text-sm text-muted-foreground">{t('goal.kcalHint')}</p>
  }
  const format = (value: number) => formatKcal(value, i18n.language)
  return used > kcal ? (
    <p className="text-sm text-destructive">
      {t('goal.budgetOver', { used: format(used), over: format(used - kcal) })}
    </p>
  ) : (
    <p className="text-sm text-muted-foreground">
      {t('goal.budgetLeft', { used: format(used), kcal: format(kcal), left: format(kcal - used) })}
    </p>
  )
}

/**
 * Под полем воды: откуда взялся расчёт и кнопка, которая возвращает его в поле, если там
 * уже другое число. Без веса считать не из чего — строка говорит, что внести.
 */
function WaterHint({
  control,
  weight,
  suggested,
  onApply,
}: {
  control: Control<GoalValues>
  weight: Measurement | null
  suggested: number | null
  onApply: () => void
}) {
  const { t, i18n } = useTranslation()
  const user = useUser()
  const typed = useWatch({ control, name: 'water' })

  if (!weight || suggested === null) {
    return <p className="text-sm text-muted-foreground">{t('goal.waterHintMissing')}</p>
  }
  const unit = displayUnit('mass', user.unit_system)
  const value = formatMl(suggested, i18n.language)
  return (
    <>
      <p className="text-sm text-muted-foreground">
        {t('goal.waterHint', {
          weight: formatNumber(measuredIn(weight, unit), i18n.language),
          unit: t(`unitNames.${unit}`),
          value,
        })}
      </p>
      {typed !== String(suggested) && (
        <Button
          type="button"
          variant="outline"
          className="h-11 justify-self-start"
          onClick={onApply}
        >
          {t('goal.waterApply', { value })}
        </Button>
      )}
    </>
  )
}

function textOf(value: number | null | undefined): string {
  return value == null ? '' : String(value)
}

function GoalForm({
  goal,
  body,
  weight,
}: {
  goal: NutritionGoal | null
  body: Body | null
  /** Последний замер веса: по нему считается ориентир цели по воде. */
  weight: Measurement | null
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [failure, setFailure] = useState<ErrorKey>()
  const suggestedWater = weight ? suggestWater(weight.value) : null
  const defaults: GoalValues = {
    kcal: textOf(goal?.kcal),
    protein: textOf(goal?.protein_g),
    fat: textOf(goal?.fat_g),
    carbs: textOf(goal?.carbs_g),
    // Пока цели по воде нет, в поле сразу стоит расчёт по весу.
    water: textOf(goal?.water_ml ?? suggestedWater),
  }
  const form = useForm<GoalValues>({ resolver: zodResolver(goalSchema), defaultValues: defaults })
  const { errors, isSubmitting, isSubmitted } = form.formState
  // Калории считаются по БЖУ, пока их не ввели сами; введённые — предел для БЖУ.
  const auto = useAutoKcal({
    initial: defaults,
    digits: 0,
    read: form.getValues,
    write: (kcal) => form.setValue('kcal', kcal),
  })

  function apply(targets: Targets) {
    const values = {
      kcal: String(targets.kcal),
      protein: String(targets.protein_g),
      fat: String(targets.fat_g),
      carbs: String(targets.carbs_g),
      // Расчёт по профилю воды не касается: в поле остаётся то, что набрано.
      water: form.getValues('water'),
    }
    form.reset(values)
    auto.reset(values)
  }

  async function submit(values: GoalValues) {
    setFailure(undefined)
    const result = await saveGoal({
      kcal: optionalNumberOf(values.kcal, 0),
      protein_g: optionalNumberOf(values.protein, 0),
      fat_g: optionalNumberOf(values.fat, 0),
      carbs_g: optionalNumberOf(values.carbs, 0),
      water_ml: optionalNumberOf(values.water, 0),
      local_date: today(),
    })
    if (result.failure) {
      setFailure(result.failure)
      return
    }
    await queryClient.invalidateQueries({ queryKey: DIARY_KEY })
    await navigate({ to: '/diary/$date', params: { date: today() } })
  }

  const number = { inputMode: 'numeric', autoComplete: 'off' } as const
  const macro = {
    onChange: () => {
      auto.follow()
      // Предел по калориям проверяется на их поле: после правки БЖУ оно перепроверяется.
      if (isSubmitted) void form.trigger('kcal')
    },
  }

  return (
    <form
      onSubmit={(event) => void form.handleSubmit(submit)(event)}
      noValidate
      className="grid gap-4"
    >
      <h1 className="text-2xl font-semibold">{t('goal.title')}</h1>
      {goal && (
        <p className="text-sm text-muted-foreground">
          {t('goal.since', { date: isoToDisplay(goal.effective_from) })}
        </p>
      )}
      <p className="text-sm text-muted-foreground">{t('goal.partial')}</p>
      <FormError failure={failure} />
      <div className="grid grid-cols-2 gap-4">
        <TextField
          label={t('goal.kcal')}
          error={errors.kcal?.message}
          {...number}
          {...form.register('kcal', auto.kcal)}
        />
        <TextField
          label={t('goal.protein')}
          error={errors.protein?.message}
          {...number}
          {...form.register('protein', macro)}
        />
        <TextField
          label={t('goal.fat')}
          error={errors.fat?.message}
          {...number}
          {...form.register('fat', macro)}
        />
        <TextField
          label={t('goal.carbs')}
          error={errors.carbs?.message}
          {...number}
          {...form.register('carbs', macro)}
        />
      </div>
      <Budget control={form.control} />
      <div className="grid gap-2">
        <div className="grid grid-cols-2 gap-4">
          <TextField
            label={t('goal.water')}
            error={errors.water?.message}
            {...number}
            {...form.register('water')}
          />
        </div>
        <WaterHint
          control={form.control}
          weight={weight}
          suggested={suggestedWater}
          onApply={() =>
            form.setValue('water', String(suggestedWater), {
              shouldDirty: true,
              shouldValidate: isSubmitted,
            })
          }
        />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{t('goal.hintTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Hint body={body} onApply={apply} />
        </CardContent>
      </Card>
      <div className="flex gap-3">
        <Button type="submit" className="h-11" disabled={isSubmitting}>
          {t('common.save')}
        </Button>
        <Button asChild variant="ghost" className="h-11">
          <Link to="/diary/$date" params={{ date: today() }}>
            {t('diary.cancel')}
          </Link>
        </Button>
      </div>
    </form>
  )
}

export function GoalPage() {
  const { t } = useTranslation()
  const user = useUser()
  const goal = useNutritionGoal()
  const metrics = useMetrics()
  const summary = useMeasurementSummary()

  if (goal.isPending || metrics.isPending || summary.isPending) {
    return <p className="text-muted-foreground">{t('common.loading')}</p>
  }
  // Вес берётся и тогда, когда его убрали из списка замеров: замеры остаются.
  const weightId = metrics.data?.metrics.find((metric) => metric.preset === 'weight')?.id
  const weight = summary.data?.find((item) => item.metric_id === weightId)?.latest ?? null
  return <GoalForm goal={goal.data ?? null} body={bodyOf(user, weight?.value)} weight={weight} />
}
