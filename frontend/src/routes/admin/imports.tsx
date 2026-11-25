import { useState } from 'react'
import {
  Form,
  Link,
  redirect,
  useFetcher,
  useNavigation,
  useRouteLoaderData,
  type ShouldRevalidateFunction,
} from 'react-router'
import { adminApi } from '../../api/client.browser'
import { handleApiError, safeCall, type ApiFailure } from '../../api/errors'
import { FormError } from '../../components/admin/AdminFormError'
import { loadOrThrow } from '../../components/admin/crud/runtime'
import { SectionError } from '../../components/admin/crud/SectionError'
import { ImportStatusBadge } from '../../components/admin/imports/components'
import { countsLine, downloadTemplate, KIND_LABEL, KINDS, when, whoLabel } from '../../components/admin/imports/data'
import type { Batch, BatchList, Detail, UploadKind } from '../../components/admin/imports/types'
import { Flash, PageHead } from '../../components/admin/staff/common'
import type { Route } from './+types/imports'
import type { clientLoader as layoutLoader } from './layout'

export { SectionError as ErrorBoundary }
export const handle = { admin: true }
export const meta: Route.MetaFunction = () => [
  { title: 'Bulk upload | Admin' },
  { name: 'robots', content: 'noindex, nofollow' },
]

const LIST_PAGE = 50
const isKind = (v: unknown): v is UploadKind => v === 'COLLEGES' || v === 'FEES'

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const sp = new URL(request.url).searchParams
  const cursor = sp.get('cursor') || undefined
  const list = await loadOrThrow<BatchList>(
    adminApi.GET('/admin/imports', { params: { query: { limit: LIST_PAGE, cursor } } }),
  )
  return { list, discarded: sp.get('discarded') === '1' }
}

/** A template download changes nothing, so the list need not reload. */
export const shouldRevalidate: ShouldRevalidateFunction = ({ formData, defaultShouldRevalidate }) =>
  formData?.get('intent') === 'template' ? false : defaultShouldRevalidate

type Failed = { intent: 'template' | 'upload'; failure: ApiFailure }

export async function clientAction({ request }: Route.ClientActionArgs): Promise<Failed | null> {
  const form = await request.formData()
  const intent = form.get('intent')
  const kind = form.get('kind')

  if (intent === 'template') {
    if (!isKind(kind)) return null
    const failure = await downloadTemplate(kind)
    return failure ? { intent, failure } : null
  }

  const file = form.get('file')
  const fail = (fieldErrors: Record<string, string>, formError = ''): Failed => ({
    intent: 'upload',
    failure: { status: 422, formError, fieldErrors },
  })
  if (!isKind(kind)) return fail({ kind: 'Choose what the file contains.' })
  if (!(file instanceof File) || file.size === 0) {
    return fail({ file: file instanceof File && file.name ? 'The file is empty.' : 'Choose a file to upload.' })
  }

  const body = new FormData()
  body.append('file', file, file.name)
  const result = await safeCall(
    adminApi.POST('/admin/imports', {
      params: { query: { kind } },
      // The spec types the file as a string; the real body is multipart form data.
      body: { file: '' },
      bodySerializer: () => body,
    }),
  )
  const data = (result as { data?: Pick<Detail, 'batch'> }).data
  if (result.response.ok && data) throw redirect(`/admin/imports/${data.batch.id}`)
  const failure = handleApiError(result)
  // File-level problems name the file; say it once, under the input.
  const formError = failure.fieldErrors.file && Object.keys(failure.fieldErrors).length === 1 ? '' : failure.formError
  return { intent: 'upload', failure: { ...failure, formError } }
}

export default function Imports({ loaderData, actionData }: Route.ComponentProps) {
  const { list, discarded } = loaderData
  return (
    <>
      <PageHead title="Bulk upload" />
      <p className="hint" style={{ marginTop: 8 }}>
        Add or update many colleges or fees from one Excel (.xlsx) or CSV file. Uploading only shows a preview: nothing
        changes on the site until you press Save on the next page. Up to 1 MB and 5,000 rows.
      </p>
      {discarded && <Flash>The upload was discarded. Nothing was changed.</Flash>}

      <Templates />
      <UploadForm failure={actionData?.intent === 'upload' ? actionData.failure : undefined} />

      <h2 style={{ marginTop: 32 }}>Uploads</h2>
      {list.items.length === 0 ? (
        <p>No uploads yet.</p>
      ) : (
        <UploadList first={list.items} firstCursor={list.nextCursor} />
      )}
    </>
  )
}

function Templates() {
  const fetcher = useFetcher<typeof clientAction>()
  const busy = fetcher.state !== 'idle'
  const shownFailure = fetcher.data?.failure
  return (
    <section style={{ marginTop: 24 }}>
      <h2 style={{ marginTop: 0 }}>Templates</h2>
      <p className="hint">The expected column headings with two example rows. Delete the examples before uploading.</p>
      <FormError message={shownFailure?.formError} />
      <fetcher.Form method="post" className="adm-actions">
        <input type="hidden" name="intent" value="template" />
        {KINDS.map((k) => (
          <button key={k.value} className="btn btn-secondary" type="submit" name="kind" value={k.value} disabled={busy}>
            Download {k.label.toLowerCase()} template
          </button>
        ))}
      </fetcher.Form>
    </section>
  )
}

function UploadForm({ failure }: { failure?: ApiFailure }) {
  const navigation = useNavigation()
  const busy = navigation.state !== 'idle' && navigation.formData?.get('intent') === 'upload'
  const fileError = failure?.fieldErrors.file
  const kindError = failure?.fieldErrors.kind
  return (
    <section style={{ marginTop: 24 }}>
      <h2 style={{ marginTop: 0 }}>Upload a file</h2>
      <Form method="post" encType="multipart/form-data" className="adm-form">
        <input type="hidden" name="intent" value="upload" />
        <FormError message={failure?.formError} />
        <fieldset
          className={kindError ? 'field err' : 'field'}
          style={{ border: 0, padding: 0, margin: '0 0 16px' }}
          aria-describedby={kindError ? 'kind-err' : undefined}
        >
          <legend>What does the file contain?</legend>
          {KINDS.map((k, i) => (
            <label key={k.value} style={{ display: 'block', marginTop: 8 }}>
              <input type="radio" name="kind" value={k.value} defaultChecked={i === 0} /> <strong>{k.label}</strong>
              <span className="hint" style={{ display: 'block', margin: '2px 0 0 24px' }}>
                {k.hint}
              </span>
            </label>
          ))}
          {kindError && (
            <p className="err-msg" id="kind-err">
              {kindError}
            </p>
          )}
        </fieldset>
        <div className={fileError ? 'field err' : 'field'}>
          <label htmlFor="file">File (.xlsx or .csv)</label>
          <input
            className="input"
            id="file"
            name="file"
            type="file"
            accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            required
            aria-invalid={fileError ? true : undefined}
            aria-describedby={fileError ? 'file-err' : undefined}
          />
          {fileError && (
            <p className="err-msg" id="file-err" role="alert">
              {fileError}
            </p>
          )}
        </div>
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? 'Reading the file…' : 'Upload and preview'}
        </button>
      </Form>
    </section>
  )
}

type Page = Route.ComponentProps['loaderData']

/** The uploads table plus "Load more": fetched pages are appended. */
function UploadList({ first, firstCursor }: { first: Batch[]; firstCursor: string | null }) {
  const meId = useRouteLoaderData<typeof layoutLoader>('routes/admin/layout')?.user.id
  const fetcher = useFetcher<Page>()
  const [kept, setKept] = useState<Batch[]>([])
  const loading = fetcher.state !== 'idle'
  const latest = !loading && fetcher.data ? fetcher.data.list : null
  const items = [...first, ...kept, ...(latest?.items ?? [])]
  const cursor = fetcher.data ? fetcher.data.list.nextCursor : firstCursor

  const more = () => {
    if (!cursor) return
    if (latest) setKept((k) => [...k, ...latest.items])
    fetcher.load(`/admin/imports?cursor=${encodeURIComponent(cursor)}`)
  }

  return (
    <>
      <div className="tbl-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">File</th>
              <th scope="col">Kind</th>
              <th scope="col">Status</th>
              <th scope="col">Rows</th>
              <th scope="col">Who</th>
              <th scope="col">When</th>
            </tr>
          </thead>
          <tbody>
            {items.map((b) => (
              <tr key={b.id}>
                <td>
                  <Link to={`/admin/imports/${b.id}`}>{b.filename}</Link>
                </td>
                <td>{KIND_LABEL[b.kind]}</td>
                <td>
                  <ImportStatusBadge status={b.status} />
                </td>
                <td>{countsLine(b.counts)}</td>
                <td>{whoLabel(b, meId)}</td>
                <td>
                  {when(b.createdAt)}
                  {b.committedAt && (
                    <span className="hint" style={{ display: 'block', margin: 0 }}>
                      Saved {when(b.committedAt)}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {cursor && (
        <p className="adm-pager">
          <button className="btn btn-secondary" type="button" onClick={more} disabled={loading}>
            {loading ? 'Loading…' : 'Load more'}
          </button>
        </p>
      )}
    </>
  )
}
