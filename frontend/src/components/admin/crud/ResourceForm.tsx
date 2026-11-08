import { Form, Link, useNavigation } from 'react-router'
import type { ApiFailure } from '../../../api/errors'
import { FormError } from '../AdminFormError'
import { FieldInput } from './fields'
import { initialValue } from './form-data'
import type { Opt, ResourceConfig, Row } from './types'

/** Create / edit form. Required fields carry a *, API field errors show under each field. */
export function ResourceForm(props: {
  cfg: ResourceConfig
  row?: Row
  lookups: Record<string, Opt[]>
  failure?: ApiFailure
}) {
  const { cfg, row, lookups, failure } = props
  const busy = useNavigation().state !== 'idle'
  const base = `/admin/${cfg.key}`
  return (
    <>
      <p>
        <Link to={base}>← {cfg.title}</Link>
      </p>
      <h1 style={{ marginTop: 0 }}>{row ? `Edit ${cfg.label(row)}` : `New ${cfg.singular}`}</h1>
      <p className="hint">
        Fields marked <strong>*</strong> are required.
      </p>
      <Form method="post" className="adm-form">
        <FormError message={failure?.formError} />
        {cfg.fields.map((f) => {
          const options = f.lookup ? lookups[f.lookup] : f.options
          return (
            <FieldInput
              key={f.name}
              f={f}
              value={initialValue(f, row)}
              error={failure?.fieldErrors[f.name]}
              options={options}
              locked={Boolean(row && f.fixedOnEdit)}
            />
          )
        })}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? 'Saving…' : row ? 'Save changes' : `Create ${cfg.singular}`}
          </button>
          <Link className="btn btn-light" to={base}>
            Cancel
          </Link>
          {row && cfg.api.remove && (
            <Link to={`${base}/${row.id}/delete`} style={{ marginLeft: 'auto' }}>
              Delete {cfg.singular}
            </Link>
          )}
        </div>
        {row && !cfg.api.remove && cfg.noDeleteNote && <p className="hint">{cfg.noDeleteNote}</p>}
      </Form>
    </>
  )
}
