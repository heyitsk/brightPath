import type { ReactNode } from 'react'

/** Every admin record has an id; the rest comes from schema.d.ts row types. */
export type Row = { id: string } & Record<string, unknown>
export type Opt = { value: string; label: string }

/** Minimal shape of an openapi-fetch result, so one runtime can drive every section. */
export type ApiCall = Promise<{ data?: unknown; error?: unknown; response: Response }>

export type FieldKind = 'text' | 'textarea' | 'select' | 'checkbox' | 'number' | 'date' | 'tags'

export type FieldDef = {
  /** Exact field name from schema.d.ts. */
  name: string
  label: string
  kind: FieldKind
  /** Required on create (marked with *). */
  required?: boolean
  /** Nullable in the schema: clearing it on edit sends null. */
  nullable?: boolean
  hint?: string
  /** Static options (enums from schema.d.ts) or a named lookup loaded from the API. */
  options?: Opt[]
  lookup?: string
  /** Selects only: text of the empty choice (default "None", or "Choose…" when required). */
  emptyLabel?: string
  /** Enum values shown but not selectable. */
  disabledOptions?: string[]
  /** Shown read-only on edit and never sent (slug, scope: fixed by the API). */
  fixedOnEdit?: boolean
  maxLength?: number
  min?: number
  max?: number
  /** Dates only: block future dates (the API rejects them). */
  noFuture?: boolean
  /** Start value on create; 'today' for dates. */
  defaultValue?: string | boolean
  /** Reads the form value from a record when it is not simply row[name]. */
  value?: (row: Row) => unknown
}

export type FilterDef = {
  name: string
  label: string
  kind: 'select' | 'text'
  options?: Opt[]
}

export type ColumnDef<R extends Row = Row> = {
  header: string
  cell: (row: R) => ReactNode
  /** First column: links to the edit page. */
  primary?: boolean
  hideSm?: boolean
}

export type ResourceConfig<R extends Row = Row> = {
  /** URL segment: /admin/<key> */
  key: string
  title: string
  singular: string
  /** Key of the record in GET/POST/PATCH responses ({ state: … }). */
  recordKey: string
  columns: ColumnDef<R>[]
  fields: FieldDef[]
  filters: FilterDef[]
  /** Name shown in the delete confirmation. */
  label: (row: R) => string
  /** Shown on the edit page when the API has no DELETE. */
  noDeleteNote?: string
  lookups?: Record<string, () => Promise<Opt[]>>
  api: {
    list: (query: Record<string, string>) => ApiCall
    get: (id: string) => ApiCall
    create: (body: Record<string, unknown>) => ApiCall
    update: (id: string, body: Record<string, unknown>) => ApiCall
    remove?: (id: string) => ApiCall
  }
}

/** Body type of a POST/PATCH operation, straight from schema.d.ts. */
export type ReqBody<T> = T extends { requestBody?: { content: { 'application/json': infer B } } }
  ? B
  : never
