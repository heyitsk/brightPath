import { Form, Link, useNavigation } from 'react-router'
import { adminApi } from '../../api/client.browser'
import { handleApiError, safeCall, type ApiFailure } from '../../api/errors'
import { FormError } from '../../components/admin/AdminFormError'
import {
  CollegeStatusBadge,
  FaqEditor,
  FeeSummary,
  MonthChecks,
  ReadinessPanel,
  SourcesPanel,
} from '../../components/admin/colleges/components'
import {
  KIND_LABEL,
  loadCollege,
  loadCountryOptions,
  loadSourceOptions,
  loadStateOptions,
  LOCATION_BASIS_LABEL,
} from '../../components/admin/colleges/data'
import { ABROAD_FIELDS, ABROAD_MORE_FIELDS, commonFields, INDIA_FIELDS, INTAKE } from '../../components/admin/colleges/fields'
import { buildCollegeBody, readFaqs } from '../../components/admin/colleges/form-body'
import type { College, Purpose } from '../../components/admin/colleges/types'
import { FieldInput } from '../../components/admin/crud/fields'
import { initialValue } from '../../components/admin/crud/form-data'
import { SectionError } from '../../components/admin/crud/SectionError'
import type { FieldDef, Opt, Row } from '../../components/admin/crud/types'
import { showDate } from '../../components/admin/crud/util'
import { Facts } from '../../components/admin/neet/common'
import { Flash } from '../../components/admin/staff/common'
import type { Route } from './+types/college-edit'

export { SectionError as ErrorBoundary }
export const handle = { admin: true }
export const meta: Route.MetaFunction = () => [
  { title: 'Edit college | Admin' },
  { name: 'robots', content: 'noindex, nofollow' },
]

export async function clientLoader({ params, request }: Route.ClientLoaderArgs) {
  const college = await loadCollege(params.id)
  const [places, sources] = await Promise.all([
    college.kind === 'INDIA' ? loadStateOptions() : loadCountryOptions(),
    loadSourceOptions(),
  ])
  return { college, places, sources, saved: new URL(request.url).searchParams.get('saved') }
}

type Intent = 'save' | 'ready' | 'draft' | 'archive' | 'source-add' | 'source-update' | 'source-remove' | 'faqs'
type Done = { ok: true; intent: Intent; message: string }
type Failed = ApiFailure & { intent: Intent; reasons?: string[] }

const DONE: Record<Intent, string> = {
  save: 'Changes saved.',
  ready: 'Marked ready. The college is live once its country is live (Indian colleges go live at once).',
  draft: 'Moved back to draft. It is no longer on the public site.',
  archive: 'Archived. It is no longer on the public site.',
  'source-add': 'Source linked.',
  'source-update': 'Source updated.',
  'source-remove': 'Source unlinked.',
  faqs: 'FAQs saved.',
}

const INTENTS = Object.keys(DONE) as Intent[]

/** Every button on the page names its intent, so a stale page never does the wrong thing. */
export async function clientAction({ params, request }: Route.ClientActionArgs): Promise<Done | Failed> {
  const form = await request.formData()
  const raw = String(form.get('intent') ?? '')
  const intent = INTENTS.find((i) => i === raw)
  if (!intent) return { intent: 'save', status: 0, formError: 'Unknown action.', fieldErrors: {} }
  const id = params.id
  const path = { id }
  const linkPath = { id, linkId: String(form.get('linkId') ?? '') }

  let call
  switch (intent) {
    case 'save': {
      const college = await loadCollege(id)
      const { body, fieldErrors } = buildCollegeBody(college, form)
      if (Object.keys(fieldErrors).length > 0) {
        return { intent, status: 0, formError: 'Please fix the highlighted fields.', fieldErrors }
      }
      if (Object.keys(body).length === 0) return { intent, status: 0, formError: 'Nothing was changed.', fieldErrors: {} }
      call = adminApi.PATCH('/admin/colleges/{id}', { params: { path }, body })
      break
    }
    case 'ready':
      call = adminApi.POST('/admin/colleges/{id}/ready', { params: { path } })
      break
    case 'draft':
      call = adminApi.POST('/admin/colleges/{id}/draft', { params: { path } })
      break
    case 'archive':
      call = adminApi.POST('/admin/colleges/{id}/archive', { params: { path } })
      break
    case 'source-add':
      call = adminApi.POST('/admin/colleges/{id}/sources', {
        params: { path },
        body: {
          sourceId: String(form.get('sourceId') ?? ''),
          purpose: String(form.get('purpose') ?? '') as Purpose,
          checkedAt: String(form.get('checkedAt') ?? ''),
        },
      })
      break
    case 'source-update':
      call = adminApi.PATCH('/admin/colleges/{id}/sources/{linkId}', {
        params: { path: linkPath },
        body: { purpose: String(form.get('purpose') ?? '') as Purpose, checkedAt: String(form.get('checkedAt') ?? '') },
      })
      break
    case 'source-remove':
      call = adminApi.DELETE('/admin/colleges/{id}/sources/{linkId}', { params: { path: linkPath } })
      break
    case 'faqs':
      call = adminApi.PUT('/admin/colleges/{id}/faqs', { params: { path }, body: { items: readFaqs(form) } })
      break
  }

  const result = await safeCall(call)
  if (result.response.ok) return { ok: true, intent, message: DONE[intent] }
  const failure = handleApiError(result)
  // Mark ready: one message per missing detail; keep every one (fieldErrors keeps one per field).
  const fields = (result.error as { error?: { fields?: { message: string }[] } } | undefined)?.error?.fields
  return { ...failure, intent, reasons: fields?.map((f) => f.message) }
}

const SAVED: Record<string, string> = { created: 'College created as a draft. Fill in the details below.' }

export default function CollegeEdit({ loaderData, actionData }: Route.ComponentProps) {
  const { college, places, sources, saved } = loaderData
  const done = actionData && 'ok' in actionData ? actionData : null
  const failed = actionData && !('ok' in actionData) ? actionData : null
  const failFor = (...intents: Intent[]) => (failed && intents.includes(failed.intent) ? failed : undefined)

  return (
    <>
      <p>
        <Link to="/admin/colleges">← Colleges</Link>
      </p>
      <h1 style={{ marginTop: 0 }}>{college.name}</h1>
      {saved && SAVED[saved] && !actionData && <Flash>{SAVED[saved]}</Flash>}
      {done && <Flash>{done.message}</Flash>}

      <Facts
        rows={[
          ['Status', <CollegeStatusBadge key="s" status={college.status} />],
          ['Kind', KIND_LABEL[college.kind]],
          ['Public address', `/colleges/${college.slug}`],
          ['Marked ready', showDate(college.readyAt)],
          ['City confirmed by', college.locationBasis ? LOCATION_BASIS_LABEL[college.locationBasis] : '-'],
          ['From bulk upload', college.importBatchId ? 'Yes' : 'No'],
          ['Last changed', showDate(college.updatedAt)],
        ]}
      />
      <p className="hint">Kind and public address are fixed after creation.</p>

      <h2>Ready check</h2>
      <ReadinessPanel college={college} />
      <StatusActions college={college} failure={failFor('ready', 'draft', 'archive')} />

      <h2>Details</h2>
      <DetailsForm
        key={college.updatedAt}
        college={college}
        places={places}
        failure={failFor('save', 'ready')}
      />

      <h2>Fees, year by year</h2>
      <FeeSummary college={college} />

      <h2>Sources</h2>
      <SourcesPanel college={college} sources={sources} failure={failFor('source-add', 'source-update', 'source-remove')} />

      <h2>FAQs</h2>
      <FaqEditor key={college.updatedAt} faqs={college.faqs} failure={failFor('faqs')} />
    </>
  )
}

function StatusActions({ college, failure }: { college: College; failure?: Failed }) {
  const busy = useNavigation().state !== 'idle'
  const { status } = college
  return (
    <Form method="post">
      <FormError message={failure?.formError} />
      {failure?.reasons && failure.reasons.length > 0 && (
        <ul className="err-msg" style={{ margin: '0 0 16px', paddingLeft: 20 }}>
          {failure.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      <div className="adm-actions">
        {status === 'DRAFT' && (
          <button className="btn btn-primary" type="submit" name="intent" value="ready" disabled={busy}>
            Mark ready
          </button>
        )}
        {status !== 'DRAFT' && (
          <button className="btn btn-secondary" type="submit" name="intent" value="draft" disabled={busy}>
            Move back to draft
          </button>
        )}
        {status !== 'ARCHIVED' && (
          <button className="btn btn-secondary" type="submit" name="intent" value="archive" disabled={busy}>
            Archive
          </button>
        )}
        {status === 'DRAFT' && (
          <Link className="btn btn-secondary" to={`/admin/colleges/${college.id}/delete`}>
            Delete…
          </Link>
        )}
      </div>
      {status !== 'DRAFT' && <p className="hint">Only drafts can be deleted. A college that has been live is archived instead.</p>}
    </Form>
  )
}

function DetailsForm(props: { college: College; places: Opt[]; failure?: Failed }) {
  const { college, places, failure } = props
  const busy = useNavigation().state !== 'idle'
  const row = college as unknown as Row
  const errors = failure?.fieldErrors ?? {}
  const input = (f: FieldDef) => (
    <FieldInput
      key={f.name}
      f={f}
      value={initialValue(f, row)}
      error={errors[f.name]}
      options={f.lookup ? places : f.options}
    />
  )
  return (
    <Form method="post" className="adm-form">
      <input type="hidden" name="intent" value="save" />
      {failure?.intent === 'save' && <FormError message={failure.formError} />}
      <p className="hint">
        Fields marked <strong>*</strong> are required. Only what you change is saved.
      </p>
      {commonFields(college.kind).map(input)}
      {college.kind === 'INDIA' ? (
        <>
          <h3>India details</h3>
          {INDIA_FIELDS.map(input)}
        </>
      ) : (
        <>
          <h3>Abroad details</h3>
          {ABROAD_FIELDS.map(input)}
          <MonthChecks
            name={INTAKE}
            value={(college.abroad?.intakeMonths ?? []).map(Number)}
            error={errors[INTAKE]}
          />
          {ABROAD_MORE_FIELDS.map(input)}
        </>
      )}
      <button className="btn btn-primary" type="submit" disabled={busy}>
        {busy ? 'Saving…' : 'Save changes'}
      </button>
    </Form>
  )
}
