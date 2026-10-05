import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/** Одноразовая ссылка (приглашение, сброс пароля) с кнопкой копирования. */
export function CopyLink({ title, hint, url }: { title: string; hint: string; url: string }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  async function copy() {
    await navigator.clipboard.writeText(url)
    setCopied(true)
  }

  return (
    <div className="grid gap-1.5 rounded-lg border bg-muted/40 p-3">
      <Label htmlFor="copy-link">{title}</Label>
      <div className="flex gap-2">
        <Input
          id="copy-link"
          readOnly
          value={url}
          className="h-11 text-base"
          onFocus={(event) => event.target.select()}
        />
        <Button type="button" className="h-11" onClick={() => void copy()}>
          {copied ? t('common.copied') : t('common.copy')}
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">{hint}</p>
    </div>
  )
}
