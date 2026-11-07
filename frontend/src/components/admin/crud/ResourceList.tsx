import { Form, Link } from 'react-router'
import type { Opt, ResourceConfig, Row } from './types'

const SAVED: Record<string, string> = { created: 'created', updated: 'saved', deleted: 'deleted' }

/** List page: heading, success message, filters, table, paging. */
export function ResourceList(props: {
  cfg: ResourceConfig
  items: Row[]
  nextCursor: string | null
  saved: string | null
  query: Record<string, string>
}) {
  const { cfg, items, nextCursor, saved, query } = props
  const base = `/admin/${cfg.key}`
  const keep = new URLSearchParams()
  for (const f of cfg.filters) if (query[f.name]) keep.set(f.name, query[f.name])
  const link = (cursor?: string) => {
    const p = new URLSearchParams(keep)
    if (cursor) p.set('cursor', cursor)
    const qs = p.toString()
    return qs ? `${base}?${qs}` : base
  }

  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'space-between' }}>
        <h1 style={{ margin: 0 }}>{cfg.title}</h1>
        <Link className="btn btn-primary" to={`${base}/new`}>
          New {cfg.singular}
        </Link>
      </div>

      {saved && SAVED[saved] && (
        <p className="callout" role="status" style={{ margin: '16px 0 0' }}>
          {cfg.singular[0].toUpperCase() + cfg.singular.slice(1)} {SAVED[saved]}.
        </p>
      )}

      {cfg.filters.length > 0 && (
        <Form method="get" className="adm-filters">
          {cfg.filters.map((f) => (
            <div className="field" key={f.name}>
              <label htmlFor={`f-${f.name}`}>{f.label}</label>
              {f.kind === 'select' ? (
                <select className="select" id={`f-${f.name}`} name={f.name} defaultValue={query[f.name] ?? ''}>
                  <option value="">Any</option>
                  {(f.options as Opt[]).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input className="input" id={`f-${f.name}`} name={f.name} defaultValue={query[f.name] ?? ''} />
              )}
            </div>
          ))}
          <button className="btn btn-secondary" type="submit">
            Filter
          </button>
          {keep.size > 0 && (
            <Link className="btn btn-light" to={base}>
              Clear
            </Link>
          )}
        </Form>
      )}

      {items.length === 0 ? (
        <p style={{ marginTop: 24 }}>
          {keep.size > 0 ? 'No rows match these filters.' : `No ${/^[A-Z]{2}/.test(cfg.title) ? cfg.title : cfg.title.toLowerCase()} yet. Add the first one.`}
        </p>
      ) : (
        <div className="tbl-wrap" style={{ marginTop: 16 }}>
          <table>
            <thead>
              <tr>
                {cfg.columns.map((c) => (
                  <th key={c.header} className={c.hideSm ? 'hide-sm' : undefined}>
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.id}>
                  {cfg.columns.map((c) => (
                    <td key={c.header} className={c.hideSm ? 'hide-sm' : undefined}>
                      {c.primary ? <Link to={`${base}/${row.id}`}>{c.cell(row)}</Link> : c.cell(row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(query.cursor || nextCursor) && (
        <p className="adm-pager">
          {query.cursor && <Link to={link()}>First page</Link>}
          {nextCursor && <Link to={link(nextCursor)}>Next page</Link>}
        </p>
      )}
    </>
  )
}
