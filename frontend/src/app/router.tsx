import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router'

import { HomePage } from '@/pages/HomePage'

const rootRoute = createRootRoute()

const homeRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: HomePage })

export const router = createRouter({ routeTree: rootRoute.addChildren([homeRoute]) })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
