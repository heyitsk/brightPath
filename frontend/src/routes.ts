import { index, route, type RouteConfig } from '@react-router/dev/routes'

export default [
  index('routes/home.tsx'),
  route('colleges/:slug', 'routes/college.tsx'),
  route('mbbs-abroad/:country', 'routes/country.tsx'),
  route('neet-counselling/:state', 'routes/state.tsx'),
  // Admin: client-only (clientLoader/clientAction), never server rendered beyond the fallback.
  route('admin/login', 'routes/admin/login.tsx'),
  route('admin/logout', 'routes/admin/logout.tsx'),
  route('admin', 'routes/admin/layout.tsx', [
    index('routes/admin/home.tsx'),
    route('change-password', 'routes/admin/change-password.tsx'),
    // One set of pages for every CRUD section (states, countries, sources, nmc-notices).
    route(':section', 'routes/admin/section-list.tsx'),
    route(':section/new', 'routes/admin/section-new.tsx'),
    route(':section/:id', 'routes/admin/section-edit.tsx'),
    route(':section/:id/delete', 'routes/admin/section-delete.tsx'),
  ]),
] satisfies RouteConfig
