import { adminApi } from '../../api/client.browser'
import { handleApiError, safeCall } from '../../api/errors'
import { loadOrThrow } from '../../components/admin/crud/runtime'
import { SectionError } from '../../components/admin/crud/SectionError'
import {
  bodyOf,
  checkDraft,
  errorFields,
  isChanged,
  isLarge,
  listOf,
  mapErrors,
  NEW,
  readConfirmed,
  readForm,
  removedText,
  savedText,
  type Draft,
  type Effect,
  type FxDone,
  type FxFailed,
  type FxItem,
  type FxList,
  type RowErrors,
} from '../../components/admin/fx/fx-body'
import { FxRatesEditor } from '../../components/admin/fx/FxRatesEditor'
import { Flash, PageHead } from '../../components/admin/staff/common'
import type { Route } from './+types/fx-rates'

export { SectionError as ErrorBoundary }
export const handle = { admin: true }
export const meta: Route.MetaFunction = () => [
  { title: 'Exchange rates | Admin' },
  { name: 'robots', content: 'noindex, nofollow' },
]

export async function clientLoader() {
  const data = await loadOrThrow<FxList>(adminApi.GET('/admin/fx-rates'))
  return { items: listOf(data), missingCount: Number(data.missingCount) }
}

type Fail = (p: Partial<FxFailed>) => FxFailed

/**
 * Button intents: `save-all`, `confirm-all`, `save:XXX`, `confirm:XXX`, `delete:XXX` (XXX is a
 * currency, or `new` for the Add currency row). Rows are compared with a fresh copy of the rates,
 * not with the page, so only rows that really changed are sent.
 */
export async function clientAction({ request }: Route.ClientActionArgs): Promise<FxDone | FxFailed> {
  const at = Date.now()
  const fail: Fail = (p) => ({ ok: false, rowErrors: {}, large: [], at, ...p })
  const form = await request.formData()
  const intent = String(form.get('intent') ?? '')
  const colon = intent.indexOf(':')
  const verb = colon < 0 ? intent : intent.slice(0, colon)
  const target = colon < 0 ? '' : intent.slice(colon + 1)

  if (verb === 'delete' && target) return removeRate(target, fail, at)
  if (!['save-all', 'confirm-all', 'save', 'confirm'].includes(verb)) return fail({ formError: 'Unknown action.' })
  const all = verb.endsWith('-all')

  const freshCall = await safeCall(adminApi.GET('/admin/fx-rates'))
  const freshData = (freshCall as { data?: FxList }).data
  if (!freshCall.response.ok || !freshData) return fail({ formError: handleApiError(freshCall).formError })
  const fresh = listOf(freshData)
  const stored = new Map(fresh.map((i) => [i.currency, i]))

  const { rows, added } = readForm(form)
  type Candidate = { key: string; draft: Draft; item?: FxItem }
  const candidates: Candidate[] = [
    ...rows.map((d) => ({ key: d.currency, draft: d, item: stored.get(d.currency) })),
    { key: NEW, draft: added },
  ]
  const picked = all
    ? candidates.filter((c) => isChanged(c.draft, c.item))
    : candidates.filter((c) => c.key === target)
  if (picked.length === 0) {
    return all ? fail({ formError: 'Nothing was changed.' }) : fail({ formError: 'That row is no longer on the page. Reload and try again.' })
  }
  if (!all && !isChanged(picked[0].draft, picked[0].item)) {
    return fail({ rowErrors: { [picked[0].key]: { row: 'Nothing was changed in this row.' } } })
  }

  const listed = new Set(stored.keys())
  const checks: Record<string, RowErrors> = {}
  for (const c of picked) {
    const errors = checkDraft(c.draft, c.key === NEW, listed)
    if (Object.keys(errors).length > 0) checks[c.key] = errors
  }
  if (Object.keys(checks).length > 0) {
    return fail({ formError: all ? 'Please fix the highlighted rows. Nothing was saved.' : undefined, rowErrors: checks })
  }

  const sent = picked.map((c) => ({
    key: c.key,
    body: bodyOf(c.draft),
    old: c.item?.hasRate && c.item.rateToInr != null ? Number(c.item.rateToInr) : null,
    using: Number(c.item?.collegesUsing ?? 0),
  }))
  // Confirm only what staff saw: every large change being sent must match a prompt they confirmed.
  const confirmed = readConfirmed(form.get('confirmFor'))
  const confirm =
    verb.startsWith('confirm') &&
    sent.every((s) => !isLarge(s.old, s.body.rateToInr) || confirmed.get(s.body.currency) === s.body.rateToInr)
  const flag = confirm ? { confirmLargeChange: true } : {}

  const one = sent[0].body
  const result = await (all
    ? safeCall(adminApi.PUT('/admin/fx-rates', { body: { items: sent.map((s) => s.body), ...flag } }))
    : safeCall(
        adminApi.PUT('/admin/fx-rates/{currency}', {
          params: { path: { currency: one.currency } },
          body: { rateToInr: one.rateToInr, asOf: one.asOf, sourceNote: one.sourceNote, ...flag },
        }),
      ))
  const data = (result as { data?: Effect }).data
  if (result.response.ok && data) {
    const codes = sent.map((s) => s.body.currency)
    return { ok: true, message: savedText(codes, data, sent.reduce((n, s) => n + s.using, 0)), at }
  }

  const failure = handleApiError(result)
  const keys = sent.map((s) => s.key)
  if (failure.status !== 422) {
    return all ? fail({ formError: failure.formError }) : fail({ rowErrors: { [keys[0]]: { row: failure.formError } } })
  }

  const { rows: rowErrors, rest } = mapErrors(errorFields(result.error), keys)
  // The 20% guard (D-104) has no code of its own: a rate error on a row that moved more than 20%.
  // Once confirmLargeChange was sent, any rate error is a real one.
  const large = confirm
    ? []
    : sent
        .filter((s) => rowErrors[s.key]?.rateToInr && isLarge(s.old, s.body.rateToInr))
        .map((s) => ({ currency: s.key, old: s.old ?? 0, next: s.body.rateToInr }))
  for (const l of large) {
    delete rowErrors[l.currency].rateToInr
    if (Object.keys(rowErrors[l.currency]).length === 0) delete rowErrors[l.currency]
  }
  const otherErrors = Object.keys(rowErrors).length > 0 || rest.length > 0

  let formError: string | undefined
  if (!otherErrors && large.length === 0) formError = failure.formError
  else if (!otherErrors) {
    formError = `Nothing was saved yet. ${
      large.length === 1 ? 'A rate changes' : 'Some rates change'
    } by more than 20%: confirm below, or put the old rate back.`
  } else if (all || rest.length > 0) {
    formError = [all ? 'Nothing was saved. Check the highlighted rows.' : 'Not saved.', ...rest].join(' ')
  }
  return fail({ formError, rowErrors, large, confirmIntent: all ? 'confirm-all' : `confirm:${keys[0]}` })
}

async function removeRate(code: string, fail: Fail, at: number): Promise<FxDone | FxFailed> {
  const result = await safeCall(adminApi.DELETE('/admin/fx-rates/{currency}', { params: { path: { currency: code } } }))
  const data = (result as { data?: Effect }).data
  if (result.response.ok && data) return { ok: true, message: removedText(code, data), at }
  // Someone else removed it already: the goal is met.
  if (result.response.status === 404) return { ok: true, message: `The ${code} rate was already removed.`, at }
  // 409: a live college still charges fees in it; the API's message says how many and what to do.
  return fail({ rowErrors: { [code]: { row: handleApiError(result).formError } } })
}

export default function FxRates({ loaderData, actionData }: Route.ComponentProps) {
  const { items, missingCount } = loaderData
  const done = actionData?.ok ? actionData : undefined
  const failed = actionData && !actionData.ok ? actionData : undefined
  return (
    <>
      <PageHead title="Exchange rates" />
      <p className="hint" style={{ marginTop: 8 }}>
        How many rupees one unit of each currency buys. Changing a rate re-prices every college that charges fees in it. INR is
        always 1 and is not listed.
      </p>
      {done && <Flash>{done.message}</Flash>}
      {missingCount > 0 && (
        <div className="callout" role="alert">
          <h3>
            {missingCount} {missingCount === 1 ? 'currency needs' : 'currencies need'} a rate
          </h3>
          <p>Colleges that charge fees in {missingCount === 1 ? 'it' : 'them'} cannot go live until a rate is set. They are listed first.</p>
        </div>
      )}
      {items.length === 0 && <p>No rates yet, and no college charges fees in another currency. Add one below.</p>}
      <FxRatesEditor items={items} result={failed} />
    </>
  )
}
