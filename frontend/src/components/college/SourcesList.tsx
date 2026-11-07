import { Icon } from '../Icon'
import type { CollegeDetail } from '../../data/colleges'
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

/** "Sources and dates": every source link with the date it was last checked. */
export function SourcesList({ detail }: { detail: CollegeDetail }) {
  return (
    <>
      <h2 id="sources">Sources and dates</h2>
      <ul className="srcs">
        {detail.sourceLinks.map((l) => {
          const source = detail.sources.find((s) => s.id === l.sourceId)
          const title = source?.title ?? PURPOSE_TITLE[l.purpose]
          return (
            <li key={`${l.purpose}-${l.sourceId}`}>
              <a href={l.url} rel="noopener noreferrer" target="_blank">
                {title} <Icon name="ext" size={14} />
              </a>
              <span className="when">{l.checkedAt ? formatDate(l.checkedAt) : NO_DATE}</span>
            </li>
          )
        })}
      </ul>
      <p className="small muted" style={{ marginTop: 12 }}>
        Spotted something out of date? Tell us and we'll check it within [reply time]. The form is not connected yet.
      </p>
    </>
  )
}
