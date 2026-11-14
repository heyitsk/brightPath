import { Fragment, useState, type ReactNode } from 'react'
import { Form, useNavigation } from 'react-router'
import { FormError } from '../AdminFormError'
import { today } from '../crud/util'
import {
  draftFrom,
  emptyDraft,
  isChanged,
  NEW,
  showRate,
  type Draft,
  type DraftField,
  type FxFailed,
  type FxItem,
  type LargeChange,
  type RowErrors,
} from './fx-body'

/** The stored values of a row; a change here means a save or delete got through. */
const storedKey = (i: FxItem) => `${i.hasRate}|${i.rateToInr}|${i.asOf}|${i.sourceNote}`

/**
 * Every rate on one form: edit any rows, then "Save all" (one all-or-nothing request with only the
 * changed rows) or save a single row. Unsaved edits live in `drafts`, keyed by currency.
 */
export function FxRatesEditor({ items, result }: { items: FxItem[]; result?: FxFailed }) {
  const busy = useNavigation().state !== 'idle'
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [added, setAdded] = useState<Draft>(emptyDraft)
  const [asking, setAsking] = useState<string | null>(null)

  // Follow the server without a `key` (remounting duplicated the page's forms in the DOM): drop
  // the drafts of rows whose stored values changed, keep every other unsaved edit.
  const snapshot = items.map((i) => `${i.currency}=${storedKey(i)}`).join(',')
  const [seen, setSeen] = useState({ snapshot, items })
  if (snapshot !== seen.snapshot) {
    const before = new Map(seen.items.map((i) => [i.currency, storedKey(i)]))
    const now = new Map(items.map((i) => [i.currency, storedKey(i)]))
    setSeen({ snapshot, items })
    setDrafts((ds) => Object.fromEntries(Object.entries(ds).filter(([c]) => now.has(c) && now.get(c) === before.get(c))))
    if (added.currency && now.has(added.currency) && !before.has(added.currency)) setAdded(emptyDraft())
    setAsking(null)
  }

  // Errors belong to one save result; editing a field hides its error until the next result.
  const [cleared, setCleared] = useState<{ at?: number; keys: string[] }>({ at: result?.at, keys: [] })
  if (result?.at !== cleared.at) {
    setCleared({ at: result?.at, keys: [] })
    setAsking(null)
  }
  const errorsFor = (key: string): RowErrors => {
    const all = result?.rowErrors[key] ?? {}
    return Object.fromEntries(Object.entries(all).filter(([f]) => !cleared.keys.includes(`${key}.${f}`)))
  }

  const draftOf = (item: FxItem) => drafts[item.currency] ?? draftFrom(item)
  const edit = (key: string, field: DraftField, value: string) => {
    setCleared((c) => ({ ...c, keys: [...c.keys, `${key}.${field}`, `${key}.row`] }))
    if (key === NEW) {
      setAdded((d) => ({ ...d, [field]: value }))
      return
    }
    const item = items.find((i) => i.currency === key)
    if (!item) return
    setDrafts((ds) => {
      const next = { ...(ds[key] ?? draftFrom(item)), [field]: value }
      if (field === 'rateToInr' && !next.asOf) next.asOf = today()
      return { ...ds, [key]: next }
    })
  }
  const putBack = (item: FxItem) =>
    setDrafts((ds) => ({ ...ds, [item.currency]: { ...draftOf(item), rateToInr: draftFrom(item).rateToInr } }))

  // A "more than 20%" prompt holds only while the rate is still the one it was raised for.
  const largeFor = (key: string, rate: string): LargeChange | undefined =>
    result?.large.find((l) => l.currency === key && l.next === Number(rate))
  const stillLarge = (result?.large ?? []).filter((l) => {
    const item = items.find((i) => i.currency === l.currency)
    return item && largeFor(l.currency, draftOf(item).rateToInr)
  })
  const confirmFor = stillLarge.map((l) => `${l.currency}=${l.next}`).join(';')

  const pending = items.filter((i) => drafts[i.currency] && isChanged(drafts[i.currency], i)).length + (isChanged(added) ? 1 : 0)

  const saveAll = (
    <div className="fx-bar">
      <button className="btn btn-primary" type="submit" name="intent" value="save-all" disabled={busy}>
        {busy ? 'Saving…' : pending > 0 ? `Save all (${pending} ${pending === 1 ? 'change' : 'changes'})` : 'Save all'}
      </button>
      <span className="hint">Saves every changed row together. If one row is refused, nothing is saved.</span>
    </div>
  )

  return (
    <Form method="post" className="adm-form adm-fx">
      <input type="hidden" name="count" value={items.length} />
      <input type="hidden" name="confirmFor" value={confirmFor} />
      <FormError message={result?.formError} />
      {/* The first submit button in the form, so Enter in any field means "Save all". */}
      {saveAll}

      <div className="tbl-wrap">
        <table>
          <thead>
            <tr>
              <th className="fx-code">Currency</th>
              <th className="fx-rate">Rate to INR</th>
              <th className="fx-date">As of</th>
              <th className="fx-note">Note</th>
              <th className="fx-use">Colleges using</th>
              <th className="fx-act">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => {
              const draft = draftOf(item)
              return (
                <RateRow
                  key={item.currency}
                  index={i}
                  item={item}
                  draft={draft}
                  errors={errorsFor(item.currency)}
                  large={largeFor(item.currency, draft.rateToInr)}
                  confirmIntent={result?.confirmIntent}
                  asking={asking === item.currency}
                  busy={busy}
                  onEdit={(field, value) => edit(item.currency, field, value)}
                  onAsk={(yes) => setAsking(yes ? item.currency : null)}
                  onPutBack={() => putBack(item)}
                />
              )
            })}
            <AddRow draft={added} errors={errorsFor(NEW)} busy={busy} onEdit={(field, value) => edit(NEW, field, value)} />
          </tbody>
        </table>
      </div>

      {saveAll}
    </Form>
  )
}

function Cell(props: { className: string; label: string; error?: string; children: ReactNode }) {
  const { className, label, error, children } = props
  return (
    <td className={className} data-label={label}>
      <div className={error ? 'field err' : 'field'} style={{ margin: 0, gap: 4 }}>
        {children}
        {error && <p className="err-msg">{error}</p>}
      </div>
    </td>
  )
}

function inputs(prefix: string, draft: Draft, errors: RowErrors, label: string, onEdit: (f: DraftField, v: string) => void) {
  const common = (field: DraftField) => ({
    className: 'input',
    name: `${prefix}.${field}`,
    value: draft[field],
    'aria-invalid': errors[field] ? true : undefined,
    onChange: (e: { target: { value: string } }) => onEdit(field, e.target.value),
  })
  return (
    <>
      <Cell className="fx-rate" label="Rate to INR" error={errors.rateToInr}>
        <input {...common('rateToInr')} inputMode="decimal" autoComplete="off" placeholder="88.5" aria-label={`${label} rate to INR`} />
      </Cell>
      <Cell className="fx-date" label="As of" error={errors.asOf}>
        <input {...common('asOf')} type="date" max={today()} aria-label={`${label} rate as of`} />
      </Cell>
      <Cell className="fx-note" label="Note" error={errors.sourceNote}>
        <input {...common('sourceNote')} autoComplete="off" placeholder="e.g. RBI reference rate" aria-label={`${label} note`} />
      </Cell>
    </>
  )
}

const small = 'btn btn-secondary adm-btn-sm'

function RateRow(props: {
  index: number
  item: FxItem
  draft: Draft
  errors: RowErrors
  large?: LargeChange
  confirmIntent?: string
  asking: boolean
  busy: boolean
  onEdit: (field: DraftField, value: string) => void
  onAsk: (yes: boolean) => void
  onPutBack: () => void
}) {
  const { index, item, draft, errors, large, confirmIntent, asking, busy, onEdit, onAsk, onPutBack } = props
  const code = item.currency
  const using = Number(item.collegesUsing)
  const live = Number(item.liveCollegesUsing)

  return (
    <Fragment>
      <tr>
        <Cell className="fx-code" label="Currency" error={errors.currency}>
          <div>
            <strong>{code}</strong>
            <input type="hidden" name={`fx.${index}.currency`} value={code} />{' '}
            {!item.hasRate ? (
              <span className="adm-badge off">Needs a rate</span>
            ) : (
              isChanged(draft, item) && <span className="adm-badge pub">Changed</span>
            )}
          </div>
        </Cell>
        {inputs(`fx.${index}`, draft, large ? { ...errors, rateToInr: undefined } : errors, code, onEdit)}
        <td className="fx-use" data-label="Colleges using">
          {using === 0 ? 'None' : `${using} · ${live} live`}
        </td>
        <td className="fx-act" data-label="Actions">
          <div className="fx-btns">
            <button className={small} type="submit" name="intent" value={`save:${code}`} disabled={busy}>
              Save
            </button>
            {item.hasRate && (
              <button className={small} type="button" onClick={() => onAsk(true)} disabled={asking} aria-expanded={asking}>
                Delete
              </button>
            )}
          </div>
        </td>
      </tr>
      {(asking || large || errors.row) && (
        <tr>
          <td className="fx-full" colSpan={6}>
            {asking && (
              <div className="fx-bar" style={{ margin: 0 }}>
                <span>
                  Remove the {code} rate? Are you sure?
                  {using > 0 && ` ${using} ${using === 1 ? 'college loses its' : 'colleges lose their'} rupee total.`}
                </span>
                <span className="fx-btns">
                  <button className={small} type="submit" name="intent" value={`delete:${code}`} disabled={busy}>
                    {busy ? 'Removing…' : 'Yes, remove'}
                  </button>
                  <button className={small} type="button" onClick={() => onAsk(false)}>
                    Cancel
                  </button>
                </span>
              </div>
            )}
            {large && (
              <div className="fx-bar" role="alert" style={{ margin: 0 }}>
                <p className="err-msg" style={{ margin: 0 }}>
                  This changes the rate by more than 20% ({showRate(large.old)} → {showRate(large.next)}). Is that right?
                </p>
                <span className="fx-btns">
                  <button className={small} type="submit" name="intent" value={confirmIntent} disabled={busy}>
                    Confirm
                  </button>
                  <button className={small} type="button" onClick={onPutBack}>
                    Cancel
                  </button>
                </span>
              </div>
            )}
            {errors.row && (
              <p className="err-msg" role="alert" style={{ margin: asking || large ? '8px 0 0' : 0 }}>
                {errors.row}
              </p>
            )}
          </td>
        </tr>
      )}
    </Fragment>
  )
}

function AddRow(props: { draft: Draft; errors: RowErrors; busy: boolean; onEdit: (field: DraftField, value: string) => void }) {
  const { draft, errors, busy, onEdit } = props
  return (
    <Fragment>
      <tr>
        <Cell className="fx-code" label="Add currency" error={errors.currency}>
          <input
            className="input"
            name={`${NEW}.currency`}
            value={draft.currency}
            maxLength={3}
            autoComplete="off"
            placeholder="AED"
            aria-label="Add currency: 3-letter code"
            aria-invalid={errors.currency ? true : undefined}
            onChange={(e) => onEdit('currency', e.target.value.toUpperCase())}
          />
        </Cell>
        {inputs(NEW, draft, errors, 'New currency', onEdit)}
        <td className="fx-use" data-label="Colleges using">
          <span className="hint">New</span>
        </td>
        <td className="fx-act" data-label="Actions">
          <div className="fx-btns">
            <button className={small} type="submit" name="intent" value={`save:${NEW}`} disabled={busy}>
              Add
            </button>
          </div>
        </td>
      </tr>
      {errors.row && (
        <tr>
          <td className="fx-full" colSpan={6}>
            <p className="err-msg" role="alert" style={{ margin: 0 }}>
              {errors.row}
            </p>
          </td>
        </tr>
      )}
    </Fragment>
  )
}
