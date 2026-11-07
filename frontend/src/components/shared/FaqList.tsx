import { Icon } from '../Icon'

type FaqItem = { question: string; answer: string; sort: number }

export function FaqList({
  faqs,
  title = 'Questions about this college',
  id,
}: {
  faqs: FaqItem[]
  title?: string
  id?: string
}) {
  if (!faqs.length) return null
  return (
    <>
      <h2 id={id}>{title}</h2>
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
