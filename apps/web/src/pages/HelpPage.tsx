import { Trans, useTranslation } from 'react-i18next'

const STEPS = ['download', 'event', 'map', 'courses', 'publish'] as const

/** /help/livelox: how to put a training on Livelox with the IOF XML file. */
export function LiveloxHelpPage() {
  const { t } = useTranslation()
  return (
    <main className="mx-auto flex max-w-[720px] flex-col gap-3 px-5 pt-5 pb-10 text-[15px] leading-relaxed">
      <h1 className="m-0 text-xl font-bold">{t('help.livelox.heading')}</h1>
      <p className="m-0">{t('help.livelox.intro')}</p>
      <ol className="m-0 flex flex-col gap-3 pl-5">
        {STEPS.map(step => (
          <li key={step}>
            <h2 className="m-0 text-base font-semibold">{t(`help.livelox.${step}.title`)}</h2>
            <p className="m-0">
              <Trans i18nKey={`help.livelox.${step}.body`} />
            </p>
          </li>
        ))}
      </ol>
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
