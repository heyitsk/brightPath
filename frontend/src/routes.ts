import { index, route, type RouteConfig } from '@react-router/dev/routes'

export default [
  index('routes/home.tsx'),
  route('colleges/:slug', 'routes/college.tsx'),
  route('mbbs-abroad/:country', 'routes/country.tsx'),
  route('neet-counselling/:state', 'routes/state.tsx'),
] satisfies RouteConfig
