import { data, Link } from 'react-router'
import { Crumbs } from '../components/shared/Crumbs'
import { PageError } from '../components/shared/PageError'
import { CATEGORY_LABEL, checkedLine, placeName, publicDateLine } from '../components/shared/news'
import { OfficialLink } from '../components/news/OfficialLink'
import { getNews } from '../data/news'
import newsStyles from '../styles/pages/news.css?url'
import type { Route } from './+types/news-item'

export const links: Route.LinksFunction = () => [{ rel: 'stylesheet', href: newsStyles }]

const notFound = () =>
  data({ code: 'NEWS_NOT_FOUND', message: 'We could not find that notice. It may have been taken down.' }, { status: 404 })

/** The only data call on this page: GET /news/{slug}. Unknown or taken-down notices are a 404. */
export async function loader({ params }: Route.LoaderArgs) {
  const news = await getNews(params.slug)
  if (!news) throw notFound()
  return news
}

// Same for every visitor, so shared caches may keep it for five minutes.
export function headers() {
  return { 'Cache-Control': 'public, s-maxage=300' }
}

export const meta: Route.MetaFunction = ({ data: news }) => {
  if (!news) return [{ title: 'Notice not found' }]
  return [
    { title: `${news.title} | Official notice, ${placeName(news)}` },
    {
      name: 'description',
      content: `${news.summary} From ${news.source.name}. ${checkedLine(news)} by our team, with a link to the official notice.`,
    },
  ]
}

export default function NewsItem({ loaderData: news }: Route.ComponentProps) {
  return (
    <div className="wrap news" style={{ paddingBottom: 64 }}>
      <Crumbs
        parents={[
          { label: 'Home', href: '/', published: true },
          { label: 'News', href: '/news', published: true },
        ]}
        current={news.title}
      />
      <header className="page-head news-head">
        <h1>{news.title}</h1>
        <p className="lead">{news.summary}</p>
      </header>
      <section className="news-card" aria-label="About this notice">
        <dl className="kv">
          <dt>Published by</dt>
          <dd>{news.source.name}</dd>
          <dt>Where</dt>
          <dd>{placeName(news)}</dd>
          <dt>Type</dt>
          <dd>{CATEGORY_LABEL[news.category]}</dd>
          <dt>Date</dt>
          <dd>{publicDateLine(news)}</dd>
          <dt>Checked</dt>
          <dd>{checkedLine(news)}</dd>
        </dl>
        <p className="small muted">
          This is our short summary. The official notice is the one that counts: read it before you act.
        </p>
        <div className="news-actions">
          <OfficialLink item={news} className="btn btn-primary" />
          <Link className="btn btn-secondary" to="/news">
            All notices
          </Link>
        </div>
      </section>
    </div>
  )
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <PageError error={error} notFoundTitle="Notice not found" />
}
