import { Form, redirect, useNavigation } from 'react-router'
import { adminApi } from '../../api/client.browser'
import { handleApiError, safeCall } from '../../api/errors'
import { FormError, TextField } from '../../components/admin/AdminFormError'
import adminStyles from '../../styles/pages/admin.css?url'
import type { Route } from './+types/login'

export const handle = { admin: true }
export const links: Route.LinksFunction = () => [{ rel: 'stylesheet', href: adminStyles }]
export const meta: Route.MetaFunction = () => [
  { title: 'Staff login' },
  { name: 'robots', content: 'noindex, nofollow' },
]

/** Already signed in? Go straight to the admin home. */
export async function clientLoader() {
  const me = await safeCall(adminApi.GET('/admin/auth/me'))
  if (me.response.ok) throw redirect('/admin')
  return null
}
clientLoader.hydrate = true as const

export function HydrateFallback() {
  return <div className="adm-center">Loading…</div>
}

export async function clientAction({ request }: Route.ClientActionArgs) {
  const form = await request.formData()
  const email = String(form.get('email') ?? '').trim()
  const password = String(form.get('password') ?? '')
  const result = await safeCall(adminApi.POST('/admin/auth/login', { body: { email, password } }))
  if (result.response.ok) throw redirect('/admin')

  const failure = handleApiError(result, { keep401: true })
  if (failure.status === 401) failure.formError = 'Wrong email or password.'
  else if (failure.status === 429) {
    const locked = failure.formError.startsWith('Too many failed attempts')
    failure.formError = locked
      ? `This account is locked. ${failure.formError.replace('Too many failed attempts. ', '')}`
      : 'Too many login attempts. Please wait a minute and try again.'
  }
  return failure
}

export default function Login({ actionData }: Route.ComponentProps) {
  const busy = useNavigation().state === 'submitting'
  return (
    <div className="adm-center">
      <div className="adm-card" style={{ width: '100%' }}>
        <h1 style={{ fontSize: '1.5rem', marginTop: 0 }}>Staff login</h1>
        <Form method="post" noValidate>
          <FormError message={actionData?.formError} />
          <TextField name="email" label="Email" type="email" autoComplete="username" error={actionData?.fieldErrors.email} />
          <TextField name="password" label="Password" type="password" autoComplete="current-password" error={actionData?.fieldErrors.password} />
          <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </Form>
      </div>
    </div>
  )
}
