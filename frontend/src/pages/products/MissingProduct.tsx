import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import type { Missing } from './lookup'
import { ProductForm } from './ProductForm'

/**
 * Новый продукт для штрихкода, которого нет в каталоге: форма открывается с ним и с тем,
 * что о продукте известно. `children` — что ещё предложить под формой.
 */
export function MissingProduct({
  missing,
  onSaved,
  cancel,
  children,
}: {
  missing: Missing
  onSaved: (id: string) => void | Promise<void>
  cancel: ReactNode
  children?: ReactNode
}) {
  const { t } = useTranslation()
  const { status, barcode, draft } = missing
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold">{t('products.newTitle')}</h1>
      <p role="status" className="text-sm text-muted-foreground">
        {t(`lookupNotices.${status}`, { barcode })}
      </p>
      <ProductForm draft={{ ...draft, barcode }} onSaved={onSaved} cancel={cancel} />
      {children}
    </div>
  )
}
