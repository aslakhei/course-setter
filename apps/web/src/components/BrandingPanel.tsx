// The club's branding for print templates (admins, on the Settings tab): its logo, chosen from the
// club images, and two colours. Universal templates fill these in, so prints look like the club's.
import { DEFAULT_COLOURS } from '@course-setter/core'
import { type FormEvent, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type Club, useSetBranding } from '../lib/api.ts'
import { shownPath, useLibrary, useSignedUrls } from '../lib/assets.ts'
import { Button, ErrorMessage, fieldClass, Panel } from './ui.tsx'

const HEX = /^#[0-9a-fA-F]{6}$/

/** A colour as #rrggbb; empty: the default (`fallback`) is used, shown in the swatch and as placeholder. */
function ColourField({
  id,
  label,
  value,
  fallback,
  onChange,
}: {
  id: string
  label: string
  value: string
  fallback: string
  onChange: (v: string) => void
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[13px] font-semibold">
        {label}
      </label>
      <span className="flex items-center gap-2">
        <input
          type="color"
          aria-hidden="true"
          tabIndex={-1}
          value={HEX.test(value) ? value : fallback}
          onChange={e => onChange(e.target.value)}
          className="h-8 w-9 cursor-pointer border-0 bg-transparent p-0"
        />
        <input
          id={id}
          className={`${fieldClass} w-28 font-mono`}
          value={value}
          placeholder={fallback}
          maxLength={7}
          onChange={e => onChange(e.target.value.trim())}
        />
      </span>
    </div>
  )
}

export function BrandingPanel({ club }: { club: Club }) {
  const { t } = useTranslation()
  const save = useSetBranding(club.id)
  const library = useLibrary({ scope: 'club', clubId: club.id })
  const images = (library.data ?? []).filter(a => a.status === 'ready')
  const urls = useSignedUrls(images.flatMap(a => shownPath(a) ?? []))
  const [logo, setLogo] = useState<string | null>(club.logoAssetId)
  const [colour, setColour] = useState(club.colour ?? '')
  const [colour2, setColour2] = useState(club.colour2 ?? '')
  useEffect(() => {
    setLogo(club.logoAssetId)
    setColour(club.colour ?? '')
    setColour2(club.colour2 ?? '')
  }, [club.logoAssetId, club.colour, club.colour2])
  const coloursOk = [colour, colour2].every(c => c === '' || HEX.test(c))

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!coloursOk) return
    save.mutate({ logoAssetId: logo, colour: colour || null, colour2: colour2 || null })
  }

  return (
    <Panel title={t('branding.heading')} titleId="club-branding" className="max-w-xl">
      <form onSubmit={submit} className="flex flex-col gap-3 px-3.5 py-3">
        <span className="text-[13px] text-muted">{t('branding.help')}</span>
        <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
          <legend className="mb-1 p-0 text-[13px] font-semibold">{t('branding.logo')}</legend>
          {images.length === 0 ? (
            <span className="text-[13px] text-muted">{t('branding.noImages')}</span>
          ) : (
            <div className="flex flex-wrap gap-2">
              <label
                className={`flex h-16 w-24 cursor-pointer items-center justify-center rounded border text-xs ${logo === null ? 'border-brand-600 bg-brand-50' : 'border-line'}`}
              >
                <input type="radio" name="branding-logo" className="sr-only" checked={logo === null} onChange={() => setLogo(null)} />
                {t('branding.noLogo')}
              </label>
              {images.map(a => {
                const path = shownPath(a)
                const url = path ? urls.data?.get(path) : undefined
                return (
                  <label
                    key={a.id}
                    title={a.name}
                    className={`flex h-16 w-24 cursor-pointer items-center justify-center overflow-hidden rounded border bg-white p-1 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand-600 ${logo === a.id ? 'border-2 border-brand-600' : 'border-line'}`}
                  >
                    <input
                      type="radio"
                      name="branding-logo"
                      className="sr-only"
                      aria-label={a.name}
                      checked={logo === a.id}
                      onChange={() => setLogo(a.id)}
                    />
                    {url ? (
                      <img src={url} alt="" className="max-h-full max-w-full object-contain" />
                    ) : (
                      <span className="truncate text-xs">{a.name}</span>
                    )}
                  </label>
                )
              })}
            </div>
          )}
        </fieldset>
        <div className="flex flex-wrap gap-4">
          <ColourField
            id="branding-colour"
            label={t('branding.colour')}
            value={colour}
            fallback={DEFAULT_COLOURS.colour}
            onChange={setColour}
          />
          <ColourField
            id="branding-colour2"
            label={t('branding.colour2')}
            value={colour2}
            fallback={DEFAULT_COLOURS.colour2}
            onChange={setColour2}
          />
        </div>
        <span className="text-xs text-muted">{t('branding.coloursHelp')}</span>
        {!coloursOk && <ErrorMessage>{t('branding.badColour')}</ErrorMessage>}
        {save.isError && <ErrorMessage>{t('common.error')}</ErrorMessage>}
        {save.isSuccess && <span className="text-[13px] text-muted">{t('common.saved')}</span>}
        <Button type="submit" variant="primary" className="self-start" disabled={!coloursOk || save.isPending}>
          {t('common.save')}
        </Button>
      </form>
    </Panel>
  )
}
