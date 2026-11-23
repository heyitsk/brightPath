import { useEffect, useRef } from 'react'
import { Form, useNavigation } from 'react-router'
import { adminApi } from '../../api/client.browser'
import { handleApiError, safeCall } from '../../api/errors'
import { FormError } from '../../components/admin/AdminFormError'
import { loadOrThrow } from '../../components/admin/crud/runtime'
import { SectionError } from '../../components/admin/crud/SectionError'
import {
  diff,
  F,
  readForm,
  splitFieldErrors,
  statusOf,
  toLocalInput,
  type Homepage,
  type HomepageDone,
  type HomepageFailed,
} from '../../components/admin/homepage/body'
import { requireAdmin } from '../../components/admin/staff/access'
import { Flash, PageHead } from '../../components/admin/staff/common'
import { HERO_DEFAULT } from '../../components/shared/home'
import type { Route } from './+types/homepage'

export { SectionError as ErrorBoundary }
export const handle = { admin: true }
export const meta: Route.MetaFunction = () => [
  { title: 'Home page | Admin' },
  { name: 'robots', content: 'noindex, nofollow' },
]

export async function clientLoader() {
  await requireAdmin()
  return { page: await loadOrThrow<Homepage>(adminApi.GET('/admin/site/homepage')) }
}

/** Sends only the fields that differ from a fresh copy of what is stored (empty text clears a field). */
export async function clientAction({ request }: Route.ClientActionArgs): Promise<HomepageDone | HomepageFailed> {
  const at = Date.now()
  const fail = (p: Partial<HomepageFailed>): HomepageFailed => ({ ok: false, fieldErrors: {}, at, ...p })
  await requireAdmin()
  const form = await request.formData()

  const read = readForm(form)
  if ('fieldErrors' in read) return fail({ fieldErrors: read.fieldErrors })

  const fresh = await safeCall(adminApi.GET('/admin/site/homepage'))
  const stored = (fresh as { data?: Homepage }).data
  if (!fresh.response.ok || !stored) return fail({ formError: handleApiError(fresh).formError })

  const change = diff(read.draft, stored)
  if (!change) return fail({ formError: 'Nothing was changed.' })

  const result = await safeCall(adminApi.PATCH('/admin/site/homepage', { body: change.body }))
  if (result.response.ok) {
    const what = change.count === 1 ? '1 change' : `${change.count} changes`
    return { ok: true, message: `Saved ${what}. The public site shows it straight away.`, at }
  }

  const failure = handleApiError(result)
  const { byField, rest } = splitFieldErrors(failure.fieldErrors)
  const formError = [Object.keys(byField).length > 0 || rest.length > 0 ? 'Not saved.' : failure.formError, ...rest].join(' ')
  return fail({ formError, fieldErrors: byField })
}

export default function HomepageAdmin({ loaderData, actionData }: Route.ComponentProps) {
  const { hero, announcement: a } = loaderData.page
  const busy = useNavigation().state !== 'idle'
  const done = actionData?.ok ? actionData : undefined
  const errors = actionData && !actionData.ok ? actionData.fieldErrors : {}
  const status = statusOf(a)

  // After a successful save the loader has re-read the stored values into the inputs' defaults;
  // reset() shows them (the server's version, not what was typed). A failed save keeps the typing.
  // No `key` here: remounting the form left stale copies in the DOM before.
  const formRef = useRef<HTMLFormElement>(null)
  const doneAt = done?.at
  useEffect(() => {
    if (doneAt !== undefined) formRef.current?.reset()
  }, [doneAt])

  return (
    <>
      <PageHead title="Home page" />
      <p className="hint" style={{ marginTop: 8 }}>
        The hero wording on the home page, and the announcement strip shown above the header on every public page.
        Changes go live as soon as they are saved.
      </p>
      {done && <Flash>{done.message}</Flash>}

      <Form method="post" className="adm-form adm-wide" noValidate ref={formRef} style={{ marginTop: 24 }}>
        <FormError message={actionData && !actionData.ok ? actionData.formError : undefined} />

        <h2>Hero</h2>
        <Field
          name={F.headline}
          label="Headline"
          defaultValue={hero.headline}
          maxLength={120}
          error={errors[F.headline]}
          hint={`Up to 120 characters. Leave empty to use the built-in headline: “${HERO_DEFAULT.headline}”`}
        />
        <Field
          name={F.subtext}
          label="Text under the headline"
          defaultValue={hero.subtext}
          maxLength={300}
          rows={3}
          error={errors[F.subtext]}
          hint={`Up to 300 characters. Leave empty to use the built-in text: “${HERO_DEFAULT.subtext}”`}
        />

        <h2 style={{ marginTop: 32 }}>Announcement strip</h2>
        <p style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <span className={status.badge}>{status.label}</span>
          <span>{status.text}</span>
        </p>
        <p className="hint">Status as of when this page loaded, after the last save.</p>

        <div className={errors[F.isActive] ? 'field err' : 'field'}>
          <label className="check" htmlFor={F.isActive}>
            <input
              type="checkbox"
              id={F.isActive}
              name={F.isActive}
              defaultChecked={a.isActive}
              aria-invalid={errors[F.isActive] ? true : undefined}
              aria-describedby={errors[F.isActive] ? `${F.isActive}-err` : undefined}
            />
            <span>Show the strip (inside the times below, if set)</span>
          </label>
          {errors[F.isActive] && (
            <p className="err-msg" id={`${F.isActive}-err`}>
              {errors[F.isActive]}
            </p>
          )}
        </div>
        <Field
          name={F.text}
          label="Text"
          defaultValue={a.text}
          maxLength={200}
          rows={2}
          error={errors[F.text]}
          hint="Up to 200 characters. Needed before the strip can be switched on."
        />
        <Field
          name={F.linkLabel}
          label="Link text"
          defaultValue={a.linkLabel}
          maxLength={40}
          error={errors[F.linkLabel]}
          hint='Optional, up to 40 characters, e.g. "Know more". A link needs both its text and its address.'
        />
        <Field
          name={F.linkUrl}
          label="Link address"
          defaultValue={a.linkUrl}
          error={errors[F.linkUrl]}
          hint="A full https:// address, or a path on this site starting with /, such as /neet-rank-predictor. A path is not checked against the published pages, so you can link to a page that goes live later. Check that it works once it is live."
        />
        <Field
          name={F.showFrom}
          label="Show from"
          type="datetime-local"
          defaultValue={toLocalInput(a.showFrom)}
          error={errors[F.showFrom]}
          hint="Your local time. Leave empty to start straight away."
        />
        <Field
          name={F.showUntil}
          label="Show until"
          type="datetime-local"
          defaultValue={toLocalInput(a.showUntil)}
          error={errors[F.showUntil]}
          hint="Your local time. Leave empty to keep showing it until it is switched off."
        />

        <div className="adm-actions">
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </Form>
    </>
  )
}

/** Text input or textarea with its label, hint and per-field error, in the existing .field styles. */
function Field(props: {
  name: string
  label: string
  defaultValue: string | null
  hint: string
  error?: string
  type?: string
  maxLength?: number
  rows?: number
}) {
  const { name, label, defaultValue, hint, error, type = 'text', maxLength, rows } = props
  const common = {
    className: 'input',
    id: name,
    name,
    defaultValue: defaultValue ?? '',
    maxLength,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error ? `${name}-hint ${name}-err` : `${name}-hint`,
  }
  return (
    <div className={error ? 'field err' : 'field'}>
      <label htmlFor={name}>{label}</label>
      {rows ? <textarea {...common} rows={rows} /> : <input {...common} type={type} autoComplete="off" />}
      <p className="hint" id={`${name}-hint`}>
        {hint}
      </p>
      {error && (
        <p className="err-msg" id={`${name}-err`}>
          {error}
        </p>
      )}
    </div>
  )
}
