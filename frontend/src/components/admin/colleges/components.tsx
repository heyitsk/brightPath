import { useEffect, useRef, useState } from 'react'
import { Form, useNavigation } from 'react-router'
import type { ApiFailure } from '../../../api/errors'
import { FormError } from '../AdminFormError'
import type { Opt } from '../crud/types'
import { showDate, today } from '../crud/util'
import { Messages } from '../neet/common'
import { feeYears, MONTHS, PURPOSE_LABEL, PURPOSE_OPTIONS, STATUS_LABEL } from './data'
import type { College, Status } from './types'

export function CollegeStatusBadge({ status }: { status: Status }) {
  const cls = status === 'READY' ? 'adm-badge on' : status === 'ARCHIVED' ? 'adm-badge off' : 'adm-badge'
  return <span className={cls}>{STATUS_LABEL[status]}</span>
}

/** What still blocks "Mark ready", in the API's own plain words. */
export function ReadinessPanel({ college }: { college: College }) {
  const { readiness } = college
  return (
    <>
      {readiness.canMarkReady ? (
        <p className="callout" role="status">
          Every required detail is filled in.
          {college.status === 'DRAFT' ? ' This college can be marked ready.' : ''}
        </p>
      ) : (
        <Messages
          title={`Still missing (${readiness.missing.length}) before it can be marked ready`}
          items={readiness.missing.map((m) => m.message)}
          tone="problem"
        />
      )}
      <p className="hint">Fee years filled: {feeYears(readiness)}.</p>
    </>
  )
}

/** One checkbox per month; the form sends the ticked month numbers. */
export function MonthChecks({ name, value, error }: { name: string; value: number[]; error?: string }) {
  return (
    <fieldset className={error ? 'field err' : 'field'} style={{ border: 0, padding: 0, margin: '0 0 16px' }}>
      <legend className="legend">Intake months</legend>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '0 12px' }}>
        {MONTHS.map((m, i) => (
          <label className="check" key={m}>
            <input type="checkbox" name={name} value={i + 1} defaultChecked={value.includes(i + 1)} />
            <span>{m}</span>
          </label>
        ))}
      </div>
      <p className="hint">Months when admissions open.</p>
      {error && <p className="err-msg">{error}</p>}
    </fieldset>
  )
}

function PurposeSelect({ id, value }: { id: string; value?: string }) {
  return (
    <select className="select" id={id} name="purpose" defaultValue={value ?? ''} required>
      {!value && <option value="">Choose…</option>}
      {PURPOSE_OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

/** Linked sources: change purpose or date, unlink, or link another. */
export function SourcesPanel(props: { college: College; sources: Opt[]; failure?: ApiFailure }) {
  const { college, sources, failure } = props
  const busy = useNavigation().state !== 'idle'
  const err = failure?.fieldErrors ?? {}
  // Empty "Link a source" again once a link is added (failed attempts keep what was chosen).
  // Not done with a `key` on the form: remounting duplicated the page's forms in the DOM.
  const linkCount = college.sources.length
  const addRef = useRef<HTMLFormElement>(null)
  useEffect(() => {
    addRef.current?.reset()
  }, [linkCount])
  return (
    <>
      <FormError message={failure?.formError} />
      {college.sources.length === 0 ? (
        <p>No sources linked yet. A college needs at least one before it can be marked ready.</p>
      ) : (
        <div className="tbl-wrap" style={{ marginBottom: 16 }}>
          <table>
            <thead>
              <tr>
                <th>Source</th>
                <th>Purpose and checked date</th>
              </tr>
            </thead>
            <tbody>
              {college.sources.map((s) => (
                <tr key={s.id}>
                  <td>
                    {s.source.url ? (
                      <a href={s.source.url} target="_blank" rel="noreferrer noopener">
                        {s.source.title}
                      </a>
                    ) : (
                      s.source.title
                    )}
                    <p className="hint" style={{ margin: 0 }}>
                      {PURPOSE_LABEL[s.purpose]}, checked {showDate(s.checkedAt)}
                    </p>
                  </td>
                  <td>
                    <Form method="post" className="adm-actions" style={{ alignItems: 'flex-end' }}>
                      <input type="hidden" name="linkId" value={s.id} />
                      <div className="field" style={{ margin: 0 }}>
                        <label htmlFor={`purpose-${s.id}`}>Purpose</label>
                        <PurposeSelect id={`purpose-${s.id}`} value={s.purpose} />
                      </div>
                      <div className="field" style={{ margin: 0 }}>
                        <label htmlFor={`checked-${s.id}`}>Checked on</label>
                        <input
                          className="input"
                          id={`checked-${s.id}`}
                          name="checkedAt"
                          type="date"
                          max={today()}
                          defaultValue={s.checkedAt.slice(0, 10)}
                          required
                        />
                      </div>
                      <button className="btn btn-secondary" type="submit" name="intent" value="source-update" disabled={busy}>
                        Save
                      </button>
                      <button className="btn btn-secondary" type="submit" name="intent" value="source-remove" disabled={busy}>
                        Unlink
                      </button>
                    </Form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3>Link a source</h3>
      <Form method="post" className="adm-form" ref={addRef}>
        <input type="hidden" name="intent" value="source-add" />
        <div className={err.sourceId ? 'field err' : 'field'}>
          <label htmlFor="link-source">Source</label>
          <select className="select" id="link-source" name="sourceId" defaultValue="" required>
            <option value="">Choose…</option>
            {sources.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <p className="hint">Add the document under Sources first if it is not in the list.</p>
          {err.sourceId && <p className="err-msg">{err.sourceId}</p>}
        </div>
        <div className={err.purpose ? 'field err' : 'field'}>
          <label htmlFor="link-purpose">Purpose</label>
          <PurposeSelect id="link-purpose" />
          {err.purpose && <p className="err-msg">{err.purpose}</p>}
        </div>
        <div className={err.checkedAt ? 'field err' : 'field'}>
          <label htmlFor="link-checked">Checked on</label>
          <input className="input" id="link-checked" name="checkedAt" type="date" max={today()} defaultValue={today()} required />
          {err.checkedAt && <p className="err-msg">{err.checkedAt}</p>}
        </div>
        <button className="btn btn-secondary" type="submit" disabled={busy}>
          Link source
        </button>
      </Form>
    </>
  )
}

type FaqRow = { key: number; question: string; answer: string }

/** Edit the whole FAQ list in the browser, then save it in one go (PUT replaces the list). */
export function FaqEditor(props: { faqs: College['faqs']; failure?: ApiFailure }) {
  const { faqs, failure } = props
  const busy = useNavigation().state !== 'idle'
  const toRows = (list: typeof faqs): FaqRow[] => list.map((f, i) => ({ key: i, ...f }))
  const [rows, setRows] = useState<FaqRow[]>(() => toRows(faqs))
  // Start again from the server's list when it changes (a save got through). Saving another
  // section or a failed save leaves it the same, so unsaved questions are kept.
  // Not done with a `key`: remounting duplicated the page's forms in the DOM.
  const saved = JSON.stringify(faqs)
  const [seen, setSeen] = useState(saved)
  if (saved !== seen) {
    setSeen(saved)
    setRows(toRows(faqs))
  }
  const err = failure?.fieldErrors ?? {}

  const edit = (key: number, part: 'question' | 'answer', text: string) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, [part]: text } : r)))
  const move = (i: number, by: -1 | 1) =>
    setRows((rs) => {
      const out = [...rs]
      ;[out[i], out[i + by]] = [out[i + by], out[i]]
      return out
    })
  const add = () => {
    setRows((rs) => [...rs, { key: Math.max(-1, ...rs.map((r) => r.key)) + 1, question: '', answer: '' }])
  }

  return (
    <Form method="post" className="adm-form adm-wide">
      <input type="hidden" name="intent" value="faqs" />
      <input type="hidden" name="faqCount" value={rows.length} />
      <FormError message={failure?.formError} />
      {rows.length === 0 && <p>No questions yet.</p>}
      {rows.map((r, i) => (
        <div key={r.key} className="adm-card" style={{ maxWidth: 'none', marginBottom: 16 }}>
          <div className={err[`items.${i}.question`] ? 'field err' : 'field'}>
            <label htmlFor={`faq-${r.key}-q`}>Question {i + 1}</label>
            <input
              className="input"
              id={`faq-${r.key}-q`}
              name={`faq.${i}.question`}
              value={r.question}
              onChange={(e) => edit(r.key, 'question', e.target.value)}
              required
            />
            {err[`items.${i}.question`] && <p className="err-msg">{err[`items.${i}.question`]}</p>}
          </div>
          <div className={err[`items.${i}.answer`] ? 'field err' : 'field'}>
            <label htmlFor={`faq-${r.key}-a`}>Answer</label>
            <textarea
              className="input"
              id={`faq-${r.key}-a`}
              name={`faq.${i}.answer`}
              rows={3}
              value={r.answer}
              onChange={(e) => edit(r.key, 'answer', e.target.value)}
              required
            />
            {err[`items.${i}.answer`] && <p className="err-msg">{err[`items.${i}.answer`]}</p>}
          </div>
          <div className="adm-actions">
            <button className="btn btn-secondary" type="button" onClick={() => move(i, -1)} disabled={i === 0}>
              Move up
            </button>
            <button className="btn btn-secondary" type="button" onClick={() => move(i, 1)} disabled={i === rows.length - 1}>
              Move down
            </button>
            <button className="btn btn-secondary" type="button" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>
              Remove
            </button>
          </div>
        </div>
      ))}
      <div className="adm-actions">
        <button className="btn btn-secondary" type="button" onClick={add}>
          Add a question
        </button>
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save FAQs'}
        </button>
      </div>
    </Form>
  )
}
