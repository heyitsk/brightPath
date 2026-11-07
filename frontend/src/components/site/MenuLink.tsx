import type { ComponentPropsWithoutRef } from 'react'
import { Link } from 'react-router'
import type { NavItem } from '../../data/navigation'

type Props = Omit<ComponentPropsWithoutRef<'a'>, 'href'> & { item: NavItem }

/**
 * A menu or list link that only links when its page is published.
 * Unpublished items keep the same look but render without an href, so they are not
 * focusable and never point to a page that does not exist yet.
 */
export function MenuLink({ item, children, ...rest }: Props) {
  const content = children ?? item.label
  if (!item.published) return <a {...rest}>{content}</a>
  return (
    <Link to={item.href} prefetch="intent" {...rest}>
      {content}
    </Link>
  )
}
