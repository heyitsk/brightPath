import { useEffect, useRef } from 'react'
import { Form, useNavigation } from 'react-router'
import { FormError } from '../AdminFormError'
import { FieldInput } from '../crud/fields'
import type { FieldDef, Opt } from '../crud/types'
import {
  CENTRAL,
  CONFIG_HINT,
  configText,
  DEFAULT_INTERVAL,
  KIND_OPTIONS,
  MAX_INTERVAL,
  MIN_INTERVAL,
  placeOf,
} from './sources'
import type { NewsSource } from './types'

export type SourceFormFailure = { formError?: string; fieldErrors: Record<string, string> }

/**
 * Add or edit a news source. Values are uncontrolled; after a save the saved values are put back
 * with form.reset() (not with a remount `key`, which left stale copies in the DOM).
 */
export function SourceForm(props: {
  source?: NewsSource
  states: Opt[] | null
  failure?: SourceFormFailure
  submitLabel: string
}) {
  const { source, states, failure, submitLabel } = props
  const busy = useNavigation().state !== 'idle'
  const errors = failure?.fieldErrors ?? {}
  const editing = source !== undefined

  const fields: { f: FieldDef; value: string | boolean; options?: Opt[]; locked?: boolean }[] = [
    {
      f: {
        name: 'slug',
        label: 'Slug',
        kind: 'text',
        required: true,
        hint: 'Lower-case letters, digits and single hyphens, e.g. uttar-pradesh. Cannot be changed later.',
      },
      value: source?.slug ?? '',
      locked: editing,
    },
    { f: { name: 'name', label: 'Name', kind: 'text', required: true }, value: source?.name ?? '' },
  ]
  if (states) {
    fields.push({
      f: { name: 'stateId', label: 'State', kind: 'select', required: true },
      value: source ? (source.state?.id ?? CENTRAL) : CENTRAL,
      options: [{ value: CENTRAL, label: 'Central (national body)' }, ...states],
    })
  }
  fields.push(
    {
      f: {
        name: 'kind',
        label: 'Kind',
        kind: 'select',
        required: true,
        hint: 'How the source is read. A JavaScript page cannot be read yet, so it cannot be switched on.',
      },
      value: source?.kind ?? '',
      options: KIND_OPTIONS,
    },
    {
      f: {
        name: 'listUrl',
        label: 'List address',
        kind: 'text',
        required: true,
        hint: 'The full http(s) address of the page, feed or API that lists the notices.',
      },
      value: source?.listUrl ?? '',
    },
    {
      f: { name: 'siteUrl', label: 'Site address', kind: 'text', hint: "Optional. The site's home page." },
      value: source?.siteUrl ?? '',
    },
    {
      f: {
        name: 'isActive',
        label: 'On (fetched on a schedule)',
        kind: 'checkbox',
        hint: editing
          ? 'Switching a source back on gives it a clean health record.'
          : 'Leave it off for now: test the source first, then switch it on.',
      },
      value: source?.isActive ?? false,
    },
    {
      f: {
        name: 'fetchIntervalMin',
        label: 'Fetch interval (minutes)',
        kind: 'number',
        min: MIN_INTERVAL,
        max: MAX_INTERVAL,
        hint: `From ${MIN_INTERVAL} to ${MAX_INTERVAL}. ${DEFAULT_INTERVAL} is every 3 hours.`,
      },
      value: String(source ? Number(source.fetchIntervalMin) : DEFAULT_INTERVAL),
    },
  )
  const config = configText(source?.config ?? {})
  const notes = source?.notes ?? ''

  const saved = JSON.stringify([fields.map((x) => x.value), config, notes])
  const formRef = useRef<HTMLFormElement>(null)
  useEffect(() => {
    formRef.current?.reset()
  }, [saved])

  const configError = errors.config
  return (
    <Form method="post" className="adm-form" ref={formRef}>
      <input type="hidden" name="intent" value="save" />
      <input type="hidden" name="isActiveShown" value="1" />
      <FormError message={failure?.formError} />
      {fields.map(({ f, value, options, locked }) => (
        <FieldInput key={f.name} f={f} value={value} error={errors[f.name]} options={options} locked={locked} />
      ))}
      {!states && source && (
        <div className="field">
          <p style={{ margin: 0 }}>
            <strong>State:</strong> {placeOf(source)}
          </p>
          {errors.stateId && <p className="err-msg">{errors.stateId}</p>}
        </div>
      )}
      <div className={configError ? 'field err' : 'field'}>
        <label htmlFor="config">Settings (JSON)</label>
        <textarea
          className="input"
          id="config"
          name="config"
          rows={12}
          spellCheck={false}
          defaultValue={config}
          style={{ fontFamily: 'var(--mono)', fontSize: '.8125rem' }}
          aria-invalid={configError ? true : undefined}
          aria-describedby={configError ? 'config-err' : undefined}
        />
        <p className="hint">{CONFIG_HINT}</p>
        {configError && (
          <p className="err-msg" id="config-err">
            {configError}
          </p>
        )}
      </div>
      <FieldInput
        f={{ name: 'notes', label: 'Notes', kind: 'textarea', hint: 'Internal notes for staff.' }}
        value={notes}
        error={errors.notes}
      />
      <div className="adm-actions">
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? 'Saving…' : submitLabel}
        </button>
      </div>
    </Form>
  )
}
