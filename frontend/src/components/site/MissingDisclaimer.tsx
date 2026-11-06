/** Visible error when a disclaimer text is missing from /site/config. Never fall back to a copy. */
export function MissingDisclaimer({ name }: { name: string }) {
  return (
    <p className="err-msg" role="alert">
      {name} is missing from /site/config.
    </p>
  )
}
