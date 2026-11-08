import { adminApi } from '../../../../api/client.browser'
import type { paths } from '../../../../api/schema'
import { defineResource } from '../define'
import type { ReqBody } from '../types'
import { showDate } from '../util'

type Source = paths['/admin/sources']['get']['responses'][200]['content']['application/json']['items'][number]
type Create = ReqBody<paths['/admin/sources']['post']>
type Update = ReqBody<paths['/admin/sources/{id}']['patch']>
type Kind = Source['kind']

const KINDS: Kind[] = ['NTA', 'MCC', 'STATE_COUNSELLING', 'NMC', 'WDOMS', 'COLLEGE_WEBSITE', 'OTHER']
const KIND_OPTIONS = KINDS.map((k) => ({ value: k, label: k.replace(/_/g, ' ') }))

export const sources = defineResource<Source>({
  key: 'sources',
  title: 'Sources',
  singular: 'source',
  recordKey: 'source',
  label: (r) => r.title,
  columns: [
    { header: 'Title', primary: true, cell: (r) => r.title },
    { header: 'Kind', cell: (r) => r.kind.replace(/_/g, ' ') },
    { header: 'Publisher', hideSm: true, cell: (r) => r.publisher ?? '-' },
    { header: 'Updated', hideSm: true, cell: (r) => showDate(r.updatedAt) },
  ],
  fields: [
    { name: 'kind', label: 'Kind', kind: 'select', required: true, options: KIND_OPTIONS },
    { name: 'title', label: 'Title', kind: 'text', required: true, maxLength: 200 },
    { name: 'publisher', label: 'Publisher', kind: 'text', nullable: true, maxLength: 120 },
    { name: 'url', label: 'URL', kind: 'text', nullable: true, maxLength: 2000, hint: 'A full link starting with http:// or https://.' },
    { name: 'notes', label: 'Notes', kind: 'textarea', nullable: true, maxLength: 2000 },
  ],
  filters: [
    { name: 'kind', label: 'Kind', kind: 'select', options: KIND_OPTIONS },
    { name: 'q', label: 'Search title or publisher', kind: 'text' },
  ],
  api: {
    list: (q) =>
      adminApi.GET('/admin/sources', {
        params: {
          query: {
            kind: KINDS.find((k) => k === q.kind),
            q: q.q || undefined,
            cursor: q.cursor || undefined,
          },
        },
      }),
    get: (id) => adminApi.GET('/admin/sources/{id}', { params: { path: { id } } }),
    create: (body) => adminApi.POST('/admin/sources', { body: body as Create }),
    update: (id, body) => adminApi.PATCH('/admin/sources/{id}', { params: { path: { id } }, body: body as Update }),
    remove: (id) => adminApi.DELETE('/admin/sources/{id}', { params: { path: { id } } }),
  },
})
