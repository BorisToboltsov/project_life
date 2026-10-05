import type { QueryClient } from '@tanstack/react-query'
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Navigate,
  redirect,
  type RouterHistory,
} from '@tanstack/react-router'

import { type Metric, METRICS } from '@/api/measurements'
import { session, type SessionState } from '@/auth/session'
import { AdminPage } from '@/pages/admin/AdminPage'
import { InvitePage } from '@/pages/auth/InvitePage'
import { LoginPage } from '@/pages/auth/LoginPage'
import { ResetPage } from '@/pages/auth/ResetPage'
import { HomePage } from '@/pages/HomePage'
import { MeasurementEditPage } from '@/pages/measurements/MeasurementEditPage'
import { MeasurementEntryPage } from '@/pages/measurements/MeasurementEntryPage'
import { MeasurementsPage } from '@/pages/measurements/MeasurementsPage'
import { ProfilePage } from '@/pages/profile/ProfilePage'

import { AppShell } from './AppShell'
import { AuthLayout } from './AuthLayout'

interface RouterContext {
  session: SessionState
}

const rootRoute = createRootRouteWithContext<RouterContext>()()

// Экраны до входа. Вошедшему пользователю они не нужны — его уводит на главную.
const guestRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'guest',
  component: AuthLayout,
  beforeLoad: ({ context }) => {
    if (context.session.user) throw redirect({ to: '/' })
  },
})

// Всё приложение. Без входа сюда не попасть — отправляет на экран входа.
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  component: AppShell,
  beforeLoad: ({ context }) => {
    if (!context.session.user) throw redirect({ to: '/login' })
  },
})

/** Показатель из адреса; незнакомое значение уводит на вес. */
function metricParam(value: string): Metric {
  if (METRICS.includes(value as Metric)) return value as Metric
  throw redirect({ to: '/measurements/$metric', params: { metric: 'weight' } })
}

const measurementsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/measurements/$metric',
  params: { parse: ({ metric }) => ({ metric: metricParam(metric) }) },
  component: MeasurementsPage,
})

const measurementEditRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/measurements/$metric/$id',
  params: { parse: ({ metric, id }) => ({ metric: metricParam(metric), id }) },
  component: MeasurementEditPage,
})

const routeTree = rootRoute.addChildren([
  guestRoute.addChildren([
    createRoute({ getParentRoute: () => guestRoute, path: '/login', component: LoginPage }),
    createRoute({ getParentRoute: () => guestRoute, path: '/invite', component: InvitePage }),
    createRoute({ getParentRoute: () => guestRoute, path: '/reset', component: ResetPage }),
  ]),
  appRoute.addChildren([
    createRoute({ getParentRoute: () => appRoute, path: '/', component: HomePage }),
    createRoute({
      getParentRoute: () => appRoute,
      path: '/measurements',
      beforeLoad: () => {
        throw redirect({ to: '/measurements/$metric', params: { metric: 'weight' } })
      },
    }),
    createRoute({
      getParentRoute: () => appRoute,
      path: '/measurements/new',
      component: MeasurementEntryPage,
    }),
    measurementsRoute,
    measurementEditRoute,
    createRoute({ getParentRoute: () => appRoute, path: '/profile', component: ProfilePage }),
    createRoute({
      getParentRoute: () => appRoute,
      path: '/admin',
      component: AdminPage,
      // Сервер всё равно ответит 403; это лишь чтобы не показывать пустой экран.
      beforeLoad: ({ context }) => {
        if (context.session.user?.role !== 'admin') throw redirect({ to: '/' })
      },
    }),
  ]),
])

export function createAppRouter(history?: RouterHistory) {
  return createRouter({
    routeTree,
    history,
    context: { session: { status: 'loading', user: null } },
    defaultNotFoundComponent: () => <Navigate to="/" />,
  })
}

export type AppRouter = ReturnType<typeof createAppRouter>

/**
 * Связывает роутер и кэш запросов с сессией. Возвращает функцию отписки.
 *
 * - Вход и выход меняют то, какие маршруты доступны: роутер получает новое состояние
 *   и заново запускает защитные проверки.
 * - Кэш запросов принадлежит одному пользователю: при смене пользователя он очищается,
 *   чтобы следующий вошедший на этом устройстве не увидел чужие данные.
 */
export function bindSession(router: AppRouter, queryClient: QueryClient): () => void {
  let cachedFor = session.getState().user?.id
  const sync = () => {
    const state = session.getState()
    if (state.status === 'loading') return
    const previous = cachedFor
    cachedFor = state.user?.id
    router.update({ ...router.options, context: { session: state } })
    // Кэш чистится после того, как роутер увёл с прежних экранов: иначе они, ещё не
    // размонтированные, тут же перезапросили бы данные уже без прав. Вход гостя кэш не
    // трогает — до входа в нём нет ничего чужого.
    const userLeft = previous !== undefined && previous !== cachedFor
    void router.invalidate().then(() => {
      if (userLeft) queryClient.clear()
    })
  }
  sync()
  return session.subscribe(sync)
}
