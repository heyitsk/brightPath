import { isRouteErrorResponse, Link, useRouteError } from 'react-router'

/** ErrorBoundary for the section pages: the message shows inside the admin shell. */
export function SectionError() {
  const error = useRouteError()
  let title = 'Something went wrong'
  let detail = 'Please try again in a moment.'
  if (isRouteErrorResponse(error)) {
    title = error.status === 404 ? 'Not found' : `Error ${error.status}`
    if (typeof error.data === 'string' && error.data) detail = error.data
  }
  return (
    <div className="adm-card">
      <h1 style={{ fontSize: '1.5rem', marginTop: 0 }}>{title}</h1>
      <p>{detail}</p>
      <p>
        <Link to="/admin">Back to admin</Link>
      </p>
    </div>
  )
}
