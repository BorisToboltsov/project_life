import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { type ExternalProduct, type Product, useExternalSearch } from '@/api/nutrition'
import { FormError } from '@/components/form/fields'
import { Button } from '@/components/ui/button'
import type { ErrorKey } from '@/lib/errors'
import { formatGrams, formatKcal } from '@/lib/nutrition'

import { lookUp, type Missing } from './lookup'

/** Короче этого текст в Open Food Facts не уходит — так же считает сервер. */
const MIN_LENGTH = 2

function ExternalLine({ product }: { product: ExternalProduct }) {
  const { t, i18n } = useTranslation()
  const { kcal, protein_g, fat_g, carbs_g } = product
  return (
    <>
      <span className="block font-medium break-words">{product.name}</span>
      <span className="block text-sm text-muted-foreground">
        {kcal != null && protein_g != null && fat_g != null && carbs_g != null
          ? t('addFood.per100', {
              kcal: formatKcal(kcal, i18n.language),
              protein: formatGrams(protein_g, i18n.language),
              fat: formatGrams(fat_g, i18n.language),
              carbs: formatGrams(carbs_g, i18n.language),
              unit: t(`productUnits.${product.unit}`),
            })
          : t('search.incomplete')}
      </span>
    </>
  )
}

/**
 * Поиск по названию в Open Food Facts (ADR 0010): секция под результатами своего каталога.
 * Наружу текст уходит только по кнопке, а не при наборе. Выбранный продукт берётся в
 * каталог запросом по штрихкоду: `onFound` получает его уже оттуда, `onMissing` — то, что
 * известно о продукте, чей состав нужно дополнить.
 */
export function ExternalSearch({
  q,
  onFound,
  onMissing,
}: {
  q: string
  onFound: (product: Product) => void | Promise<void>
  onMissing: (missing: Missing) => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  // Текст, по которому человек попросил искать снаружи; новый текст — новая просьба.
  const [asked, setAsked] = useState<string>()
  const [taking, setTaking] = useState<ExternalProduct>()
  const [failure, setFailure] = useState<ErrorKey>()
  const found = useExternalSearch(q, asked === q)
  // Экран могли закрыть, пока продукт брался в каталог: ответ тогда уже никуда не ведёт.
  const shown = useRef(true)
  useEffect(() => {
    shown.current = true
    return () => {
      shown.current = false
    }
  }, [])

  async function take(item: ExternalProduct) {
    setFailure(undefined)
    setTaking(item)
    const looked = await lookUp(queryClient, item.barcode)
    if (!shown.current) return
    setTaking(undefined)
    if ('failure' in looked) setFailure(looked.failure)
    else if ('product' in looked) await onFound(looked.product)
    // Чего не знает запрос по штрихкоду, известно из выдачи поиска.
    else onMissing({ ...looked.missing, draft: looked.missing.draft ?? item })
  }

  if (q.length < MIN_LENGTH) return null
  if (asked !== q) {
    return (
      <div className="grid gap-2">
        <Button variant="outline" className="h-11 justify-self-start" onClick={() => setAsked(q)}>
          {t('search.findOutside')}
        </Button>
        <p className="text-sm text-muted-foreground">{t('search.outsideHint')}</p>
      </div>
    )
  }

  const title = t('search.outside')
  const items = found.data?.items ?? []
  const last = found.data?.last
  const unavailable = last?.status === 'unavailable'
  return (
    <section className="grid gap-2">
      <h2 className="text-sm font-medium text-muted-foreground">{title}</h2>
      {found.isPending && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('search.searching')}
        </p>
      )}
      {items.length > 0 && (
        <ul aria-label={title} className="grid gap-2">
          {items.map((item) => (
            <li key={item.barcode}>
              <button
                type="button"
                className="block w-full rounded-lg border p-3 text-left transition-colors hover:bg-muted/50 disabled:opacity-60"
                disabled={taking !== undefined}
                onClick={() => void take(item)}
              >
                <ExternalLine product={item} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {taking && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('search.taking', { name: taking.name })}
        </p>
      )}
      <FormError failure={failure} />
      {unavailable &&
        (last.failure ? (
          <FormError failure={last.failure} />
        ) : (
          <p role="alert" className="text-sm text-destructive">
            {t('search.outsideUnavailable')}
          </p>
        ))}
      {!found.isPending && !unavailable && items.length === 0 && !found.hasNextPage && (
        <p className="text-sm text-muted-foreground">{t('search.outsideEmpty')}</p>
      )}
      {unavailable && (
        <Button
          variant="outline"
          className="h-11 justify-self-start"
          disabled={found.isFetching}
          onClick={() => void found.refetch()}
        >
          {t('common.retry')}
        </Button>
      )}
      {found.hasNextPage && (
        <Button
          variant="outline"
          className="h-11 justify-self-start"
          disabled={found.isFetchingNextPage}
          onClick={() => void found.fetchNextPage()}
        >
          {t('search.more')}
        </Button>
      )}
    </section>
  )
}
