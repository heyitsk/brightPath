import { useEffect, useRef } from 'react'
import { Form, Link, useNavigation } from 'react-router'
import { adminApi } from '../../api/client.browser'
import { handleApiError, safeCall, type ApiFailure } from '../../api/errors'
import { FormError } from '../../components/admin/AdminFormError'
import {
  CollegeStatusBadge,
  FaqEditor,
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
import { FeeEditor, type FeeResult } from '../../components/admin/colleges/FeeEditor'
import {
  bodyOf,
  planFeeChanges,
  readFeeRows,
  sortFeeError,
  validateFeeRows,
  type FailedFee,
  type FeeRefusal,
} from '../../components/admin/colleges/fee-body'
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

type Intent = 'save' | 'ready' | 'draft' | 'archive' | 'source-add' | 'source-update' | 'source-remove' | 'faqs' | 'fees'
type Done = { ok: true; intent: Intent; message: string }
type Failed = ApiFailure & { intent: Intent; reasons?: string[]; fees?: FeeResult }

const DONE: Record<Intent, string> = {
  save: 'Changes saved.',
  ready: 'Marked ready. The college is live once its country is live (Indian colleges go live at once).',
  draft: 'Moved back to draft. It is no longer on the public site.',
  archive: 'Archived. It is no longer on the public site.',
  'source-add': 'Source linked.',
  'source-update': 'Source updated.',
  'source-remove': 'Source unlinked.',
  faqs: 'FAQs saved.',
  fees: 'Fees saved.',
}

const INTENTS = Object.keys(DONE) as Intent[]
const STATUS_INTENTS: Intent[] = ['ready', 'draft', 'archive']

/** Every button on the page names its intent, so a stale page never does the wrong thing. */
export async function clientAction({ params, request }: Route.ClientActionArgs): Promise<Done | Failed> {
  const form = await request.formData()
  const raw = String(form.get('intent') ?? '')
  const intent = INTENTS.find((i) => i === raw)
  if (!intent) return { intent: 'save', status: 0, formError: 'Unknown action.', fieldErrors: {} }
  const id = params.id
  const path = { id }
  const linkPath = { id, linkId: String(form.get('linkId') ?? '') }

  if (intent === 'fees') return saveFees(id, form)

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

const errorFields = (error: unknown) => (error as { error?: { fields?: { path: string; message: string }[] } } | undefined)?.error?.fields

/**
 * One "Save fees" click: a PUT per new or changed year, then a DELETE per removed year, one at a time
 * so each result belongs to one row. Compared with a fresh copy of the college, not the page.
 * Keeps going after a failure; rows that failed come back to the editor with their errors.
 */
async function saveFees(id: string | undefined, form: FormData): Promise<Done | Failed> {
  const at = Date.now()
  const fail = (formError: string, fees: Pick<FeeResult, 'failed' | 'refusals'>): Failed => ({ intent: 'fees', status: 422, formError: '', fieldErrors: {}, fees: { ...fees, formError, at } })
  const rows = readFeeRows(form)
  const checks = validateFeeRows(rows)
  if (checks.some((e) => Object.keys(e).length > 0)) {
    // Nothing sent: give every row back as typed, with its problems.
    return fail('Please fix the highlighted fee rows. Nothing was saved.', {
      failed: rows.map((r, i) => ({ ...r, errors: checks[i] })),
      refusals: [],
    })
  }

  const college = await loadCollege(id)
  const { puts, deletes } = planFeeChanges(rows, college.fees)
  if (puts.length + deletes.length === 0) return fail('Nothing was changed.', { failed: [], refusals: [] })

  const failed: FailedFee[] = []
  const refusals: FeeRefusal[] = []
  const path = (i: number) => ({ id: college.id, year: Number(rows[i].year) })

  for (const i of [...puts, ...deletes]) {
    const removing = rows[i].removed
    const result = await safeCall(
      removing
        ? adminApi.DELETE('/admin/colleges/{id}/fees/{year}', { params: { path: path(i) } })
        : adminApi.PUT('/admin/colleges/{id}/fees/{year}', { params: { path: path(i) }, body: bodyOf(rows[i]) }),
    )
    if (result.response.ok) continue
    // Someone else already deleted that year: the goal is met.
    if (removing && result.response.status === 404) continue
    const failure = handleApiError(result)
    if (result.response.status === 422) {
      const sorted = sortFeeError(failure.formError, errorFields(result.error))
      if ('refusal' in sorted) {
        refusals.push({ year: path(i).year, removing, ...sorted.refusal })
        failed.push({ ...rows[i], errors: {}, refused: true })
      } else failed.push({ ...rows[i], errors: sorted.errors })
    } else failed.push({ ...rows[i], errors: { row: failure.formError } })
  }

  const total = puts.length + deletes.length
  if (failed.length === 0) return { ok: true, intent: 'fees', message: DONE.fees }
  const done = total - failed.length
  const formError =
    done === 0
      ? failed.length === 1
        ? 'The fee change was not saved. See the highlighted row.'
        : 'None of the fee changes were saved. See the highlighted rows.'
      : `Saved ${done} of ${total} fee changes. The rest were not saved; see the highlighted rows.`
  return fail(formError, { failed, refusals })
}

const SAVED: Record<string, string> = { created: 'College created as a draft. Fill in the details below.' }

export default function CollegeEdit({ loaderData, actionData }: Route.ComponentProps) {
  const { college, places, sources, saved } = loaderData
  const done = actionData && 'ok' in actionData ? actionData : null
  const failed = actionData && !('ok' in actionData) ? actionData : null
  const failFor = (...intents: Intent[]) => (failed && intents.includes(failed.intent) ? failed : undefined)

  // After Mark ready / Move back to draft / Archive, bring the top of the page content into view so
  // the result message and the new status badge show. The content, not the window: on phones the
  // admin menu sits above it. Waits for the college to reload so the badge is already up to date;
  // once per result.
  const idle = useNavigation().state === 'idle'
  const scrolledFor = useRef<Done | null>(null)
  useEffect(() => {
    if (!idle || !done || !STATUS_INTENTS.includes(done.intent) || scrolledFor.current === done) return
    scrolledFor.current = done
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    document.getElementById('main')?.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' })
  }, [idle, done])

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
      <DetailsForm college={college} places={places} failure={failFor('save', 'ready')} />

      <h2>Fees, year by year</h2>
      <FeeEditor college={college} sources={sources} result={failFor('fees')?.fees} />

      <h2>Sources</h2>
      <SourcesPanel college={college} sources={sources} failure={failFor('source-add', 'source-update', 'source-remove')} />

      <h2>FAQs</h2>
      <FaqEditor faqs={college.faqs} failure={failFor('faqs')} />
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
  const fields = [...commonFields(college.kind), ...(college.kind === 'INDIA' ? INDIA_FIELDS : [...ABROAD_FIELDS, ...ABROAD_MORE_FIELDS])]
  // The saved values. When they change (a successful save), put them back in the inputs:
  // React has already moved each input's default to the new value, so reset() shows it. Status
  // actions and failed saves leave this unchanged, so anything still being typed is kept.
  // Not done with a `key` on the form: remounting duplicated it in the DOM.
  const saved = JSON.stringify([fields.map((f) => initialValue(f, row)), college.abroad?.intakeMonths ?? []])
  const formRef = useRef<HTMLFormElement>(null)
  useEffect(() => {
    formRef.current?.reset()
  }, [saved])
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
    <Form method="post" className="adm-form" ref={formRef}>
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
