import { useState } from 'react'
import type { FieldDef, Opt } from './types'
import { showDate, today } from './util'

function Label({ f }: { f: FieldDef }) {
  return (
    <label htmlFor={f.name}>
      {f.label}
      {f.required && (
        <abbr title="required" style={{ textDecoration: 'none' }}>
          {' *'}
        </abbr>
      )}
    </label>
  )
}

function Notes({ f, error, extra }: { f: FieldDef; error?: string; extra?: string }) {
  const hint = [f.hint, extra].filter(Boolean).join(' ')
  return (
    <>
      {hint && <p className="hint">{hint}</p>}
      {error && (
        <p className="err-msg" id={`${f.name}-err`}>
          {error}
        </p>
      )}
    </>
  )
}

/** One form control with its label, required mark, hint and field error. */
export function FieldInput(props: {
  f: FieldDef
  value: string | boolean
  error?: string
  options?: Opt[]
  locked?: boolean
}) {
  const { f, value, error, options, locked } = props
  const common = {
    id: f.name,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error ? `${f.name}-err` : undefined,
  }
  const cls = error ? 'field err' : 'field'

  if (locked) {
    const shown =
      f.kind === 'select' ? (options?.find((o) => o.value === value)?.label ?? String(value)) : String(value)
    return (
      <div className="field">
        <label htmlFor={f.name}>{f.label}</label>
        <input className="input" id={f.name} value={shown} readOnly />
        <p className="hint">Fixed after creation.</p>
      </div>
    )
  }
  if (f.kind === 'checkbox') {
    return (
      <div className={cls}>
        <label className="check" htmlFor={f.name}>
          <input type="checkbox" name={f.name} defaultChecked={value === true} {...common} />
          <span>{f.label}</span>
        </label>
        <Notes f={f} error={error} />
      </div>
    )
  }
  if (f.kind === 'select') {
    return (
      <div className={cls}>
        <Label f={f} />
        <select className="select" name={f.name} defaultValue={String(value)} required={f.required} {...common}>
          {(!f.required || value === '') && <option value="">{f.emptyLabel ?? (f.required ? 'Choose…' : 'None')}</option>}
          {(options ?? []).map((o) => (
            <option key={o.value} value={o.value} disabled={f.disabledOptions?.includes(o.value)}>
              {o.label}
              {f.disabledOptions?.includes(o.value) ? ' (not available yet)' : ''}
            </option>
          ))}
        </select>
        <Notes f={f} error={error} />
      </div>
    )
  }
  if (f.kind === 'textarea') {
    return (
      <div className={cls}>
        <Label f={f} />
        <textarea
          className="input"
          name={f.name}
          rows={4}
          defaultValue={String(value)}
          required={f.required}
          maxLength={f.maxLength}
          {...common}
        />
        <Notes f={f} error={error} />
      </div>
    )
  }
  if (f.kind === 'date') return <DateField f={f} value={String(value)} error={error} />
  return (
    <div className={cls}>
      <Label f={f} />
      <input
        className="input"
        name={f.name}
        type={f.kind === 'number' ? 'number' : f.name === 'url' ? 'url' : 'text'}
        inputMode={f.kind === 'number' ? 'numeric' : undefined}
        defaultValue={String(value)}
        required={f.required}
        maxLength={f.maxLength}
        min={f.min}
        max={f.max}
        {...common}
      />
      <Notes f={f} error={error} />
    </div>
  )
}

/** Date input; the chosen date is also spelled out as "12 Oct 2026" under it. */
function DateField({ f, value, error }: { f: FieldDef; value: string; error?: string }) {
  const [picked, setPicked] = useState(value)
  return (
    <div className={error ? 'field err' : 'field'}>
      <Label f={f} />
      <input
        className="input"
        id={f.name}
        name={f.name}
        type="date"
        value={picked}
        onChange={(e) => setPicked(e.target.value)}
        required={f.required}
        max={f.noFuture ? today() : undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${f.name}-err` : undefined}
      />
      <Notes f={f} error={error} extra={picked ? `${showDate(picked)}.` : undefined} />
    </div>
  )
}
