import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { LANGUAGE_NAMES, LANGUAGES, setLanguage } from '@/i18n'

/** Переключатель языка для экранов до входа; после входа язык задаётся в профиле. */
export function LanguageSwitch() {
  const { t, i18n } = useTranslation()

  return (
    <div role="group" aria-label={t('language.label')} className="flex justify-center gap-2">
      {LANGUAGES.map((language) => (
        <Button
          key={language}
          size="sm"
          variant={i18n.language === language ? 'secondary' : 'ghost'}
          aria-pressed={i18n.language === language}
          onClick={() => void setLanguage(language)}
        >
          {LANGUAGE_NAMES[language]}
        </Button>
      ))}
    </div>
  )
}
