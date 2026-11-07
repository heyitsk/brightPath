import createClient from 'openapi-fetch'
import type { paths } from './schema'

/**
 * Typed API client for the admin area (browser only). Admin pages call the backend directly
 * with the staff session cookie, so every request sends credentials and the CSRF header.
 * Never import this from public pages; they use client.server.ts.
 */
const baseUrl = import.meta.env.VITE_API_URL
if (!baseUrl) {
  throw new Error('VITE_API_URL is not set. Copy .env.example to .env and set it.')
}

export const adminApi = createClient<paths>({
  baseUrl,
  credentials: 'include',
  headers: { 'X-BP-Admin': '1' },
})
