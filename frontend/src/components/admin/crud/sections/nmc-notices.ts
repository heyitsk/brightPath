import { adminApi } from '../../../../api/client.browser'
import { handleApiError, safeCall } from '../../../../api/errors'
import type { paths } from '../../../../api/schema'
import { defineResource } from '../define'
import type { ReqBody } from '../types'
import { showDate } from '../util'

type Notice = paths['/admin/nmc-notices']['get']['responses'][200]['content']['application/json']['items'][number]
type Create = ReqBody<paths['/admin/nmc-notices']['post']>
type Update = ReqBody<paths['/admin/nmc-notices/{id}']['patch']>

export const nmcNotices = defineResource<Notice>({
  key: 'nmc-notices',
  title: 'NMC notices',
  singular: 'notice',
  recordKey: 'notice',
  label: (r) => r.title,
  lookups: {
    countries: async () => {
      const result = await safeCall(adminApi.GET('/admin/countries'))
      if (!('data' in result) || !result.data) {
        const failure = handleApiError(result)
        throw new Response(failure.formError, { status: failure.status || 503 })
      }
      return result.data.items.map((c) => ({ value: c.id, label: c.name }))
    },
  },
  columns: [
    { header: 'Title', primary: true, cell: (r) => r.title },
    { header: 'Severity', cell: (r) => (r.severity === 'WARNING' ? 'Warning' : 'Advisory') },
    { header: 'Country', cell: (r) => r.country?.name ?? '-' },
    { header: 'Published', hideSm: true, cell: (r) => showDate(r.publishedAt) },
    { header: 'Checked', hideSm: true, cell: (r) => showDate(r.checkedAt) },
    { header: 'Active', cell: (r) => (r.isActive ? 'Active' : 'Retired') },
  ],
  fields: [
    {
      name: 'scope',
      label: 'Scope',
      kind: 'select',
      required: true,
      fixedOnEdit: true,
      defaultValue: 'COUNTRY',
      options: [
        { value: 'COUNTRY', label: 'Country' },
        { value: 'COLLEGE', label: 'College' },
      ],
      disabledOptions: ['COLLEGE'],
    },
    { name: 'countryId', label: 'Country', kind: 'select', required: true, lookup: 'countries', value: (r) => (r as Notice).country?.id },
    { name: 'title', label: 'Title', kind: 'text', required: true, maxLength: 300 },
    { name: 'url', label: 'URL', kind: 'text', required: true, maxLength: 2000, hint: 'Link to the NMC notice, starting with http:// or https://.' },
    {
      name: 'severity',
      label: 'Severity',
      kind: 'select',
      required: true,
      options: [
        { value: 'ADVISORY', label: 'Advisory' },
        { value: 'WARNING', label: 'Warning' },
      ],
    },
    { name: 'publishedAt', label: 'Published on', kind: 'date', required: true, noFuture: true, hint: 'Cannot be in the future.' },
    { name: 'checkedAt', label: 'Last checked on', kind: 'date', required: true, noFuture: true, defaultValue: 'today', hint: 'Set a new date to re-confirm the notice is still current.' },
    { name: 'isActive', label: 'Active (shown on the public site)', kind: 'checkbox', defaultValue: true, hint: 'To retire a real notice, untick this instead of deleting it.' },
  ],
  filters: [
    {
      name: 'isActive',
      label: 'Active',
      kind: 'select',
      options: [
        { value: 'true', label: 'Active' },
        { value: 'false', label: 'Retired' },
      ],
    },
  ],
  api: {
    list: (q) =>
      adminApi.GET('/admin/nmc-notices', {
        params: { query: { isActive: q.isActive ? q.isActive === 'true' : undefined, cursor: q.cursor || undefined } },
      }),
    get: (id) => adminApi.GET('/admin/nmc-notices/{id}', { params: { path: { id } } }),
    create: (body) => adminApi.POST('/admin/nmc-notices', { body: body as Create }),
    update: (id, body) => adminApi.PATCH('/admin/nmc-notices/{id}', { params: { path: { id } }, body: body as Update }),
    remove: (id) => adminApi.DELETE('/admin/nmc-notices/{id}', { params: { path: { id } } }),
  },
})
