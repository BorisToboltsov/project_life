import type { ComponentProps } from 'react'

/**
 * Один из вариантов «нескольких из многих»: та же скруглённая метка, что `ChoiceChip`, но
 * с флажком внутри — выбрать можно любое число.
 */
export function CheckChip({ children, ...checkbox }: Omit<ComponentProps<'input'>, 'type'>) {
  return (
    <label className="flex h-11 cursor-pointer items-center rounded-full border px-4 text-sm has-checked:border-primary has-checked:bg-primary has-checked:text-primary-foreground has-focus-visible:ring-2 has-focus-visible:ring-ring">
      <input type="checkbox" className="sr-only" {...checkbox} />
      {children}
    </label>
  )
}
