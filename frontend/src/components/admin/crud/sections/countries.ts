import { adminApi } from '../../../../api/client.browser'
import type { paths } from '../../../../api/schema'
import { defineResource } from '../define'
import type { ReqBody } from '../types'
import { showDate } from '../util'

type Country = paths['/admin/countries']['get']['responses'][200]['content']['application/json']['items'][number]
type Create = ReqBody<paths['/admin/countries']['post']>
type Update = ReqBody<paths['/admin/countries/{id}']['patch']>

const STATUS = [
  { value: 'LIVE', label: 'Live' },
  { value: 'COMING_SOON', label: 'Coming soon' },
]

export const countries = defineResource<Country>({
  key: 'countries',
  title: 'Countries',
  singular: 'country',
  recordKey: 'country',
  label: (r) => r.name,
  noDeleteNote: 'Countries are never deleted. To hide one from the public site, set the status to Coming soon.',
  columns: [
    { header: 'Name', primary: true, cell: (r) => r.name },
    { header: 'ISO', cell: (r) => r.isoCode },
    { header: 'Status', cell: (r) => (r.status === 'LIVE' ? 'Live' : 'Coming soon') },
    { header: 'Active NMC notices', cell: (r) => String(r.activeNmcNoticeCount) },
    { header: 'Near India', hideSm: true, cell: (r) => (r.nearIndia ? 'Yes' : 'No') },
    { header: 'Updated', hideSm: true, cell: (r) => showDate(r.updatedAt) },
  ],
  fields: [
    { name: 'slug', label: 'Slug', kind: 'text', required: true, fixedOnEdit: true, maxLength: 60, hint: 'Lower-case words joined by hyphens, e.g. russia. Used in public URLs.' },
    { name: 'name', label: 'Name', kind: 'text', required: true, maxLength: 80 },
    { name: 'isoCode', label: 'ISO code', kind: 'text', required: true, maxLength: 2, hint: '2 capital letters, e.g. RU.' },
    { name: 'status', label: 'Status', kind: 'select', options: STATUS, defaultValue: 'COMING_SOON', required: true },
    { name: 'nearIndia', label: 'Near India', kind: 'checkbox' },
    { name: 'typicalFlightFromDelhi', label: 'Typical flight from Delhi', kind: 'text', nullable: true, maxLength: 120, hint: 'For example "5 hours". Leave empty if unknown.' },
    { name: 'sortOrder', label: 'Sort order', kind: 'number', min: 0, max: 9999, defaultValue: '1000', hint: '0 to 9999. Lower numbers come first.' },
    { name: 'aliases', label: 'Aliases', kind: 'tags', hint: 'Other names people search for, separated by commas.' },
  ],
  filters: [{ name: 'status', label: 'Status', kind: 'select', options: STATUS }],
  api: {
    list: (q) =>
      adminApi.GET('/admin/countries', {
        params: { query: { status: q.status === 'LIVE' || q.status === 'COMING_SOON' ? q.status : undefined } },
      }),
    get: (id) => adminApi.GET('/admin/countries/{id}', { params: { path: { id } } }),
    create: (body) => adminApi.POST('/admin/countries', { body: body as Create }),
    update: (id, body) => adminApi.PATCH('/admin/countries/{id}', { params: { path: { id } }, body: body as Update }),
  },
})
