import { index, route, type RouteConfig } from '@react-router/dev/routes'

export default [
  index('routes/home.tsx'),
  route('neet-rank-predictor', 'routes/rank-predictor.tsx'),
  route('colleges/:slug', 'routes/college.tsx'),
  route('mbbs-abroad/:country', 'routes/country.tsx'),
  route('neet-counselling/:state', 'routes/state.tsx'),
  // Admin: client-only (clientLoader/clientAction), never server rendered beyond the fallback.
  route('admin/login', 'routes/admin/login.tsx'),
  route('admin/logout', 'routes/admin/logout.tsx'),
  route('admin', 'routes/admin/layout.tsx', [
    index('routes/admin/home.tsx'),
    route('change-password', 'routes/admin/change-password.tsx'),
    // ADMIN-only sections. Static paths rank above ':section' below.
    route('users', 'routes/admin/users.tsx'),
    route('users/new', 'routes/admin/users-new.tsx'),
    route('users/:id', 'routes/admin/users-edit.tsx'),
    route('users/:id/status', 'routes/admin/users-status.tsx'),
    route('users/:id/reset-password', 'routes/admin/users-reset.tsx'),
    route('settings', 'routes/admin/settings.tsx'),
    route('settings/:key', 'routes/admin/settings-edit.tsx'),
    route('disclaimers', 'routes/admin/disclaimers.tsx'),
    route('disclaimers/:key', 'routes/admin/disclaimers-edit.tsx'),
    route('audit-logs', 'routes/admin/audit-logs.tsx'),
    route('neet', 'routes/admin/neet-years.tsx'),
    route('neet/new', 'routes/admin/neet-new.tsx'),
    route('neet/:year', 'routes/admin/neet-year.tsx'),
    route('neet/:year/delete', 'routes/admin/neet-delete.tsx'),
    route('neet/:year/cutoffs', 'routes/admin/neet-cutoffs.tsx'),
    route('neet/:year/distribution', 'routes/admin/neet-distribution.tsx'),
    route('neet/:year/preview', 'routes/admin/neet-preview.tsx'),
    route('neet/:year/publish', 'routes/admin/neet-publish.tsx'),
    // One set of pages for every CRUD section (states, countries, sources, nmc-notices).
    route(':section', 'routes/admin/section-list.tsx'),
    route(':section/new', 'routes/admin/section-new.tsx'),
    route(':section/:id', 'routes/admin/section-edit.tsx'),
    route(':section/:id/delete', 'routes/admin/section-delete.tsx'),
  ]),
] satisfies RouteConfig
