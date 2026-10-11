import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory } from '@tanstack/react-router'
import { render } from '@testing-library/react'

import { App } from '@/app/App'
import { appUpdate } from '@/app/appUpdate'
import { caughtErrorHandler, installErrorReporting } from '@/app/errorReporting'
import { bindSession, createAppRouter } from '@/app/router'
import { session, type User } from '@/auth/session'

import { sessionOf } from './fixtures'

// В приложении экраны подгружаются при переходе. В тестах они загружены заранее: первый
// разбор модуля занимает секунды, и ожидание экрана упиралось бы в него, а не в поведение.
import.meta.glob(['../pages/**/*.tsx', '!../pages/**/*.test.tsx'], { eager: true })

const cleanups: (() => void)[] = []

/** Состояние сессии живёт в модуле — между тестами его нужно вернуть к «не вошёл». */
export function resetApp(): void {
  for (const cleanup of cleanups.splice(0)) cleanup()
  appUpdate.reset()
  localStorage.clear()
  void session.bootstrap()
}

/**
 * Поднимает приложение целиком — с настоящим роутером и его защитой маршрутов — по адресу
 * `path`. С `user` приложение стартует вошедшим, без него — как гость.
 */
export async function renderApp(path: string, user?: User) {
  if (user) session.open(sessionOf(user))
  else await session.bootstrap()

  const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }))
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  cleanups.push(bindSession(router, queryClient), installErrorReporting(router))
  const view = render(
    <QueryClientProvider client={queryClient}>
      <App router={router} />
    </QueryClientProvider>,
    { onCaughtError: caughtErrorHandler(router) },
  )
  return { router, queryClient, ...view }
}
