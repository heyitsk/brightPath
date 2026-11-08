import { adminApi } from '../../../../api/client.browser'
import type { paths } from '../../../../api/schema'
import { defineResource } from '../define'
import type { ReqBody } from '../types'
import { showDate } from '../util'

type State = paths['/admin/states']['get']['responses'][200]['content']['application/json']['items'][number]
type Create = ReqBody<paths['/admin/states']['post']>
type Update = ReqBody<paths['/admin/states/{id}']['patch']>

export const states = defineResource<State>({
  key: 'states',
  title: 'States',
  singular: 'state',
  recordKey: 'state',
  label: (r) => r.name,
  noDeleteNote: 'States are never deleted. To hide one from the public site, untick "Live".',
  columns: [
    { header: 'Name', primary: true, cell: (r) => r.name },
    { header: 'Code', cell: (r) => r.code },
    { header: 'Slug', hideSm: true, cell: (r) => r.slug },
    { header: 'Live', cell: (r) => (r.isLive ? 'Live' : 'Not live') },
    { header: 'Order', hideSm: true, cell: (r) => String(r.sortOrder) },
    { header: 'Updated', hideSm: true, cell: (r) => showDate(r.updatedAt) },
  ],
  fields: [
    { name: 'slug', label: 'Slug', kind: 'text', required: true, fixedOnEdit: true, maxLength: 60, hint: 'Lower-case words joined by hyphens, e.g. tamil-nadu. Used in public URLs.' },
    { name: 'name', label: 'Name', kind: 'text', required: true, maxLength: 80 },
    { name: 'code', label: 'Code', kind: 'text', required: true, maxLength: 3, hint: '2 or 3 capital letters, e.g. TN.' },
    { name: 'isLive', label: 'Live (shown on the public site)', kind: 'checkbox' },
    { name: 'sortOrder', label: 'Sort order', kind: 'number', min: 0, max: 9999, defaultValue: '1000', hint: '0 to 9999. Lower numbers come first.' },
    { name: 'aliases', label: 'Aliases', kind: 'tags', hint: 'Other names people search for, separated by commas.' },
  ],
  filters: [
    {
      name: 'isLive',
      label: 'Live',
      kind: 'select',
      options: [
        { value: 'true', label: 'Live' },
        { value: 'false', label: 'Not live' },
      ],
    },
  ],
  api: {
    list: (q) => adminApi.GET('/admin/states', { params: { query: { isLive: q.isLive ? q.isLive === 'true' : undefined } } }),
    get: (id) => adminApi.GET('/admin/states/{id}', { params: { path: { id } } }),
    create: (body) => adminApi.POST('/admin/states', { body: body as Create }),
    update: (id, body) => adminApi.PATCH('/admin/states/{id}', { params: { path: { id } }, body: body as Update }),
  },
})
