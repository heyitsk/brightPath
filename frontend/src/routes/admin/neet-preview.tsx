import { Form, useNavigation } from 'react-router'
import { adminApi } from '../../api/client.browser'
import { handleApiError, safeCall } from '../../api/errors'
import type { paths } from '../../api/schema'
import { FormError } from '../../components/admin/AdminFormError'
import { SectionError } from '../../components/admin/crud/SectionError'
import { Facts, SourceLine, YearNav } from '../../components/admin/neet/common'
import { loadYear, num } from '../../components/admin/neet/data'
import type { Route } from './+types/neet-preview'

type Preview = paths['/admin/neet/years/{year}/preview']['get']['responses'][200]['content']['application/json']
type Category = 'GENERAL' | 'EWS' | 'OBC' | 'SC' | 'ST'
type Range = { from: string | number; to: string | number } | null

const CATEGORIES: Category[] = ['GENERAL', 'EWS', 'OBC', 'SC', 'ST']

export { SectionError as ErrorBoundary }
export const handle = { admin: true }
export const meta: Route.MetaFunction = ({ params }) => [
  { title: `Preview NEET ${params.year} | Admin` },
  { name: 'robots', content: 'noindex, nofollow' },
]

/** The answer is looked up on load, from the form's query string (GET form). */
export async function clientLoader({ params, request }: Route.ClientLoaderArgs) {
  const { examYear } = await loadYear(params.year)
  const q = new URL(request.url).searchParams
  const score = q.get('score') ?? ''
  const category = CATEGORIES.find((c) => c === q.get('category')) ?? 'GENERAL'
  const pwd = q.get('pwd') === 'on'
  if (score.trim() === '') return { examYear, score, category, pwd, preview: null, failure: null }

  const result = await safeCall(
    adminApi.GET('/admin/neet/years/{year}/preview', {
      params: { path: { year: String(examYear.year) }, query: { score: Number(score), category, pwd } },
    }),
  )
  if ('data' in result && result.data) return { examYear, score, category, pwd, preview: result.data as Preview, failure: null }
  return { examYear, score, category, pwd, preview: null, failure: handleApiError(result) }
}

function range(r: Range) {
  if (!r) return '-'
  return String(r.from) === String(r.to) ? num(r.from) : `${num(r.from)} to ${num(r.to)}`
}

export default function NeetPreview({ loaderData }: Route.ComponentProps) {
  const { examYear: y, score, category, pwd, preview, failure } = loaderData
  const busy = useNavigation().state !== 'idle'
  const r = preview?.result
  return (
    <>
      <YearNav year={y.year} current="preview" />
      <p className="hint">Shows the answer for this year, including a draft.</p>
      <Form method="get" className="adm-form">
        <FormError message={failure?.formError} />
        <div className={failure?.fieldErrors.score ? 'field err' : 'field'}>
          <label htmlFor="score">Score</label>
          <input className="input" id="score" name="score" type="number" step="1" inputMode="numeric" required defaultValue={score} />
          {failure?.fieldErrors.score && <p className="err-msg">{failure.fieldErrors.score}</p>}
        </div>
        <div className="field">
          <label htmlFor="category">Category</label>
          <select className="select" id="category" name="category" defaultValue={category}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="check" htmlFor="pwd">
            <input type="checkbox" id="pwd" name="pwd" defaultChecked={pwd} />
            <span>Person with disability (PwD)</span>
          </label>
        </div>
        <div className="adm-actions">
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? 'Checking…' : 'Show answer'}
          </button>
        </div>
      </Form>

      {preview && r && (
        <section aria-label="Answer" style={{ marginTop: 28 }}>
          <h2>
            Score {num(r.score)}, {r.category}
            {r.pwd ? ', PwD' : ''}
          </h2>
          <Facts
            rows={[
              ['Outcome', r.outcome.replace(/_/g, ' ').toLowerCase()],
              [
                'Qualifies',
                r.qualification.qualified == null ? 'Cannot say (no cut-off loaded)' : r.qualification.qualified ? 'Yes' : 'No',
              ],
              ['Cut-off score', num(r.qualification.cutoffScore)],
              ['Cut-off percentile', r.qualification.cutoffPercentile ?? '-'],
              ['Cut-off group used', r.qualification.appliedGroup ?? '-'],
              ['All-India rank', range(r.allIndiaRank)],
              ['Category rank', range(r.categoryRank)],
              ['PwD rank', range(r.pwdRank)],
              ['Possible rank span', range(r.possibleRankSpan)],
              ['Percentile', r.percentile ?? '-'],
              ['Students ahead', num(r.studentsAhead)],
              ['Students who appeared', num(r.studentsAppeared)],
              ['Students with the same score', num(r.studentsWithSameScore)],
              ['Estimated from a score range', r.approximate ? 'Yes' : 'No'],
              ['Rank method', r.basis ? r.basis.replace(/_/g, ' ').toLowerCase() : '-'],
              ['Rank table version', r.tableVersion ?? '-'],
              ['Source and check', <SourceLine key="s" y={{ source: { ...y.source, title: r.source.title, publisher: r.source.publisher, url: r.source.url }, checkedAt: y.checkedAt }} />],
            ]}
          />
          {r.explanation.length > 0 && (
            <div className="callout">
              <ul style={{ margin: 0, paddingLeft: 20 }}>
                {r.explanation.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          )}
          {preview.otherYears.length > 0 && (
            <>
              <h3>Other years</h3>
              <div className="tbl-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Year</th>
                      <th>Outcome</th>
                      <th>All-India rank</th>
                      <th className="hide-sm">Rank method</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.otherYears.map((o) => (
                      <tr key={String(o.year)}>
                        <td>{o.year}</td>
                        <td>{o.outcome.replace(/_/g, ' ').toLowerCase()}</td>
                        <td>
                          {range(o.allIndiaRank)}
                          {o.approximate ? ' (estimated)' : ''}
                        </td>
                        <td className="hide-sm">{o.basis ? o.basis.replace(/_/g, ' ').toLowerCase() : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <p className="hint" style={{ marginTop: 16 }}>
            {preview.meta.disclaimer.text}
          </p>
        </section>
      )}
    </>
  )
}
