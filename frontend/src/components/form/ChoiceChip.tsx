import type { ComponentProps } from 'react'

/**
 * Один из вариантов «одного из нескольких»: скруглённая метка со скрытой радиокнопкой
 * внутри. Выбранная — на тёмной подложке, фокус с клавиатуры виден кольцом на метке.
 */
export function ChoiceChip({ children, ...radio }: Omit<ComponentProps<'input'>, 'type'>) {
  return (
    <label className="flex h-11 cursor-pointer items-center rounded-full border px-4 text-sm has-checked:border-primary has-checked:bg-primary has-checked:text-primary-foreground has-focus-visible:ring-2 has-focus-visible:ring-ring">
      <input type="radio" className="sr-only" {...radio} />
      {children}
    </label>
  )
}
