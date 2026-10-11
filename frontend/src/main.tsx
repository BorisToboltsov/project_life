// Первым: настройка zod должна выполниться до модулей, в которых создаются схемы.
import './zod-config'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'

import { App } from '@/app/App'
import { appUpdate, watchForUpdates } from '@/app/appUpdate'
import { caughtErrorHandler, installErrorReporting } from '@/app/errorReporting'
import { bindSession, createAppRouter } from '@/app/router'
import { session } from '@/auth/session'
import '@/i18n'
import './index.css'

// Новая версия не включается сама: приложение предлагает обновиться (ADR 0009).
const applyUpdate = registerSW({
  immediate: true,
  onNeedRefresh: () => appUpdate.offer(() => void applyUpdate(true)),
  onRegisteredSW: (_url, registration) => {
    if (registration) watchForUpdates(registration)
  },
})

const queryClient = new QueryClient()
const router = createAppRouter()

bindSession(router, queryClient)
installErrorReporting(router)
void session.bootstrap()

createRoot(document.getElementById('root')!, { onCaughtError: caughtErrorHandler(router) }).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App router={router} />
    </QueryClientProvider>
  </StrictMode>,
)
