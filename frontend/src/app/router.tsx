import type { QueryClient } from '@tanstack/react-query'
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Navigate,
  redirect,
  type RouterHistory,
} from '@tanstack/react-router'

import { session, type SessionState } from '@/auth/session'
import { isRealDate, today } from '@/lib/dates'

import { AppShell } from './AppShell'
import { AuthLayout } from './AuthLayout'
import { CrashScreen } from './CrashScreen'
import { ScreenLoading } from './ScreenLoading'

// Экраны подгружаются при переходе, а не вместе с рамкой приложения (инвариант I12):
// статический импорт из `@/pages` вернул бы экран в первую загрузку.
const screens = {
  login: lazyRouteComponent(() => import('@/pages/auth/LoginPage'), 'LoginPage'),
  invite: lazyRouteComponent(() => import('@/pages/auth/InvitePage'), 'InvitePage'),
  reset: lazyRouteComponent(() => import('@/pages/auth/ResetPage'), 'ResetPage'),
  home: lazyRouteComponent(() => import('@/pages/HomePage'), 'HomePage'),
  measurementEntry: lazyRouteComponent(
    () => import('@/pages/measurements/MeasurementEntryPage'),
    'MeasurementEntryPage',
  ),
  measurementsIndex: lazyRouteComponent(
    () => import('@/pages/measurements/MeasurementsIndexPage'),
    'MeasurementsIndexPage',
  ),
  measurements: lazyRouteComponent(
    () => import('@/pages/measurements/MeasurementsPage'),
    'MeasurementsPage',
  ),
  metricNew: lazyRouteComponent(
    () => import('@/pages/measurements/MetricNewPage'),
    'MetricNewPage',
  ),
  measurementEdit: lazyRouteComponent(
    () => import('@/pages/measurements/MeasurementEditPage'),
    'MeasurementEditPage',
  ),
  diary: lazyRouteComponent(() => import('@/pages/diary/DiaryPage'), 'DiaryPage'),
  statistics: lazyRouteComponent(() => import('@/pages/diary/StatisticsPage'), 'StatisticsPage'),
  goal: lazyRouteComponent(() => import('@/pages/diary/GoalPage'), 'GoalPage'),
  addFood: lazyRouteComponent(() => import('@/pages/diary/AddFoodPage'), 'AddFoodPage'),
  addFoodNewProduct: lazyRouteComponent(
    () => import('@/pages/diary/AddFoodPage'),
    'AddFoodNewProductPage',
  ),
  scan: lazyRouteComponent(() => import('@/pages/diary/ScanPage'), 'ScanPage'),
  barcode: lazyRouteComponent(() => import('@/pages/diary/BarcodePage'), 'BarcodePage'),
  mealNew: lazyRouteComponent(() => import('@/pages/diary/MealNewPage'), 'MealNewPage'),
  copy: lazyRouteComponent(() => import('@/pages/diary/CopyPage'), 'CopyPage'),
  entryEdit: lazyRouteComponent(() => import('@/pages/diary/EntryEditPage'), 'EntryEditPage'),
  products: lazyRouteComponent(() => import('@/pages/products/ProductsPage'), 'ProductsPage'),
  productNew: lazyRouteComponent(() => import('@/pages/products/ProductPages'), 'ProductNewPage'),
  productEdit: lazyRouteComponent(() => import('@/pages/products/ProductPages'), 'ProductEditPage'),
  exercises: lazyRouteComponent(() => import('@/pages/exercises/ExercisesPage'), 'ExercisesPage'),
  exercise: lazyRouteComponent(() => import('@/pages/exercises/ExercisePage'), 'ExercisePage'),
  exerciseNew: lazyRouteComponent(
    () => import('@/pages/exercises/ExerciseFormPages'),
    'ExerciseNewPage',
  ),
  exerciseEdit: lazyRouteComponent(
    () => import('@/pages/exercises/ExerciseFormPages'),
    'ExerciseEditPage',
  ),
  workouts: lazyRouteComponent(() => import('@/pages/workouts/WorkoutsPage'), 'WorkoutsPage'),
  workout: lazyRouteComponent(() => import('@/pages/workouts/WorkoutPage'), 'WorkoutPage'),
  fitnessTest: lazyRouteComponent(
    () => import('@/pages/fitness/FitnessTestPage'),
    'FitnessTestPage',
  ),
  fitnessResultNew: lazyRouteComponent(
    () => import('@/pages/fitness/FitnessResultPage'),
    'FitnessResultNewPage',
  ),
  fitnessResultEdit: lazyRouteComponent(
    () => import('@/pages/fitness/FitnessResultPage'),
    'FitnessResultEditPage',
  ),
  pressureNew: lazyRouteComponent(
    () => import('@/pages/measurements/PressureEntryPage'),
    'PressureNewPage',
  ),
  pressureEdit: lazyRouteComponent(
    () => import('@/pages/measurements/PressureEntryPage'),
    'PressureEditPage',
  ),
  labs: lazyRouteComponent(() => import('@/pages/labs/LabsPage'), 'LabsPage'),
  labAnalytes: lazyRouteComponent(() => import('@/pages/labs/LabsPage'), 'LabAnalytesPage'),
  labAnalyte: lazyRouteComponent(() => import('@/pages/labs/LabAnalytePage'), 'LabAnalytePage'),
  labReportNew: lazyRouteComponent(
    () => import('@/pages/labs/LabReportFormPage'),
    'LabReportNewPage',
  ),
  labReportEdit: lazyRouteComponent(
    () => import('@/pages/labs/LabReportFormPage'),
    'LabReportEditPage',
  ),
  labReport: lazyRouteComponent(() => import('@/pages/labs/LabReportPage'), 'LabReportPage'),
  labPicker: lazyRouteComponent(() => import('@/pages/labs/LabPickerPage'), 'LabPickerPage'),
  labOwnAnalyte: lazyRouteComponent(
    () => import('@/pages/labs/LabPickerPage'),
    'LabOwnAnalytePage',
  ),
  labValueNew: lazyRouteComponent(() => import('@/pages/labs/LabValuePage'), 'LabValueNewPage'),
  labValueEdit: lazyRouteComponent(() => import('@/pages/labs/LabValuePage'), 'LabValueEditPage'),
  more: lazyRouteComponent(() => import('@/pages/more/MorePage'), 'MorePage'),
  unsent: lazyRouteComponent(() => import('@/pages/unsent/UnsentPage'), 'UnsentPage'),
  profile: lazyRouteComponent(() => import('@/pages/profile/ProfilePage'), 'ProfilePage'),
  admin: lazyRouteComponent(() => import('@/pages/admin/AdminPage'), 'AdminPage'),
}

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

// `$metric` — ключ вида замера из списка пользователя; есть ли такой, решает экран.
const measurementsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/measurements/$metric',
  component: screens.measurements,
})

const measurementEditRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/measurements/$metric/$id',
  component: screens.measurementEdit,
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
  component: screens.diary,
})

const addFoodRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/diary/$date/add/$meal',
  // `$meal` — ключ приёма пищи из списка пользователя; есть ли такой, решает экран.
  params: { parse: ({ date, meal }) => ({ date: dateParam(date), meal }) },
  // Ключ продукта, с которым сюда пришли, — он показывается первым: `product` — созданный
  // по пути, `scanned` — найденный по штрихкоду, `picked` — выбранный в Open Food Facts.
  // `replaces` — отклонённая запись из «Не отправлено», `deferred` — отложенная запись по
  // штрихкоду: внесённое здесь заменяет их.
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    product?: string
    scanned?: string
    picked?: string
    replaces?: number
    deferred?: string
  } => ({
    ...(typeof search.product === 'string' && { product: search.product }),
    ...(typeof search.scanned === 'string' && { scanned: search.scanned }),
    ...(typeof search.picked === 'string' && { picked: search.picked }),
    ...(typeof search.replaces === 'number' && { replaces: search.replaces }),
    ...(typeof search.deferred === 'string' && { deferred: search.deferred }),
  }),
  component: screens.addFood,
})

const addFoodNewProductRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/diary/$date/add/$meal/new',
  params: { parse: ({ date, meal }) => ({ date: dateParam(date), meal }) },
  component: screens.addFoodNewProduct,
})

const scanRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/diary/$date/add/$meal/scan',
  params: { parse: ({ date, meal }) => ({ date: dateParam(date), meal }) },
  component: screens.scan,
})

// Запись по штрихкоду (ADR 0020): исправить найденный продукт или заполнить ненайденный.
const barcodeRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/diary/$date/barcode/$id',
  params: { parse: ({ date, id }) => ({ date: dateParam(date), id }) },
  component: screens.barcode,
})

const mealNewRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/diary/$date/meals/new',
  params: { parse: ({ date }) => ({ date: dateParam(date) }) },
  component: screens.mealNew,
})

const copyRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/diary/$date/copy/$scope',
  // Что копируется: `day` — весь день, иначе ключ приёма пищи.
  params: { parse: ({ date, scope }) => ({ date: dateParam(date), scope }) },
  component: screens.copy,
})

const entryEditRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/diary/$date/entries/$id',
  params: { parse: ({ date, id }) => ({ date: dateParam(date), id }) },
  component: screens.entryEdit,
})

const routeTree = rootRoute.addChildren([
  guestRoute.addChildren([
    createRoute({ getParentRoute: () => guestRoute, path: '/login', component: screens.login }),
    createRoute({ getParentRoute: () => guestRoute, path: '/invite', component: screens.invite }),
    createRoute({ getParentRoute: () => guestRoute, path: '/reset', component: screens.reset }),
  ]),
  appRoute.addChildren([
    createRoute({ getParentRoute: () => appRoute, path: '/', component: screens.home }),
    createRoute({
      getParentRoute: () => appRoute,
      path: '/measurements',
      component: screens.measurementsIndex,
    }),
    createRoute({
      getParentRoute: () => appRoute,
      path: '/measurements/new',
      component: screens.measurementEntry,
    }),
    createRoute({
      getParentRoute: () => appRoute,
      path: '/measurements/metrics/new',
      component: screens.metricNew,
    }),
    // Давление — раньше `/measurements/$metric/$id`: у вида замера ключ, а не слово.
    createRoute({
      getParentRoute: () => appRoute,
      path: '/measurements/pressure/new',
      component: screens.pressureNew,
    }),
    createRoute({
      getParentRoute: () => appRoute,
      path: '/measurements/pressure/$id',
      component: screens.pressureEdit,
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
    createRoute({ getParentRoute: () => appRoute, path: '/diary/goal', component: screens.goal }),
    createRoute({
      getParentRoute: () => appRoute,
      path: '/diary/stats',
      component: screens.statistics,
      validateSearch: (
        search: Record<string, unknown>,
      ): { date: string; period: 'week' | 'month' } => ({
        date:
          typeof search.date === 'string' &&
          isRealDate(search.date) &&
          search.date >= '1900-01-01' &&
          search.date <= '9998-12-31'
            ? search.date
            : today(session.getState().user?.timezone),
        period: search.period === 'month' ? 'month' : 'week',
      }),
    }),
    diaryDayRoute,
    addFoodRoute,
    addFoodNewProductRoute,
    scanRoute,
    barcodeRoute,
    mealNewRoute,
    copyRoute,
    entryEditRoute,
    createRoute({ getParentRoute: () => appRoute, path: '/products', component: screens.products }),
    createRoute({
      getParentRoute: () => appRoute,
      path: '/products/new',
      component: screens.productNew,
    }),
    createRoute({
      getParentRoute: () => appRoute,
      path: '/products/$id',
      component: screens.productEdit,
    }),
    createRoute({
      getParentRoute: () => appRoute,
      path: '/workouts',
      component: screens.workouts,
    }),
    createRoute({
      getParentRoute: () => appRoute,
      path: '/workouts/$id',
      component: screens.workout,
    }),
    createRoute({
      getParentRoute: () => appRoute,
      path: '/workouts/exercises',
      component: screens.exercises,
    }),
    createRoute({
      getParentRoute: () => appRoute,
      path: '/workouts/exercises/new',
      component: screens.exerciseNew,
    }),
    // `$test` — код теста; есть ли такой, решает экран.
    createRoute({
      getParentRoute: () => appRoute,
      path: '/workouts/tests/$test',
      component: screens.fitnessTest,
    }),
    createRoute({
      getParentRoute: () => appRoute,
      path: '/workouts/tests/$test/new',
      component: screens.fitnessResultNew,
    }),
    createRoute({
      getParentRoute: () => appRoute,
      path: '/workouts/tests/$test/$id',
      component: screens.fitnessResultEdit,
    }),
    // `$key` — код штатного упражнения или ключ своего; есть ли такое, решает экран.
    createRoute({
      getParentRoute: () => appRoute,
      path: '/workouts/exercises/$key',
      component: screens.exercise,
    }),
    createRoute({
      getParentRoute: () => appRoute,
      path: '/workouts/exercises/$key/edit',
      component: screens.exerciseEdit,
    }),
    createRoute({ getParentRoute: () => appRoute, path: '/labs', component: screens.labs }),
    createRoute({
      getParentRoute: () => appRoute,
      path: '/labs/analytes',
      component: screens.labAnalytes,
    }),
    // `$key` — код штатного показателя или ключ своего; есть ли такой, решает экран.
    createRoute({
      getParentRoute: () => appRoute,
      path: '/labs/analytes/$key',
      component: screens.labAnalyte,
    }),
    createRoute({
      getParentRoute: () => appRoute,
      path: '/labs/new',
      component: screens.labReportNew,
    }),
    createRoute({
      getParentRoute: () => appRoute,
      path: '/labs/$id',
      component: screens.labReport,
    }),
    createRoute({
      getParentRoute: () => appRoute,
      path: '/labs/$id/edit',
      component: screens.labReportEdit,
    }),
    createRoute({
      getParentRoute: () => appRoute,
      path: '/labs/$id/add',
      component: screens.labPicker,
    }),
    createRoute({
      getParentRoute: () => appRoute,
      path: '/labs/$id/add/own',
      component: screens.labOwnAnalyte,
    }),
    createRoute({
      getParentRoute: () => appRoute,
      path: '/labs/$id/add/$key',
      component: screens.labValueNew,
    }),
    createRoute({
      getParentRoute: () => appRoute,
      path: '/labs/$id/values/$valueId',
      component: screens.labValueEdit,
    }),
    createRoute({ getParentRoute: () => appRoute, path: '/more', component: screens.more }),
    createRoute({ getParentRoute: () => appRoute, path: '/unsent', component: screens.unsent }),
    createRoute({ getParentRoute: () => appRoute, path: '/profile', component: screens.profile }),
    createRoute({
      getParentRoute: () => appRoute,
      path: '/admin',
      component: screens.admin,
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
    defaultPendingComponent: ScreenLoading,
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
