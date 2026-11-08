import type { paths } from '../../api/schema'

export type StaffUser =
  paths['/admin/auth/me']['get']['responses'][200]['content']['application/json']['user']
export type Role = StaffUser['role']

export type AdminSection = { label: string; href?: string }

/** Admin sections and who may use them. ADMIN always sees everything. No href = coming soon. */
const SECTIONS: (AdminSection & { roles: Role[] })[] = [
  { label: 'States', href: '/admin/states', roles: ['EDITOR'] },
  { label: 'Countries', href: '/admin/countries', roles: ['EDITOR'] },
  { label: 'Sources', href: '/admin/sources', roles: ['EDITOR'] },
  { label: 'NMC notices', href: '/admin/nmc-notices', roles: ['EDITOR'] },
  { label: 'Staff', href: '/admin/users', roles: [] },
  { label: 'Settings', href: '/admin/settings', roles: [] },
  { label: 'Disclaimers', href: '/admin/disclaimers', roles: [] },
  { label: 'Audit log', href: '/admin/audit-logs', roles: [] },
]

export function sectionsFor(role: Role): AdminSection[] {
  return SECTIONS.filter((s) => role === 'ADMIN' || s.roles.includes(role)).map(({ label, href }) => ({
    label,
    href,
  }))
}
