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
import { isRealDate, today } from '@/lib/dates'
import { AdminPage } from '@/pages/admin/AdminPage'
import { InvitePage } from '@/pages/auth/InvitePage'
import { LoginPage } from '@/pages/auth/LoginPage'
import { ResetPage } from '@/pages/auth/ResetPage'
import { AddFoodNewProductPage, AddFoodPage } from '@/pages/diary/AddFoodPage'
import { CopyPage } from '@/pages/diary/CopyPage'
import { DiaryPage } from '@/pages/diary/DiaryPage'
import { EntryEditPage } from '@/pages/diary/EntryEditPage'
import { GoalPage } from '@/pages/diary/GoalPage'
import { MealNewPage } from '@/pages/diary/MealNewPage'
import { HomePage } from '@/pages/HomePage'
import { MeasurementEditPage } from '@/pages/measurements/MeasurementEditPage'
import { MeasurementEntryPage } from '@/pages/measurements/MeasurementEntryPage'
import { MeasurementsPage } from '@/pages/measurements/MeasurementsPage'
import { ProductEditPage, ProductNewPage } from '@/pages/products/ProductPages'
import { ProductsPage } from '@/pages/products/ProductsPage'
import { ProfilePage } from '@/pages/profile/ProfilePage'

import { AppShell } from './AppShell'
import { AuthLayout } from './AuthLayout'
import { CrashScreen } from './CrashScreen'

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

/** День дневника из адреса; не дата — уводит на сегодня. */
function dateParam(value: string): string {
  if (isRealDate(value)) return value
  throw redirect({ to: '/diary/$date', params: { date: today() } })
}

const diaryDayRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/diary/$date',
  params: { parse: ({ date }) => ({ date: dateParam(date) }) },
  component: DiaryPage,
})

const addFoodRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/diary/$date/add/$meal',
  // `$meal` — ключ приёма пищи из списка пользователя; есть ли такой, решает экран.
  params: { parse: ({ date, meal }) => ({ date: dateParam(date), meal }) },
  // Ключ продукта, созданного по пути сюда: он показывается первым.
  validateSearch: (search: Record<string, unknown>): { product?: string } =>
    typeof search.product === 'string' ? { product: search.product } : {},
  component: AddFoodPage,
})

const addFoodNewProductRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/diary/$date/add/$meal/new',
  params: { parse: ({ date, meal }) => ({ date: dateParam(date), meal }) },
  component: AddFoodNewProductPage,
})

const mealNewRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/diary/$date/meals/new',
  params: { parse: ({ date }) => ({ date: dateParam(date) }) },
  component: MealNewPage,
})

const copyRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/diary/$date/copy/$scope',
  // Что копируется: `day` — весь день, иначе ключ приёма пищи.
  params: { parse: ({ date, scope }) => ({ date: dateParam(date), scope }) },
  component: CopyPage,
})

const entryEditRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/diary/$date/entries/$id',
  params: { parse: ({ date, id }) => ({ date: dateParam(date), id }) },
  component: EntryEditPage,
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
    createRoute({
      getParentRoute: () => appRoute,
      path: '/diary',
      beforeLoad: () => {
        throw redirect({ to: '/diary/$date', params: { date: today() } })
      },
    }),
    createRoute({ getParentRoute: () => appRoute, path: '/diary/goal', component: GoalPage }),
    diaryDayRoute,
    addFoodRoute,
    addFoodNewProductRoute,
    mealNewRoute,
    copyRoute,
    entryEditRoute,
    createRoute({ getParentRoute: () => appRoute, path: '/products', component: ProductsPage }),
    createRoute({
      getParentRoute: () => appRoute,
      path: '/products/new',
      component: ProductNewPage,
    }),
    createRoute({
      getParentRoute: () => appRoute,
      path: '/products/$id',
      component: ProductEditPage,
    }),
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
    // Без него сбой отрисовки показывает встроенный экран роутера — непереведённый и с
    // текстом исключения.
    defaultErrorComponent: CrashScreen,
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
