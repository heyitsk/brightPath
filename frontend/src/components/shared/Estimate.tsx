import { Icon } from '../Icon'
import { useDisclaimer } from '../site/config'
import { MissingDisclaimer } from '../site/MissingDisclaimer'

/**
 * The advisory slip that travels with every estimate. Wording comes from /site/config, or,
 * when an API response carries its own disclaimer (e.g. /neet/rank meta.disclaimer), from `text`.
 */
export function Estimate({
  lead,
  disclaimer = 'NOT_GUARANTEED',
  text,
  style,
}: {
  lead?: string
  disclaimer?: string
  text?: string
  style?: React.CSSProperties
}) {
  const configText = useDisclaimer(disclaimer)
  const shown = text ?? configText
  if (!shown) return <MissingDisclaimer name={disclaimer} />
  return (
    <p className="estimate" style={style}>
      <Icon name="info" />
      <span>
        {lead && <strong>{lead} </strong>}
        {shown}
      </span>
    </p>
  )
}
