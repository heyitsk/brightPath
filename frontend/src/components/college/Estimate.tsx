import { Icon } from '../Icon'
import { useDisclaimer } from '../site/config'
import { MissingDisclaimer } from '../site/MissingDisclaimer'

/** The advisory slip that travels with every estimate. Wording comes from /site/config. */
export function Estimate({
  lead,
  disclaimer = 'NOT_GUARANTEED',
  style,
}: {
  lead?: string
  disclaimer?: string
  style?: React.CSSProperties
}) {
  const text = useDisclaimer(disclaimer)
  if (!text) return <MissingDisclaimer name={disclaimer} />
  return (
    <p className="estimate" style={style}>
      <Icon name="info" />
      <span>
        {lead && <strong>{lead} </strong>}
        {text}
      </span>
    </p>
  )
}
