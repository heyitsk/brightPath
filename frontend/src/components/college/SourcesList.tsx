import { Icon } from '../Icon'
import type { CollegePage } from '../../data/colleges'
import { formatDate, NO_DATE } from '../shared/format'

const PURPOSE_TITLE: Record<string, string> = {
  WDOMS: 'WDOMS entry',
  FEE_NOTICE: 'College fee notice',
  NMC_NOTICES: 'NMC public notices page',
  NMC_RECOGNITION: 'NMC recognition list',
  SEAT_LIST: 'Seat list',
  COUNSELLING: 'Counselling notice',
  COLLEGE_WEBSITE: 'College website',
}

/** "Sources and dates": every source with the date it was last checked. */
export function SourcesList({ sources }: { sources: CollegePage['sources'] }) {
  return (
    <>
      <h2 id="sources">Sources and dates</h2>
      <ul className="srcs">
        {sources.map((s) => {
          const title = s.title || PURPOSE_TITLE[s.purpose] || s.purpose
          return (
            <li key={`${s.purpose}-${s.title}-${s.url ?? ''}`}>
              {s.url ? (
                <a href={s.url} rel="noopener noreferrer" target="_blank">
                  {title} <Icon name="ext" size={14} />
                </a>
              ) : (
                <span>{title}</span>
              )}
              <span className="when">{s.checkedAt ? formatDate(s.checkedAt) : NO_DATE}</span>
            </li>
          )
        })}
      </ul>
      <p className="small muted" style={{ marginTop: 12 }}>
        Spotted something out of date? Tell us and we'll check it. The form is not connected yet.
      </p>
    </>
  )
}
