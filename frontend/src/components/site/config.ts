import { useRouteLoaderData } from 'react-router'
import type { loader as rootLoader } from '../../root'

/** Root loader data: site config and navigation. Available on every page. */
export function useRootData() {
  const data = useRouteLoaderData<typeof rootLoader>('root')
  if (!data) throw new Error('Root loader data is missing.')
  return data
}

export function useSiteConfig() {
  return useRootData().siteConfig
}

/** Labelled placeholders shown while a config value is still null. */
export const SLOT = {
  brand: '[Brand name]',
  phone: '[Phone number]',
  email: '[Email address]',
  address: '[Office address]',
  hours: '[days and hours]',
} as const

export function telHref(phone: string | null) {
  return phone ? `tel:${phone.replace(/[^\d+]/g, '')}` : undefined
}

export function whatsappHref(number: string | null) {
  return number ? `https://wa.me/${number.replace(/\D/g, '')}` : undefined
}

export function mailHref(email: string | null) {
  return email ? `mailto:${email}` : undefined
}

/** Disclaimer text by key from /site/config. Never fall back to a typed copy. */
export function useDisclaimer(key: string) {
  return useSiteConfig().disclaimers[key]?.text ?? null
}
