import { Form, Link, useNavigation } from 'react-router'
import type { ApiFailure } from '../../../api/errors'
import { FormError } from '../AdminFormError'
import type { ResourceConfig, Row } from './types'

/** "Are you sure?" step before a DELETE. */
export function DeleteConfirm(props: { cfg: ResourceConfig; row: Row; failure?: ApiFailure }) {
  const { cfg, row, failure } = props
  const busy = useNavigation().state !== 'idle'
  return (
    <div className="adm-card">
      <h1 style={{ fontSize: '1.5rem', marginTop: 0 }}>Delete {cfg.singular}?</h1>
      <p>
        <strong>{cfg.label(row)}</strong> will be removed. This cannot be undone.
      </p>
      <Form method="post">
        <FormError message={failure?.formError} />
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? 'Deleting…' : `Delete ${cfg.singular}`}
          </button>
          <Link className="btn btn-light" to={`/admin/${cfg.key}/${row.id}`}>
            Cancel
          </Link>
        </div>
      </Form>
    </div>
  )
}
