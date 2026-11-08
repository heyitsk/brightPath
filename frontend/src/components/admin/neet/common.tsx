import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { checkedOn } from '../../shared/format'
import type { ExamYear } from './types'

export function StatusBadge({ status }: { status: ExamYear['status'] }) {
  return (
    <span className={status === 'PUBLISHED' ? 'adm-badge on' : 'adm-badge'}>
      {status === 'PUBLISHED' ? 'Published' : 'Draft'}
    </span>
  )
}

/** The source of a figure and when we checked it. */
export function SourceLine({ y }: { y: Pick<ExamYear, 'source' | 'checkedAt'> }) {
  const { source } = y
  return (
    <span className="hint" style={{ margin: 0 }}>
      Source:{' '}
      {source.url ? (
        <a href={source.url} rel="noreferrer noopener" target="_blank">
          {source.title}
        </a>
      ) : (
        source.title
      )}
      {source.publisher ? `, ${source.publisher}` : ''}; {checkedOn(y.checkedAt.slice(0, 10))}
    </span>
  )
}

/** Messages from the backend, shown word for word. */
export function Messages({ title, items, tone }: { title: string; items: string[]; tone?: 'problem' }) {
  if (items.length === 0) return null
  return (
    <div className="callout" role={tone === 'problem' ? 'alert' : 'status'}>
      <h3>{title}</h3>
      <ul style={{ margin: 0, paddingLeft: 20 }}>
        {items.map((m) => (
          <li key={m}>{m}</li>
        ))}
      </ul>
    </div>
  )
}

/** Heading and tabs for one year. */
export function YearNav({ year, current }: { year: string | number; current: string }) {
  const tabs = [
    { key: 'figures', label: 'Figures', to: `/admin/neet/${year}` },
    { key: 'cutoffs', label: 'Cut-offs', to: `/admin/neet/${year}/cutoffs` },
    { key: 'distribution', label: 'Score counts', to: `/admin/neet/${year}/distribution` },
    { key: 'preview', label: 'Preview', to: `/admin/neet/${year}/preview` },
    { key: 'publish', label: 'Publish', to: `/admin/neet/${year}/publish` },
  ]
  return (
    <>
      <p>
        <Link to="/admin/neet">← NEET data</Link>
      </p>
      <h1 style={{ marginTop: 0 }}>NEET {year}</h1>
      <nav aria-label="This year" className="adm-actions" style={{ margin: '0 0 20px' }}>
        {tabs.map((t) => (
          <Link
            key={t.key}
            className={t.key === current ? 'btn btn-secondary' : 'btn btn-light'}
            to={t.to}
            aria-current={t.key === current ? 'page' : undefined}
          >
            {t.label}
          </Link>
        ))}
      </nav>
    </>
  )
}

export function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <div className="tbl-wrap" style={{ marginBottom: 16 }}>
      <table>
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <th scope="row">{k}</th>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
