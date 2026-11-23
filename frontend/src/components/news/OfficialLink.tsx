import type { NewsCard } from '../../data/news'
import { Icon } from '../Icon'

/** "Read the official notice": always the official site, in a new tab. We never copy or embed the notice. */
export function OfficialLink({ item, className }: { item: Pick<NewsCard, 'originalUrl'>; className: string }) {
  return (
    <a className={className} href={item.originalUrl} target="_blank" rel="noopener noreferrer">
      Read the official notice <Icon name="ext" size={16} />
      <span className="sr"> (opens in a new tab)</span>
    </a>
  )
}
