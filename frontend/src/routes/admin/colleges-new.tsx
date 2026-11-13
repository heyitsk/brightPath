import { useState } from 'react'
import { Form, Link, redirect, useNavigation } from 'react-router'
import { adminApi } from '../../api/client.browser'
import { handleApiError, safeCall, type ApiFailure } from '../../api/errors'
import { FormError } from '../../components/admin/AdminFormError'
import { KIND_OPTIONS, loadCountryOptions, loadStateOptions, OWNERSHIP_OPTIONS } from '../../components/admin/colleges/data'
import type { Create, Kind } from '../../components/admin/colleges/types'
import { FieldInput } from '../../components/admin/crud/fields'
import { SectionError } from '../../components/admin/crud/SectionError'
import type { FieldDef } from '../../components/admin/crud/types'
import type { Route } from './+types/colleges-new'

export { SectionError as ErrorBoundary }
export const handle = { admin: true }
export const meta: Route.MetaFunction = () => [
  { title: 'New college | Admin' },
  { name: 'robots', content: 'noindex, nofollow' },
]

export async function clientLoader() {
  const [states, countries] = await Promise.all([loadStateOptions(), loadCountryOptions()])
  return { states, countries }
}

const NAME: FieldDef = { name: 'name', label: 'Name', kind: 'text', required: true, maxLength: 300 }
const CITY: FieldDef = { name: 'city', label: 'City', kind: 'text', required: true, maxLength: 120 }
const STATE: FieldDef = { name: 'stateId', label: 'State', kind: 'select', required: true }
const COUNTRY: FieldDef = { name: 'countryId', label: 'Country', kind: 'select', required: true }
const OWNERSHIP: FieldDef = { name: 'ownership', label: 'Ownership', kind: 'select', options: OWNERSHIP_OPTIONS, emptyLabel: 'Not set' }

/** A new college is always a draft; the API makes the public address from the name. */
export async function clientAction({ request }: Route.ClientActionArgs): Promise<ApiFailure> {
  const form = await request.formData()
  const text = (k: string) => String(form.get(k) ?? '').trim()
  const kind: Kind = text('kind') === 'ABROAD' ? 'ABROAD' : 'INDIA'
  const body: Create = { kind, name: text('name'), city: text('city') }
  if (kind === 'INDIA' && text('stateId')) body.stateId = text('stateId')
  if (kind === 'ABROAD' && text('countryId')) body.countryId = text('countryId')
  if (text('ownership')) body.ownership = text('ownership') as Create['ownership']

  const result = await safeCall(adminApi.POST('/admin/colleges', { body }))
  if ('data' in result && result.data) throw redirect(`/admin/colleges/${result.data.college.id}?saved=created`)
  return handleApiError(result)
}

export default function CollegeNew({ loaderData, actionData }: Route.ComponentProps) {
  const { states, countries } = loaderData
  const [kind, setKind] = useState<Kind>('INDIA')
  const busy = useNavigation().state !== 'idle'
  const err = actionData?.fieldErrors ?? {}
  return (
    <>
      <p>
        <Link to="/admin/colleges">← Colleges</Link>
      </p>
      <h1 style={{ marginTop: 0 }}>New college</h1>
      <p className="hint">
        It is saved as a draft. You fill in the rest of the details on the next page. The kind and the public address
        (made from the name) cannot be changed later.
      </p>
      <Form method="post" className="adm-form">
        <FormError message={actionData?.formError} />
        <fieldset className={err.kind ? 'field err' : 'field'} style={{ border: 0, padding: 0, margin: '0 0 16px' }}>
          <legend className="legend">Kind *</legend>
          {KIND_OPTIONS.map((o) => (
            <label className="check" key={o.value}>
              <input
                type="radio"
                name="kind"
                value={o.value}
                checked={kind === o.value}
                onChange={() => setKind(o.value as Kind)}
              />
              <span>{o.label}</span>
            </label>
          ))}
          {err.kind && <p className="err-msg">{err.kind}</p>}
        </fieldset>
        <FieldInput f={NAME} value="" error={err.name} />
        <FieldInput f={CITY} value="" error={err.city} />
        {kind === 'INDIA' ? (
          <FieldInput key="state" f={STATE} value="" error={err.stateId} options={states} />
        ) : (
          <FieldInput key="country" f={COUNTRY} value="" error={err.countryId} options={countries} />
        )}
        <FieldInput f={OWNERSHIP} value="" error={err.ownership} options={OWNERSHIP_OPTIONS} />
        <div className="adm-actions">
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? 'Creating…' : 'Create draft'}
          </button>
          <Link className="btn btn-secondary" to="/admin/colleges">
            Cancel
          </Link>
        </div>
      </Form>
    </>
  )
}
