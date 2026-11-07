import type { Role } from '../sections'

export const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: 'ADMIN', label: 'Admin (everything)' },
  { value: 'EDITOR', label: 'Editor (content)' },
  { value: 'COUNSELLOR', label: 'Counsellor' },
]

export const isRole = (v: string): v is Role => ROLE_OPTIONS.some((o) => o.value === v)
