import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { useMeasurementSummary } from '@/api/measurements'
import { DIARY_KEY, type NutritionGoal, saveGoal, useNutritionGoal } from '@/api/nutrition'
import type { User } from '@/auth/session'
import { useUser } from '@/auth/useSession'
import { FormError, SelectField, TextField } from '@/components/form/fields'
import { numberOf } from '@/components/form/validation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { isoToDisplay, today } from '@/lib/dates'
import type { ErrorKey } from '@/lib/errors'
import {
  ACTIVITIES,
  type Activity,
  ageOn,
  type Aim,
  AIMS,
  type Body,
  formatKcal,
  suggestTargets,
  type Targets,
} from '@/lib/nutrition'

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

function GoalForm({ goal, body }: { goal: NutritionGoal | null; body: Body | null }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [failure, setFailure] = useState<ErrorKey>()
  const form = useForm<GoalValues>({
    resolver: zodResolver(goalSchema),
    defaultValues: {
      kcal: goal ? String(goal.kcal) : '',
      protein: goal ? String(goal.protein_g) : '',
      fat: goal ? String(goal.fat_g) : '',
      carbs: goal ? String(goal.carbs_g) : '',
    },
  })
  const { errors, isSubmitting } = form.formState

  function apply(targets: Targets) {
    form.reset({
      kcal: String(targets.kcal),
      protein: String(targets.protein_g),
      fat: String(targets.fat_g),
      carbs: String(targets.carbs_g),
    })
  }

  async function submit(values: GoalValues) {
    setFailure(undefined)
    const result = await saveGoal({
      kcal: numberOf(values.kcal, 0),
      protein_g: numberOf(values.protein, 0),
      fat_g: numberOf(values.fat, 0),
      carbs_g: numberOf(values.carbs, 0),
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
      <FormError failure={failure} />
      <div className="grid grid-cols-2 gap-4">
        <TextField
          label={t('goal.kcal')}
          error={errors.kcal?.message}
          {...number}
          {...form.register('kcal')}
        />
        <TextField
          label={t('goal.protein')}
          error={errors.protein?.message}
          {...number}
          {...form.register('protein')}
        />
        <TextField
          label={t('goal.fat')}
          error={errors.fat?.message}
          {...number}
          {...form.register('fat')}
        />
        <TextField
          label={t('goal.carbs')}
          error={errors.carbs?.message}
          {...number}
          {...form.register('carbs')}
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
  const summary = useMeasurementSummary()

  if (goal.isPending || summary.isPending) {
    return <p className="text-muted-foreground">{t('common.loading')}</p>
  }
  const weight = summary.data?.find((item) => item.metric === 'weight')?.latest?.value
  return <GoalForm goal={goal.data ?? null} body={bodyOf(user, weight)} />
}
