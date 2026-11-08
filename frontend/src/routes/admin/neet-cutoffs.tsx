import { Form, useNavigation } from 'react-router'
import { adminApi } from '../../api/client.browser'
import { handleApiError, safeCall, type ApiFailure } from '../../api/errors'
import type { paths } from '../../api/schema'
import { FormError } from '../../components/admin/AdminFormError'
import { SectionError } from '../../components/admin/crud/SectionError'
import type { ReqBody } from '../../components/admin/crud/types'
import { SourceLine, YearNav } from '../../components/admin/neet/common'
import { loadYear } from '../../components/admin/neet/data'
import { Flash } from '../../components/admin/staff/common'
import type { Route } from './+types/neet-cutoffs'

type Body = ReqBody<paths['/admin/neet/years/{year}/cutoffs']['put']>
type Group = Body['cutoffs'][number]['group']

const GROUPS: Group[] = ['GENERAL', 'EWS', 'OBC', 'SC', 'ST', 'PWD']

export { SectionError as ErrorBoundary }
export const handle = { admin: true }
export const meta: Route.MetaFunction = ({ params }) => [
  { title: `Cut-offs NEET ${params.year} | Admin` },
  { name: 'robots', content: 'noindex, nofollow' },
]

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  return { detail: await loadYear(params.year) }
}

type Failure = ApiFailure & { rowErrors: Record<string, string> }

/** A row with both boxes empty is left out. The API replaces all cut-offs with what is sent. */
export async function clientAction({ params, request }: Route.ClientActionArgs): Promise<Failure | { saved: true }> {
  const { examYear } = await loadYear(params.year)
  const form = await request.formData()
  const cutoffs: Body['cutoffs'] = []
  for (const group of GROUPS) {
    const percentile = String(form.get(`percentile-${group}`) ?? '').trim()
    const minScore = String(form.get(`minScore-${group}`) ?? '').trim()
    if (percentile === '' && minScore === '') continue
    cutoffs.push({ group, percentile: Number(percentile), minScore: Number(minScore) })
  }
  const result = await safeCall(
    adminApi.PUT('/admin/neet/years/{year}/cutoffs', { params: { path: { year: String(examYear.year) } }, body: { cutoffs } }),
  )
  if (result.response.ok) return { saved: true }
  // Error paths look like "cutoffs.2.minScore": index into what was sent.
  const failure = handleApiError(result)
  const rowErrors: Record<string, string> = {}
  for (const [path, message] of Object.entries(failure.fieldErrors)) {
    const m = /^cutoffs\.(\d+)/.exec(path)
    const group = m ? cutoffs[Number(m[1])]?.group : undefined
    rowErrors[group ?? path] ??= message
  }
  return { ...failure, rowErrors }
}

export default function NeetCutoffs({ loaderData, actionData }: Route.ComponentProps) {
  const y = loaderData.detail.examYear
  const busy = useNavigation().state !== 'idle'
  const failure = actionData && 'rowErrors' in actionData ? actionData : null
  const saved = actionData && 'saved' in actionData
  const byGroup = new Map(y.cutoffs.map((c) => [c.group, c]))
  const unmatched = failure ? Object.entries(failure.rowErrors).filter(([k]) => !GROUPS.includes(k as Group)) : []
  return (
    <>
      <YearNav year={y.year} current="cutoffs" />
      {saved && <Flash>Cut-offs saved.</Flash>}
      <p className="hint">
        One row per group. Leave both boxes empty to leave a group out. Saving replaces all cut-offs for this year.
      </p>
      <p>
        <SourceLine y={y} />
      </p>
      {y.status === 'PUBLISHED' ? (
        <p className="callout">Only a draft year can be changed. Unpublish it first.</p>
      ) : (
        <Form method="post" className="adm-form">
          <FormError message={failure?.formError} />
          {unmatched.length > 0 && (
            <ul className="err-msg">
              {unmatched.map(([path, message]) => (
                <li key={path}>
                  {path}: {message}
                </li>
              ))}
            </ul>
          )}
          <div className="tbl-wrap" style={{ marginBottom: 16 }}>
            <table>
              <thead>
                <tr>
                  <th>Group</th>
                  <th>Percentile</th>
                  <th>Minimum score</th>
                </tr>
              </thead>
              <tbody>
                {GROUPS.map((g) => {
                  const cur = byGroup.get(g)
                  const err = failure?.rowErrors[g]
                  return (
                    <tr key={g}>
                      <th scope="row">{g}</th>
                      <td>
                        <input
                          className="input"
                          name={`percentile-${g}`}
                          aria-label={`${g} percentile`}
                          type="number"
                          step="any"
                          inputMode="decimal"
                          defaultValue={cur ? String(cur.percentile) : ''}
                          aria-invalid={err ? true : undefined}
                        />
                      </td>
                      <td>
                        <input
                          className="input"
                          name={`minScore-${g}`}
                          aria-label={`${g} minimum score`}
                          type="number"
                          step="1"
                          inputMode="numeric"
                          defaultValue={cur ? String(cur.minScore) : ''}
                          aria-invalid={err ? true : undefined}
                        />
                        {err && <p className="err-msg">{err}</p>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="adm-actions">
            <button className="btn btn-primary" type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Save cut-offs'}
            </button>
          </div>
        </Form>
      )}
    </>
  )
}
