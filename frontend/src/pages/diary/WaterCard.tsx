import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { X } from 'lucide-react'
import { useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { deleteWater, DIARY_KEY, type DiaryDay, saveWater } from '@/api/nutrition'
import { FormError, TextField } from '@/components/form/fields'
import { numberOf } from '@/components/form/validation'
import { WaterGlass } from '@/components/illustrations/WaterGlass'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { ErrorKey } from '@/lib/errors'
import { formatMl, share } from '@/lib/nutrition'
import { uuidv7 } from '@/lib/uuid'

import { waterSchema, type WaterValues } from './values'

/** Порции на кнопках, мл: чашка, стакан, бутылка. */
const PORTIONS = [150, 250, 500]

/** Своё количество воды — раскрывается кнопкой «Другое». */
function CustomAmount({
  busy,
  onAdd,
}: {
  busy: boolean
  /** Вносит порцию; отвечает, удалось ли. */
  onAdd: (amount: number) => Promise<boolean>
}) {
  const { t } = useTranslation()
  const form = useForm<WaterValues>({
    resolver: zodResolver(waterSchema),
    defaultValues: { amount: '' },
  })

  async function submit(values: WaterValues) {
    if (await onAdd(numberOf(values.amount, 0))) form.reset()
  }

  return (
    <form
      onSubmit={(event) => void form.handleSubmit(submit)(event)}
      noValidate
      className="grid gap-3"
    >
      <TextField
        label={t('water.customLabel')}
        inputMode="numeric"
        autoComplete="off"
        error={form.formState.errors.amount?.message}
        {...form.register('amount')}
      />
      <Button type="submit" className="h-11 justify-self-start" disabled={busy}>
        {t('diary.add')}
      </Button>
    </form>
  )
}

/**
 * Вода за день: стакан заполняется до цели, порции вносятся кнопками и убираются метками
 * под ним. День приходит от экрана: свой запрос карточка не делает. `goalLink` — кнопка
 * смены цели в заголовке, когда рядом нет «Итога дня».
 */
export function WaterCard({
  date,
  day,
  title,
  goalLink = false,
}: {
  date: string
  /** День дневника; пока он грузится, у карточки только заголовок. */
  day: DiaryDay | null | undefined
  title: string
  goalLink?: boolean
}) {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const [custom, setCustom] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<ErrorKey>()
  // Ключ порции живёт до успешной отправки: повтор после сбоя не добавит вторую.
  const unsent = useRef(new Map<string, string>())

  const ml = (value: number) => formatMl(value, i18n.language)
  const water = day?.water
  const goal = day?.goal?.water_ml ?? undefined

  async function add(amount: number): Promise<boolean> {
    setFailure(undefined)
    setBusy(true)
    const portion = `${date}:${amount}`
    const id = unsent.current.get(portion) ?? uuidv7()
    unsent.current.set(portion, id)
    const result = await saveWater(id, { local_date: date, amount_ml: amount })
    if (result.failure) {
      setFailure(result.failure)
    } else {
      unsent.current.delete(portion)
      await queryClient.invalidateQueries({ queryKey: DIARY_KEY })
    }
    setBusy(false)
    return !result.failure
  }

  async function remove(id: string) {
    setFailure(undefined)
    const result = await deleteWater(id)
    if (result.failure) setFailure(result.failure)
    await queryClient.invalidateQueries({ queryKey: DIARY_KEY })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {goalLink && goal !== undefined && (
          <CardAction>
            <Button asChild variant="outline" size="sm">
              <Link to="/diary/goal">{t('diary.goalChange')}</Link>
            </Button>
          </CardAction>
        )}
      </CardHeader>
      {water && (
        <CardContent className="grid gap-4">
          <div className="flex items-center gap-4">
            <div className="w-24 shrink-0">
              <WaterGlass
                label={t('water.progress')}
                level={goal === undefined ? undefined : share(water.total_ml, goal)}
                done={goal !== undefined && water.total_ml >= goal}
              />
            </div>
            <div className="grid min-w-0 flex-1 gap-1">
              <span className="text-xl font-semibold">
                {goal === undefined
                  ? t('water.amount', { value: ml(water.total_ml) })
                  : t('water.of', { value: ml(water.total_ml), goal: ml(goal) })}
              </span>
              {goal === undefined ? (
                <Link
                  to="/diary/goal"
                  className="justify-self-start text-sm underline underline-offset-4"
                >
                  {t('diary.goalSet')}
                </Link>
              ) : (
                <span className="text-sm text-muted-foreground">
                  {water.total_ml >= goal
                    ? t('water.done')
                    : t('water.left', { value: ml(goal - water.total_ml) })}
                </span>
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                {PORTIONS.map((amount) => (
                  <Button
                    key={amount}
                    variant="outline"
                    className="h-11"
                    aria-label={t('water.addAmount', { value: ml(amount) })}
                    disabled={busy}
                    onClick={() => void add(amount)}
                  >
                    {t('water.plus', { value: ml(amount) })}
                  </Button>
                ))}
                <Button
                  variant="outline"
                  className="h-11"
                  aria-expanded={custom}
                  onClick={() => setCustom(!custom)}
                >
                  {t('water.other')}
                </Button>
              </div>
            </div>
          </div>
          {custom && (
            <CustomAmount
              busy={busy}
              onAdd={async (amount) => {
                const added = await add(amount)
                if (added) setCustom(false)
                return added
              }}
            />
          )}
          {water.intakes.length > 0 && (
            <ul aria-label={t('water.portions')} className="flex flex-wrap gap-2">
              {water.intakes.map((intake) => (
                <li
                  key={intake.id}
                  className="flex items-center gap-0.5 rounded-full border pl-2.5 text-sm"
                >
                  {t('water.amount', { value: ml(intake.amount_ml) })}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="rounded-full"
                    aria-label={t('water.remove', { value: ml(intake.amount_ml) })}
                    onClick={() => void remove(intake.id)}
                  >
                    <X aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <FormError failure={failure} />
        </CardContent>
      )}
    </Card>
  )
}
