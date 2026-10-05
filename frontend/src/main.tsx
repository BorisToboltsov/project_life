// Первым: настройка zod должна выполниться до модулей, в которых создаются схемы.
import './zod-config'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'

import { App } from '@/app/App'
import { bindSession, createAppRouter } from '@/app/router'
import { session } from '@/auth/session'
import '@/i18n'
import './index.css'

registerSW({ immediate: true })

const queryClient = new QueryClient()
const router = createAppRouter()

bindSession(router, queryClient)
void session.bootstrap()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App router={router} />
    </QueryClientProvider>
  </StrictMode>,
)
