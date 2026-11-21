import { Trans, useTranslation } from 'react-i18next'
import { Link } from 'react-router'

const pageClass = 'mx-auto flex max-w-[720px] flex-col gap-3 px-5 pt-5 pb-10 text-[15px] leading-relaxed'

/** Numbered steps, each with a heading and a paragraph (from `help.<page>.<step>.title/body`). */
function Steps({
  page,
  steps,
  start = 1,
  links,
}: {
  page: string
  steps: readonly string[]
  /** The number of the first step. */
  start?: number
  links?: Record<string, React.ReactElement>
}) {
  const { t } = useTranslation()
  return (
    <ol start={start} className="m-0 flex list-decimal flex-col gap-3 pl-5 marker:font-semibold">
      {steps.map(step => (
        <li key={step}>
          <h2 className="m-0 text-base font-semibold">{t(`help.${page}.${step}.title` as 'help.start.club.title')}</h2>
          <p className="m-0">
            <Trans i18nKey={`help.${page}.${step}.body` as 'help.start.club.body'} components={links} />
          </p>
        </li>
      ))}
    </ol>
  )
}

/** /help: from joining a club to printing a training. */
export function GettingStartedPage() {
  const { t } = useTranslation()
  return (
    <main className={pageClass}>
      <h1 className="m-0 text-xl font-bold">{t('help.start.heading')}</h1>
      <p className="m-0">{t('help.start.intro')}</p>
      <Steps page="start" steps={['club', 'map', 'event', 'courses', 'print']} />
      <p className="m-0 rounded border border-line bg-subtle px-3 py-2 text-[14px]">{t('help.start.printTip')}</p>
      <Steps page="start" steps={['livelox']} start={6} links={{ livelox: <Link to="/help/livelox" /> }} />
      <p className="m-0 text-[14px] text-muted">
        <Trans i18nKey="help.start.account" />
      </p>
    </main>
  )
}

/** /help/livelox: how to put a training on Livelox with the IOF XML file. */
export function LiveloxHelpPage() {
  const { t } = useTranslation()
  return (
    <main className={pageClass}>
      <h1 className="m-0 text-xl font-bold">{t('help.livelox.heading')}</h1>
      <p className="m-0">{t('help.livelox.intro')}</p>
      <Steps page="livelox" steps={['download', 'event', 'map', 'courses', 'publish']} />
      <p className="m-0 rounded border border-line bg-subtle px-3 py-2 text-[14px]">{t('help.livelox.pdfNote')}</p>
      <p className="m-0 text-[14px] text-muted">
        <Trans
          i18nKey="help.livelox.more"
          components={{
            // biome-ignore lint/a11y/useAnchorContent: Trans puts the link text in.
            docs: <a href="https://www.livelox.com/Documentation/Courses" />,
          }}
        />
      </p>
    </main>
  )
}
