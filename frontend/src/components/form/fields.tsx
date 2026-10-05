import { type ComponentProps, useId } from 'react'
import { useTranslation } from 'react-i18next'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import type { ErrorKey } from '@/lib/errors'

import type { ValidationKey } from './validation'

interface FieldChrome {
  label: string
  /** Ключ словаря из схемы валидации (см. `message` в validation.ts). */
  error?: string
  hint?: string
}

export function FieldMessage({
  id,
  error,
  hint,
}: { id: string } & Pick<FieldChrome, 'error' | 'hint'>) {
  const { t } = useTranslation()
  if (error) {
    return (
      <p id={id} className="text-sm text-destructive">
        {t(error as ValidationKey)}
      </p>
    )
  }
  if (hint) {
    return (
      <p id={id} className="text-sm text-muted-foreground">
        {hint}
      </p>
    )
  }
  return null
}

export function TextField({ label, error, hint, ...props }: ComponentProps<'input'> & FieldChrome) {
  const id = useId()
  const described = error || hint ? `${id}-message` : undefined
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={described}
        className="h-11 text-base"
        {...props}
      />
      <FieldMessage id={`${id}-message`} error={error} hint={hint} />
    </div>
  )
}

export function SelectField({
  label,
  error,
  hint,
  ...props
}: Omit<ComponentProps<'select'>, 'size'> & FieldChrome) {
  const id = useId()
  const described = error || hint ? `${id}-message` : undefined
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <NativeSelect
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={described}
        className="w-full"
        {...props}
      />
      <FieldMessage id={`${id}-message`} error={error} hint={hint} />
    </div>
  )
}

/** Отказ сервера или сети над формой. */
export function FormError({ failure }: { failure: ErrorKey | undefined }) {
  const { t } = useTranslation()
  if (!failure) return null
  return (
    <Alert variant="destructive">
      <AlertDescription>{t(failure)}</AlertDescription>
    </Alert>
  )
}
