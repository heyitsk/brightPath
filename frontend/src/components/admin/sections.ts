import type { paths } from '../../api/schema'

export type StaffUser =
  paths['/admin/auth/me']['get']['responses'][200]['content']['application/json']['user']
export type Role = StaffUser['role']

/** Admin sections and who may use them. ADMIN always sees everything. */
const SECTIONS: { label: string; roles: Role[] }[] = [
  { label: 'States', roles: ['EDITOR'] },
  { label: 'Countries', roles: ['EDITOR'] },
  { label: 'Sources', roles: ['EDITOR'] },
  { label: 'NMC notices', roles: ['EDITOR'] },
  { label: 'Staff', roles: [] },
]

export function sectionsFor(role: Role): string[] {
  return SECTIONS.filter((s) => role === 'ADMIN' || s.roles.includes(role)).map((s) => s.label)
}
