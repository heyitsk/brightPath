/** Form-level error message in the existing error style. */
export function FormError({ message }: { message?: string }) {
  if (!message) return null
  return (
    <p className="err-msg" role="alert" style={{ marginBottom: 16 }}>
      {message}
    </p>
  )
}

/** Input with its label and per-field error, using the existing .field styles. */
export function TextField(props: {
  name: string
  label: string
  type?: string
  autoComplete?: string
  hint?: string
  error?: string
  defaultValue?: string
}) {
  const { name, label, type = 'text', autoComplete, hint, error, defaultValue } = props
  return (
    <div className={error ? 'field err' : 'field'}>
      <label htmlFor={name}>{label}</label>
      <input
        className="input"
        id={name}
        name={name}
        type={type}
        autoComplete={autoComplete}
        defaultValue={defaultValue}
        required
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${name}-err` : undefined}
      />
      {hint && <p className="hint">{hint}</p>}
      {error && (
        <p className="err-msg" id={`${name}-err`}>
          {error}
        </p>
      )}
    </div>
  )
}
