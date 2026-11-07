import { isRouteErrorResponse, Link } from 'react-router'

/**
 * Route-level error page, rendered inside the shell so a missing page still shows the header,
 * footer and sample notice. Errors that are not responses go up to the root boundary.
 */
export function PageError({ error, notFoundTitle }: { error: unknown; notFoundTitle: string }) {
  if (!isRouteErrorResponse(error)) throw error
  const notFound = error.status === 404
  const message = (error.data as { message?: string } | undefined)?.message
  return (
    <div className="wrap section">
      <h1>{notFound ? notFoundTitle : `Error ${error.status}`}</h1>
      <p className="lead">{message ?? 'Please try again in a moment.'}</p>
      <p style={{ marginTop: 20 }}>
        <Link className="btn btn-secondary" to="/">
          Back to the home page
        </Link>
      </p>
    </div>
  )
}
