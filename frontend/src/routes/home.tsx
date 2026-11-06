import { useRouteLoaderData } from 'react-router'
import type { loader as rootLoader } from '../root'
import type { Route } from './+types/home'

/*
  Foundation proof page: shows that fonts, v3 tokens, component styles and the
  server-rendered /site/config work. It will be replaced by the real home (01-home).
*/

export const meta: Route.MetaFunction = () => [{ title: 'Foundation check' }]

const swatches = [
  ['paper', 'bg-paper'],
  ['sheet', 'bg-sheet'],
  ['cover', 'bg-cover'],
  ['foil', 'bg-foil'],
  ['violet', 'bg-violet'],
  ['green', 'bg-green'],
  ['red', 'bg-red'],
  ['action', 'bg-action'],
] as const

export default function Home() {
  const root = useRouteLoaderData<typeof rootLoader>('root')
  const config = root?.siteConfig
  const notGuaranteed = config?.disclaimers.NOT_GUARANTEED

  return (
    <main>
      <section className="wrap section">
        <p className="mono muted">{config?.brand.name ?? '[Brand name]'} · frontend foundation</p>
        <h1>Fonts, tokens and site config</h1>
        <p className="lead">
          Archivo carries the hierarchy through its width axis. Martian Mono is for printed data.
        </p>
        <h2>Headline, width 88</h2>
        <h3>Title, width 92</h3>
        <p className="mono">checked 07 Nov 2026 · NEET UG 2026 · 1,23,456</p>
      </section>

      <hr className="perf" />

      <section className="wrap section">
        <ul className="flex flex-wrap gap-3 p-0 m-0 list-none" aria-label="Colour tokens">
          {swatches.map(([name, bg]) => (
            <li key={name} className="flex items-center gap-2">
              <span className={`${bg} inline-block size-8 rounded-sm border border-line`} />
              <span className="mono">--{name}</span>
            </li>
          ))}
        </ul>

        <div className="visa security mt-8 max-w-[560px]">
          <div className="visa-head">
            <h2>Visa panel</h2>
            <span className="mono">components.css</span>
          </div>
          <div className="marks mb-4">
            <span className="mark green">Listed in WDOMS</span>
            <span className="mark">Meets NMC 2021 rules</span>
            <span className="mark red">NMC alert</span>
            <span className="mark navy">Recognised by NMC</span>
            <span className="mark grey">No NMC alert found</span>
          </div>
          <div className="flex flex-wrap gap-3 items-center">
            <button type="button" className="btn btn-primary">Primary</button>
            <button type="button" className="btn btn-secondary">Secondary</button>
            <span className="stamp" aria-hidden="true">
              Official NTA data<span className="d">checked 07 Nov 2026</span>
            </span>
          </div>
        </div>
      </section>

      <section className="wrap pb-12">
        <h2 className="mb-4">Disclaimer from GET /site/config</h2>
        {notGuaranteed ? (
          <div className="estimate" role="note">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 16v-4M12 8h.01" />
            </svg>
            <p className="m-0">
              <strong>Estimate, not a guarantee.</strong> {notGuaranteed.text}
            </p>
          </div>
        ) : (
          <p className="err-msg" role="alert">
            NOT_GUARANTEED is missing from /site/config.
          </p>
        )}
        {notGuaranteed && (
          <p className="mono muted mt-2">NOT_GUARANTEED · version {notGuaranteed.version}</p>
        )}
      </section>
    </main>
  )
}
