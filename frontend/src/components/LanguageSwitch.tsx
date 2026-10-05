import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { LANGUAGE_NAMES, LANGUAGES, setLanguage } from '@/i18n'

export function LanguageSwitch() {
  const { t, i18n } = useTranslation()

  return (
    <div role="group" aria-label={t('language.label')} className="flex gap-2">
      {LANGUAGES.map((language) => (
        <Button
          key={language}
          size="sm"
          variant={i18n.language === language ? 'default' : 'outline'}
          aria-pressed={i18n.language === language}
          onClick={() => void setLanguage(language)}
        >
          {LANGUAGE_NAMES[language]}
        </Button>
      ))}
    </div>
  )
}
