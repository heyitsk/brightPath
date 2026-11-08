import { ROLE_OPTIONS } from './roles'

export function RoleSelect(props: { value?: string; error?: string; blank?: boolean }) {
  const { value = '', error, blank } = props
  return (
    <div className={error ? 'field err' : 'field'}>
      <label htmlFor="role">Role</label>
      <select className="select" id="role" name="role" defaultValue={value} aria-invalid={error ? true : undefined}>
        {blank && <option value="">Choose…</option>}
        {ROLE_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {error && <p className="err-msg">{error}</p>}
    </div>
  )
}
