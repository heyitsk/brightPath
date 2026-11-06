import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from 'react-router'
import type { Route } from './+types/root'
import { api, unwrap } from './api/client.server'
import { CoverBar } from './components/site/CoverBar'
import { SiteFooter } from './components/site/SiteFooter'
import { TabBar } from './components/site/TabBar'
import { SampleBand, TopBar } from './components/site/TopBar'
import { getNavigation } from './data/navigation'
import stylesheet from './styles/app.css?url'
import archivoLatin from './styles/fonts/archivo-latin.woff2?url'
import martianLatin from './styles/fonts/mm-latin.woff2?url'

export const links: Route.LinksFunction = () => [
  { rel: 'preload', href: archivoLatin, as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' },
  { rel: 'preload', href: martianLatin, as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' },
  { rel: 'stylesheet', href: stylesheet },
  { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
]

/**
 * Site config (brand, contact slots, finder gate size, disclaimer texts) and menu data
 * for every page. Disclaimer and regulator wording must come from /site/config, never be
 * typed into the frontend. Navigation is SAMPLE data until GET /navigation/explore exists.
 */
export async function loader() {
  let result
  const navigation = getNavigation()
  try {
    result = await api.GET('/site/config')
  } catch {
    throw Response.json(
      { code: 'API_UNREACHABLE', message: 'The site API could not be reached.' },
      { status: 503 },
    )
  }
  return {
    siteConfig: unwrap(result),
    navigation: await navigation,
    // Year for the footer copyright line, fixed on the server so hydration matches.
    year: new Date().getFullYear(),
  }
}

export type SiteConfig = Awaited<ReturnType<typeof loader>>['siteConfig']

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  )
}

export default function App() {
  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <SampleBand />
      <TopBar />
      <CoverBar />
      <main id="main">
        <Outlet />
      </main>
      <SiteFooter />
      <TabBar />
    </>
  )
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = 'Something went wrong'
  let detail = 'Please try again in a moment.'

  if (isRouteErrorResponse(error)) {
    title = error.status === 404 ? 'Page not found' : `Error ${error.status}`
    const data = error.data as { message?: string } | undefined
    if (data?.message) detail = data.message
  } else if (import.meta.env.DEV && error instanceof Error) {
    detail = error.message
  }

  return (
    <main className="wrap section">
      <h1>{title}</h1>
      <p className="lead">{detail}</p>
    </main>
  )
}
