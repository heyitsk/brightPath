import { Icon } from '../Icon'
import { basisLabel, checkedDate, fmt, formatPercentile, groupLabel, num, type DataSourceYear } from './labels'

/** "Data we use": one row per published year, from GET /neet/data-sources. */
export function DataSources({ years, error }: { years: DataSourceYear[]; error: string | null }) {
  return (
    <section className="section" aria-labelledby="data-we-use">
      <div className="wrap">
        <h2 id="data-we-use">Data we use</h2>
        <p className="muted" style={{ marginTop: 10 }}>
          The official NTA documents behind every rank on this page, and when we last checked them.
        </p>
        {error ? (
          <p className="callout" role="alert">
            {error}
          </p>
        ) : years.length === 0 ? (
          <p className="callout" role="status">
            No NEET year has been published yet, so there is no data to list.
          </p>
        ) : (
          <div className="tbl-wrap" style={{ marginTop: 14 }}>
            <table>
              <thead>
                <tr>
                  <th scope="col">Year</th>
                  <th scope="col">Source</th>
                  <th scope="col">Checked</th>
                  <th scope="col">How ranks are worked out</th>
                  <th scope="col">Approximate</th>
                  <th scope="col">Qualifying cut-offs</th>
                </tr>
              </thead>
              <tbody>
                {years.map((y) => (
                  <tr key={String(y.year)}>
                    <th scope="row">{num(y.year)}</th>
                    <td>
                      {y.source.url ? (
                        <a href={y.source.url} rel="noopener noreferrer" target="_blank">
                          {y.source.title} <Icon name="ext" size={14} />
                        </a>
                      ) : (
                        y.source.title
                      )}
                      {y.source.publisher && <div className="small muted">{y.source.publisher}</div>}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>{checkedDate(y.checkedAt)}</td>
                    <td>
                      {basisLabel(y.basis)}
                      {y.methodNote && <div className="small muted">{y.methodNote}</div>}
                    </td>
                    <td>{y.approximate ? 'Yes' : 'No'}</td>
                    <td>
                      {y.cutoffs.length === 0 ? (
                        <span className="muted">None loaded</span>
                      ) : (
                        <ul className="cutoffs">
                          {y.cutoffs.map((c) => (
                            <li key={c.group}>
                              {groupLabel(c.group)}: {fmt(c.minScore)} marks ({formatPercentile(c.percentile)} pct.)
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  )
}
