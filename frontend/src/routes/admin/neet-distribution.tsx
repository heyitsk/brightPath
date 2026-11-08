import { useState } from 'react'
import { Form, useNavigation } from 'react-router'
import { adminApi } from '../../api/client.browser'
import { handleApiError, safeCall, type ApiFailure } from '../../api/errors'
import type { paths } from '../../api/schema'
import { FormError } from '../../components/admin/AdminFormError'
import { SectionError } from '../../components/admin/crud/SectionError'
import { showDate } from '../../components/admin/crud/util'
import { Messages, SourceLine, YearNav } from '../../components/admin/neet/common'
import { readCsvFile } from '../../components/admin/neet/csv'
import { loadYear, num } from '../../components/admin/neet/data'
import type { Route } from './+types/neet-distribution'

type Report = paths['/admin/neet/years/{year}/distribution']['put']['responses'][200]['content']['application/json']['report']

export { SectionError as ErrorBoundary }
export const handle = { admin: true }
export const meta: Route.MetaFunction = ({ params }) => [
  { title: `Score counts NEET ${params.year} | Admin` },
  { name: 'robots', content: 'noindex, nofollow' },
]

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  return { detail: await loadYear(params.year) }
}

/** "check" sends dryRun: true (nothing saved); "save" sends it for real. */
export async function clientAction({ params, request }: Route.ClientActionArgs): Promise<ApiFailure | { report: Report }> {
  const { examYear } = await loadYear(params.year)
  const form = await request.formData()
  const csv = String(form.get('csv') ?? '')
  const fileName = String(form.get('fileName') ?? '').trim()
  if (csv.trim() === '') {
    return { status: 0, formError: 'Paste the CSV text or choose a .csv file first.', fieldErrors: {} }
  }
  const result = await safeCall(
    adminApi.PUT('/admin/neet/years/{year}/distribution', {
      params: { path: { year: String(examYear.year) } },
      body: { csv, fileName: fileName || null, dryRun: form.get('intent') !== 'save' },
    }),
  )
  if ('data' in result && result.data) return { report: result.data.report }
  return handleApiError(result)
}

function ReportView({ report }: { report: Report }) {
  return (
    <section aria-label="Report" style={{ marginTop: 28 }}>
      <h2>{report.dryRun ? 'File check (nothing saved)' : 'Saved'}</h2>
      <p>
        Rank method: {report.basis.replace(/_/g, ' ').toLowerCase()}. Rank rows built: {num(report.rankRowsBuilt)}. Table
        version: {report.tableVersion}.
      </p>
      <div className="tbl-wrap" style={{ marginBottom: 16 }}>
        <table>
          <thead>
            <tr>
              <th>Group</th>
              <th>Rows</th>
              <th>Bands</th>
              <th>Candidates</th>
              <th className="hide-sm">Lowest score</th>
              <th className="hide-sm">Highest score</th>
            </tr>
          </thead>
          <tbody>
            {report.groups.map((g) => (
              <tr key={g.group}>
                <th scope="row">{g.group}</th>
                <td>{num(g.rows)}</td>
                <td>{num(g.bands)}</td>
                <td>{num(g.candidates)}</td>
                <td className="hide-sm">{num(g.lowestScore)}</td>
                <td className="hide-sm">{num(g.highestScore)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Messages title="Warnings" items={report.warnings} />
    </section>
  )
}

export default function NeetDistribution({ loaderData, actionData }: Route.ComponentProps) {
  const y = loaderData.detail.examYear
  const busy = useNavigation().state !== 'idle'
  const [csv, setCsv] = useState('')
  const [fileName, setFileName] = useState('')
  const [readError, setReadError] = useState('')
  const failure = actionData && 'formError' in actionData ? actionData : null
  const report = actionData && 'report' in actionData ? actionData.report : null

  async function onFile(file: File | undefined) {
    setReadError('')
    if (!file) return
    try {
      const read = await readCsvFile(file)
      setCsv(read.csv)
      setFileName(read.fileName)
    } catch {
      setReadError('Could not read that file.')
    }
  }

  return (
    <>
      <YearNav year={y.year} current="distribution" />
      <p>
        <SourceLine y={y} />
      </p>
      <p>
        {y.distribution
          ? `Last file: ${y.distribution.fileName ?? 'no file name'}, uploaded ${showDate(y.distribution.uploadedAt)}.`
          : 'No score counts uploaded yet.'}
      </p>
      <Messages title="Warnings" items={y.warnings} />

      {!y.rankData ? (
        <p className="callout">NTA published no score counts for this year, so there is nothing to upload.</p>
      ) : y.status === 'PUBLISHED' ? (
        <p className="callout">Only a draft year can be changed. Unpublish it first.</p>
      ) : (
        <Form method="post" className="adm-form">
          <FormError message={failure?.formError ?? (readError || undefined)} />
          {failure && Object.keys(failure.fieldErrors).length > 0 && (
            <ul className="err-msg" style={{ marginBottom: 16 }}>
              {Object.entries(failure.fieldErrors).map(([path, message]) => (
                <li key={path}>
                  {path}: {message}
                </li>
              ))}
            </ul>
          )}
          <div className="field">
            <label htmlFor="csvfile">Choose a .csv file</label>
            <input
              className="input"
              id="csvfile"
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
          </div>
          <div className="field">
            <label htmlFor="csv">Or paste the CSV text</label>
            <textarea
              className="input"
              id="csv"
              name="csv"
              rows={12}
              spellCheck={false}
              value={csv}
              onChange={(e) => setCsv(e.target.value)}
              style={{ fontFamily: 'var(--mono, monospace)' }}
            />
            <p className="hint">First line: group,score_from,score_to,candidates</p>
          </div>
          <div className="field">
            <label htmlFor="fileName">File name (for the record)</label>
            <input
              className="input"
              id="fileName"
              name="fileName"
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
            />
          </div>
          <div className="adm-actions">
            <button className="btn btn-secondary" type="submit" name="intent" value="check" disabled={busy}>
              {busy ? 'Working…' : 'Check file'}
            </button>
            <button className="btn btn-primary" type="submit" name="intent" value="save" disabled={busy}>
              Save
            </button>
          </div>
        </Form>
      )}

      {report && <ReportView report={report} />}
    </>
  )
}
