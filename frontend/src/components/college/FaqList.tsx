import { Icon } from '../Icon'
import type { CollegeFaq } from '../../data/colleges'

export function FaqList({ faqs }: { faqs: CollegeFaq[] }) {
  if (!faqs.length) return null
  return (
    <>
      <h2>Questions about this college</h2>
      <div className="faq">
        {[...faqs]
          .sort((a, b) => a.sort - b.sort)
          .map((f) => (
            <details key={f.question}>
              <summary>
                {f.question}
                <Icon name="chevron" />
              </summary>
              <div className="a">
                <p>{f.answer}</p>
              </div>
            </details>
          ))}
      </div>
    </>
  )
}
