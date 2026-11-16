import { formatNumber } from '../../shared/format'
import { ACTION_LABEL, n, STATUS_LABEL } from './data'
import type { Action, Batch, Counts, PreviewItem } from './types'

export function ImportStatusBadge({ status }: { status: Batch['status'] }) {
  const tone = status === 'COMMITTED' ? 'adm-badge on' : status === 'FAILED' ? 'adm-badge off' : 'adm-badge'
  return <span className={tone}>{STATUS_LABEL[status]}</span>
}

function ActionBadge({ action }: { action: Action }) {
  const tone = action === 'ERROR' ? 'adm-badge off' : action === 'CREATE' || action === 'UPDATE' ? 'adm-badge on' : 'adm-badge'
  return <span className={tone}>{ACTION_LABEL[action]}</span>
}

/** The headline numbers, shown before any row. */
export function Totals({ counts, warnings }: { counts: Counts; warnings: number | null }) {
  const tiles: [string, number][] = [
    ['New', n(counts.CREATE)],
    ['Updated', n(counts.UPDATE)],
    ['Unchanged', n(counts.UNCHANGED)],
  ]
  if (n(counts.SKIP) > 0) tiles.push(['Skipped', n(counts.SKIP)])
  tiles.push(['Errors', n(counts.ERROR)])
  if (warnings !== null) tiles.push(['Warnings', warnings])
  return (
    <div className="tbl-wrap" style={{ marginBottom: 16 }}>
      <table>
        <thead>
          <tr>
            {tiles.map(([label]) => (
              <th key={label} scope="col">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            {tiles.map(([label, value]) => (
              <td key={label} style={{ fontSize: '1.25rem', fontWeight: 700 }}>
                {formatNumber(value)}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  )
}

const shown = (v: string | null) => (v === null || v === '' ? '—' : v)

/** Each row with its plain-words message; UPDATE rows list every old → new value. */
export function RowTable({ rows }: { rows: PreviewItem[] }) {
  return (
    <div className="tbl-wrap">
      <table>
        <thead>
          <tr>
            <th scope="col">Row</th>
            <th scope="col">Result</th>
            <th scope="col">What</th>
            <th scope="col">Details</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${n(r.line)}-${r.label}`}>
              <td>{formatNumber(n(r.line))}</td>
              <td>
                <ActionBadge action={r.action} />
              </td>
              <td>
                {r.label}
                {r.detail && <div className="hint" style={{ margin: 0 }}>{r.detail}</div>}
              </td>
              <td>
                {r.message && (
                  <p className={r.action === 'ERROR' ? 'err-msg' : undefined} style={{ margin: 0 }}>
                    {r.message}
                  </p>
                )}
                {r.changes.length > 0 && (
                  <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
                    {r.changes.map((c) => (
                      <li key={c.field}>
                        {c.field}: {shown(c.current)} → <strong>{shown(c.uploaded)}</strong>
                      </li>
                    ))}
                  </ul>
                )}
                {r.warnings.length > 0 && (
                  <ul className="hint" style={{ margin: '4px 0 0', paddingLeft: 20 }}>
                    {r.warnings.map((w) => (
                      <li key={w}>Warning: {w}</li>
                    ))}
                  </ul>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
