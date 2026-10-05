import { CalendarDays } from 'lucide-react'
import { useId, useState } from 'react'
import { enGB, ru } from 'react-day-picker/locale'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { Language } from '@/i18n'
import {
  displayToIso,
  formatDateInput,
  isoToDisplay,
  isoToLocalDate,
  isRealDate,
  localDateToIso,
} from '@/lib/dates'

import { FieldMessage } from './fields'

// Британская локаль для английского: неделя с понедельника, день перед месяцем.
const CALENDAR_LOCALES = { ru, en: enGB } satisfies Record<Language, unknown>

interface DateFieldProps {
  label: string
  /** Дата в виде `ГГГГ-ММ-ДД` или пустая строка. */
  value: string
  onChange: (iso: string) => void
  onBlur?: () => void
  /** Границы календаря, `ГГГГ-ММ-ДД`. */
  min?: string
  max?: string
  /** Ключ словаря из схемы валидации. */
  error?: string
}

/**
 * Поле даты с календарём, показывающее дату как «день/месяц/год» (инвариант I7).
 * Нативное поле даты не годится: порядок частей в нём задаёт браузер, а не приложение.
 */
export function DateField({ label, value, onChange, onBlur, min, max, error }: DateFieldProps) {
  const { t, i18n } = useTranslation()
  const id = useId()
  const [text, setText] = useState(() => isoToDisplay(value))
  const [reported, setReported] = useState(value)
  const [open, setOpen] = useState(false)

  // Значение сменили снаружи (форму сбросили после сохранения) — показываем его.
  if (value !== reported) {
    setReported(value)
    setText(isoToDisplay(value))
  }

  function report(nextText: string) {
    const iso = displayToIso(nextText)
    setText(nextText)
    setReported(iso)
    onChange(iso)
  }

  const selected = isRealDate(value) ? isoToLocalDate(value) : undefined
  const earliest = min ? isoToLocalDate(min) : undefined
  const latest = max ? isoToLocalDate(max) : undefined

  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          inputMode="numeric"
          autoComplete="off"
          placeholder={t('date.placeholder')}
          value={text}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-message` : undefined}
          className="h-11 pr-12 text-base"
          onChange={(event) => report(formatDateInput(event.target.value))}
          onBlur={onBlur}
        />
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t('date.openCalendar')}
              className="absolute top-1/2 right-1.5 -translate-y-1/2"
            >
              <CalendarDays aria-hidden="true" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-auto p-0">
            <Calendar
              mode="single"
              captionLayout="dropdown"
              locale={CALENDAR_LOCALES[i18n.language as Language]}
              selected={selected}
              defaultMonth={selected ?? latest}
              startMonth={earliest}
              endMonth={latest}
              disabled={[
                ...(earliest ? [{ before: earliest }] : []),
                ...(latest ? [{ after: latest }] : []),
              ]}
              className="[--cell-size:--spacing(10)]"
              onSelect={(date) => {
                report(date ? isoToDisplay(localDateToIso(date)) : '')
                setOpen(false)
              }}
            />
          </PopoverContent>
        </Popover>
      </div>
      <FieldMessage id={`${id}-message`} error={error} />
    </div>
  )
}
