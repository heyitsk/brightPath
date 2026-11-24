import { useEffect, useRef, type ReactNode } from 'react'
import { Form, Link, useNavigation } from 'react-router'
import { adminApi } from '../../api/client.browser'
import { handleApiError, safeCall, type ApiFailure } from '../../api/errors'
import { FormError } from '../../components/admin/AdminFormError'
import { FieldInput } from '../../components/admin/crud/fields'
import { loadOrThrow } from '../../components/admin/crud/runtime'
import { SectionError } from '../../components/admin/crud/SectionError'
import type { FieldDef, Opt } from '../../components/admin/crud/types'
import { Facts } from '../../components/admin/neet/common'
import { NewsStatusBadge, OriginalLink } from '../../components/admin/news/components'
import {
  CATEGORY_LABEL,
  CATEGORY_OPTIONS,
  dateLine,
  isCategory,
  loadStateChoices,
  n,
  placeLabel,
  STATUS_LABEL,
} from '../../components/admin/news/data'
import type { ItemBody, NewsItem, NewsStatus } from '../../components/admin/news/types'
import { Flash } from '../../components/admin/staff/common'
import { formatDate } from '../../components/shared/format'
import type { Route } from './+types/news-item'

export { SectionError as ErrorBoundary }
export const handle = { admin: true }
export const meta: Route.MetaFunction = () => [
  { title: 'News notice | Admin' },
  { name: 'robots', content: 'noindex, nofollow' },
]

/** The state select's value for a central (national) notice; sent as stateId: null. */
const CENTRAL = 'central'

async function loadItem(id: string | undefined): Promise<NewsItem> {
  if (!id) throw new Response('Not found.', { status: 404 })
  const data = await loadOrThrow<{ item: NewsItem }>(adminApi.GET('/admin/news/items/{id}', { params: { path: { id } } }))
  return data.item
}

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  const [item, states] = await Promise.all([loadItem(params.id), loadStateChoices()])
  return { item, states }
}

type Intent = 'save' | 'publish' | 'reject' | 'unpublish' | 'restore'
type Done = { ok: true; intent: Intent; message: string }
type Failed = ApiFailure & { intent: Intent }

const DONE: Record<Intent, string> = {
  save: 'Changes saved.',
  publish: 'Published. The notice is now on the public News page.',
  reject: 'Rejected. It has left the review queue; you can send it back at any time.',
  unpublish: 'Unpublished. It is no longer on the public News page.',
  restore: 'Sent back to the review queue.',
}
const INTENTS = Object.keys(DONE) as Intent[]
const STATUS_INTENTS: Intent[] = ['publish', 'reject', 'unpublish', 'restore']

/**
 * The form's values as an API body. A field that is not on the form is never sent, so a stale or
 * partial form cannot clear a value it does not show.
 */
function readBody(form: FormData): ItemBody {
  const text = (k: string) => {
    const v = String(form.get(k) ?? '').trim()
    return v === '' ? null : v
  }
  const body: ItemBody = {}
  if (form.has('publicTitle')) body.publicTitle = text('publicTitle')
  if (form.has('summary')) body.summary = text('summary')
  const category = form.get('category')
  if (isCategory(category)) body.category = category
  if (form.has('stateId')) {
    const s = String(form.get('stateId'))
    body.stateId = s === CENTRAL ? null : s
  }
  // An unticked checkbox is not in the form data; the marker says the box was on the form.
  if (form.has('isPinnedShown')) body.isPinned = form.get('isPinned') === 'on'
  return body
}

/** Only what differs from the stored notice. */
function changesOnly(body: ItemBody, item: NewsItem): ItemBody {
  const out: ItemBody = {}
  if (body.publicTitle !== undefined && body.publicTitle !== (item.publicTitle || null)) out.publicTitle = body.publicTitle
  if (body.summary !== undefined && body.summary !== (item.summary || null)) out.summary = body.summary
  if (body.category !== undefined && body.category !== item.category) out.category = body.category
  if (body.stateId !== undefined && body.stateId !== (item.state?.id ?? null)) out.stateId = body.stateId
  if (body.isPinned !== undefined && body.isPinned !== item.isPinned) out.isPinned = body.isPinned
  return out
}

/** Every button names its intent, so a stale page never does the wrong thing. */
export async function clientAction({ params, request }: Route.ClientActionArgs): Promise<Done | Failed> {
  const form = await request.formData()
  const raw = String(form.get('intent') ?? '')
  const intent = INTENTS.find((i) => i === raw)
  if (!intent) return { intent: 'save', status: 0, formError: 'Unknown action.', fieldErrors: {} }
  const path = { id: params.id }

  let call
  switch (intent) {
    case 'save': {
      // Compared with a fresh copy, not the page, so another person's change is not undone.
      const body = changesOnly(readBody(form), await loadItem(params.id))
      if (Object.keys(body).length === 0) return { intent, status: 0, formError: 'Nothing was changed.', fieldErrors: {} }
      call = adminApi.PATCH('/admin/news/items/{id}', { params: { path }, body })
      break
    }
    case 'publish':
      call = adminApi.POST('/admin/news/items/{id}/publish', { params: { path }, body: readBody(form) })
      break
    case 'reject':
      call = adminApi.POST('/admin/news/items/{id}/reject', { params: { path }, body: {} })
      break
    case 'unpublish':
      call = adminApi.POST('/admin/news/items/{id}/unpublish', { params: { path } })
      break
    case 'restore':
      call = adminApi.POST('/admin/news/items/{id}/restore', { params: { path } })
      break
  }

  const result = await safeCall(call)
  if (result.response.ok) return { ok: true, intent, message: DONE[intent] }
  return { ...handleApiError(result), intent }
}

const who = (person: { name: string } | null, at: string | null) =>
  at ? `${person?.name ?? 'A staff member'}, ${formatDate(at)}` : 'Not yet'

export default function NewsItemPage({ loaderData, actionData }: Route.ComponentProps) {
  const { item, states } = loaderData
  const done = actionData && 'ok' in actionData ? actionData : null
  const failed = actionData && !('ok' in actionData) ? actionData : null

  // After a status change, bring the top of the page content into view so the result message and
  // the new status badge show. Waits for the notice to reload; once per result.
  const idle = useNavigation().state === 'idle'
  const scrolledFor = useRef<Done | null>(null)
  useEffect(() => {
    if (!idle || !done || !STATUS_INTENTS.includes(done.intent) || scrolledFor.current === done) return
    scrolledFor.current = done
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    document.getElementById('main')?.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' })
  }, [idle, done])

  const reasons = item.relevance.reasons
  return (
    <>
      <p>
        <Link to="/admin/news">← News review</Link>
      </p>
      <h1 style={{ marginTop: 0 }}>{item.title}</h1>
      <p style={{ marginTop: 8 }}>
        <NewsStatusBadge status={item.status} />
      </p>
      {done && <Flash>{done.message}</Flash>}
      {failed && STATUS_INTENTS.includes(failed.intent) && failed.intent !== 'publish' && (
        <div style={{ marginTop: 16 }}>
          <FormError message={failed.formError} />
        </div>
      )}

      <p style={{ margin: '16px 0' }}>
        <OriginalLink href={item.originalUrl} className="btn btn-secondary">
          Open the official notice
        </OriginalLink>
      </p>
      {item.status !== 'PUBLISHED' && (
        <p className="hint">Check the notice against the official page before publishing.</p>
      )}

      <Facts
        rows={[
          ['Original title', item.title],
          [
            'Source',
            item.source.siteUrl ? (
              <OriginalLink key="s" href={item.source.siteUrl}>
                {item.source.name}
              </OriginalLink>
            ) : (
              item.source.name
            ),
          ],
          ['State', placeLabel(item)],
          ['Date', dateLine(item)],
          ['Category', CATEGORY_LABEL[item.category]],
          [
            'Relevance',
            `Score ${n(item.relevance.score)}${reasons.length > 0 ? ` (rules: ${reasons.join(', ')})` : ''}`,
          ],
          ...(item.duplicateOf
            ? [
                [
                  'Repeat of',
                  <Link key="d" to={`/admin/news/${item.duplicateOf.id}`}>
                    {item.duplicateOf.title} ({STATUS_LABEL[item.duplicateOf.status].toLowerCase()})
                  </Link>,
                ] as [string, ReactNode],
              ]
            : []),
          ...(item.snippet ? [['Excerpt from the site', item.snippet] as [string, ReactNode]] : []),
          ['Reviewed', who(item.reviewedBy, item.reviewedAt)],
          ['Published', who(item.publishedBy, item.publishedAt)],
          ...(item.slug ? [['Public address', `/news/${item.slug}`] as [string, ReactNode]] : []),
        ]}
      />

      <h2>For the News page</h2>
      <ItemForm item={item} states={states} failure={failed && (failed.intent === 'save' || failed.intent === 'publish') ? failed : undefined} />

      <StatusActions status={item.status} />
    </>
  )
}

function ItemForm(props: { item: NewsItem; states: Opt[]; failure?: Failed }) {
  const { item, states, failure } = props
  const busy = useNavigation().state !== 'idle'
  const errors = failure?.fieldErrors ?? {}
  const canPublish = item.status !== 'PUBLISHED'
  const stateValue = item.state?.id ?? CENTRAL

  const fields: { f: FieldDef; value: string | boolean; options?: Opt[] }[] = [
    {
      f: { name: 'publicTitle', label: 'Public title', kind: 'text', hint: 'Optional. Leave empty to use the official title.' },
      value: item.publicTitle ?? '',
    },
    {
      f: {
        name: 'summary',
        label: 'Summary',
        kind: 'textarea',
        maxLength: 500,
        hint: 'One or two lines in your own words (10 to 500 characters). Needed to publish.',
      },
      value: item.summary ?? '',
    },
    { f: { name: 'category', label: 'Category', kind: 'select', required: true }, value: item.category, options: CATEGORY_OPTIONS },
    {
      f: { name: 'stateId', label: 'State', kind: 'select', required: true },
      value: stateValue,
      options: [{ value: CENTRAL, label: 'Central (national notice)' }, ...states],
    },
    {
      f: { name: 'isPinned', label: 'Pinned (shown first on the News page)', kind: 'checkbox' },
      value: item.isPinned,
    },
  ]

  // The saved values. When they change (a successful save or publish), put them back in the inputs:
  // React has already moved each input's default to the new value, so reset() shows it. Failed
  // saves leave this unchanged, so anything still being typed is kept.
  // Not done with a `key` on the form: remounting duplicated it in the DOM.
  const saved = JSON.stringify(fields.map((x) => x.value))
  const formRef = useRef<HTMLFormElement>(null)
  useEffect(() => {
    formRef.current?.reset()
  }, [saved])

  return (
    <Form method="post" className="adm-form" ref={formRef}>
      <input type="hidden" name="isPinnedShown" value="1" />
      <FormError message={failure?.formError} />
      {fields.map(({ f, value, options }) => (
        <FieldInput key={f.name} f={f} value={value} error={errors[f.name]} options={options} />
      ))}
      <div className="adm-actions">
        {canPublish && (
          <button className="btn btn-primary" type="submit" name="intent" value="publish" disabled={busy}>
            Publish
          </button>
        )}
        <button
          className={canPublish ? 'btn btn-secondary' : 'btn btn-primary'}
          type="submit"
          name="intent"
          value="save"
          disabled={busy}
        >
          Save
        </button>
      </div>
      <p className="hint">
        {canPublish
          ? 'Save keeps your changes without publishing. Publish saves them and puts the notice on the News page.'
          : 'This notice is published: saved changes are live at once.'}
      </p>
    </Form>
  )
}

/** Reject, unpublish and send back, as each status allows. */
function StatusActions({ status }: { status: NewsStatus }) {
  const busy = useNavigation().state !== 'idle'
  const canReject = status === 'PENDING' || status === 'FILTERED' || status === 'BASELINE' || status === 'UNPUBLISHED'
  const canUnpublish = status === 'PUBLISHED'
  const canRestore = status === 'FILTERED' || status === 'BASELINE' || status === 'REJECTED' || status === 'UNPUBLISHED'
  if (!canReject && !canUnpublish && !canRestore) return null
  return (
    <>
      <h2>Status</h2>
      <Form method="post" className="adm-actions">
        {canUnpublish && (
          <button className="btn btn-secondary" type="submit" name="intent" value="unpublish" disabled={busy}>
            Unpublish
          </button>
        )}
        {canRestore && (
          <button className="btn btn-secondary" type="submit" name="intent" value="restore" disabled={busy}>
            Send back to review
          </button>
        )}
        {canReject && (
          <button className="btn btn-secondary" type="submit" name="intent" value="reject" disabled={busy}>
            Reject
          </button>
        )}
      </Form>
    </>
  )
}
