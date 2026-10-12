import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'

import i18n from '@/i18n'

import { resetApp } from './app'
import { removeCamera } from './camera'

vi.mock('@/components/chart/LineChart', async () => ({
  default: (await import('./chartStub')).ChartStub,
}))

// jsdom не умеет прокручивать окно, а роутер делает это при каждом переходе.
window.scrollTo = () => {}

// `findBy…` и `waitFor` по умолчанию ждут секунду — на загруженной машине экран появляется
// позже. Пять секунд втрое меньше `testTimeout`: несбывшееся ожидание по-прежнему
// показывает DOM, а не обрывается таймаутом теста.
configure({ asyncUtilTimeout: 5000 })

beforeEach(async () => {
  await i18n.changeLanguage('ru')
})

afterEach(() => {
  cleanup()
  resetApp()
  vi.unstubAllGlobals()
  removeCamera()
  vi.restoreAllMocks()
  localStorage.clear()
  window.location.hash = ''
})
