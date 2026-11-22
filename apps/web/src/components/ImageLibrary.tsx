// A library of images for print layouts (the club's, or one's own): the images with a thumbnail, their
// kind and size, uploading new ones and deleting them.
import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError } from '../lib/api.ts'
import {
  type AssetScope,
  assetKindOf,
  assetNameFromFile,
  IMAGE_ACCEPT,
  type LayoutAsset,
  MAX_IMAGE_BYTES,
  shownPath,
  useDeleteAsset,
  useLibrary,
  useSetSponsor,
  useSignedUrls,
  useUploadAsset,
} from '../lib/assets.ts'
import { formatBytes } from '../lib/format.ts'
import { Button, ErrorMessage, fieldClass, Loading, Panel } from './ui.tsx'

const KNOWN_ERRORS = ['unsupported_image', 'wrong_type', 'unreadable_image', 'image_too_large'] as const

/** "45 kB", "1.2 MB" */
const fileSize = (bytes: number) => (bytes < 1e6 ? `${Math.max(1, Math.round(bytes / 1000))} kB` : formatBytes(bytes))

/** "400 × 200 px", "120 × 60 mm" (a PDF's page size); SVGs have no fixed size. */
function sizeText(a: LayoutAsset): string | null {
  if (a.width === null || a.height === null || a.kind === 'svg') return null
  if (a.kind === 'pdf') return `${Math.round((a.width * 25.4) / 72)} × ${Math.round((a.height * 25.4) / 72)} mm`
  return `${Math.round(a.width)} × ${Math.round(a.height)} px`
}

export function ImageLibrary({
  scope,
  title,
  titleId,
  help,
  canEdit,
  sponsors = false,
}: {
  scope: AssetScope
  title: string
  titleId: string
  help: string
  /** May upload and delete (club admins for the club library, everyone for their own). */
  canEdit: boolean
  /** Images can be marked as sponsors (the club library). */
  sponsors?: boolean
}) {
  const { t } = useTranslation()
  const library = useLibrary(scope)
  const upload = useUploadAsset(scope)
  const remove = useDeleteAsset(scope)
  const setSponsor = useSetSponsor(scope.scope === 'club' ? scope.clubId : '')
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState('')
  const [formKey, setFormKey] = useState(0)
  const ready = (library.data ?? []).filter(a => a.status === 'ready')
  const urls = useSignedUrls(ready.flatMap(a => shownPath(a) ?? []))

  const problem = !file
    ? null
    : !assetKindOf(file.name)
      ? t('images.wrongType')
      : file.size > MAX_IMAGE_BYTES
        ? t('images.tooLarge', { size: formatBytes(file.size) })
        : null

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!file || problem || !name.trim()) return
    upload.mutate(
      { file, name },
      {
        onSuccess: () => {
          setFile(null)
          setName('')
          setFormKey(k => k + 1)
        },
      },
    )
  }
  const confirmDelete = (a: LayoutAsset) => {
    if (window.confirm(t('images.deleteConfirm', { name: a.name }))) remove.mutate(a.id)
  }

  return (
    <Panel title={title} titleId={titleId} className="max-w-xl">
      <div className="flex flex-col gap-2.5 px-3.5 py-3">
        <span className="text-[13px] text-muted">{help}</span>
        {library.isError ? (
          <ErrorMessage>{t('common.error')}</ErrorMessage>
        ) : library.data === undefined ? (
          <Loading label={t('common.loading')} />
        ) : library.data.length === 0 ? (
          <span className="text-[13px] text-muted">{t('images.empty')}</span>
        ) : (
          <ul aria-label={title} className="m-0 flex list-none flex-col p-0">
            {library.data.map((a, i) => {
              const path = shownPath(a)
              const url = path ? urls.data?.get(path) : undefined
              const code = KNOWN_ERRORS.find(c => c === a.errorCode)
              return (
                <li key={a.id} className={`flex items-center gap-3 py-2 ${i ? 'border-t border-line-soft' : ''}`}>
                  <span className="flex h-10 w-16 shrink-0 items-center justify-center overflow-hidden rounded border border-line bg-white">
                    {url && <img src={url} alt="" className="max-h-full max-w-full object-contain" />}
                  </span>
                  <span className="flex min-w-0 grow flex-col">
                    <span className="truncate text-[14px]">{a.name}</span>
                    {a.status === 'ready' ? (
                      <span className="text-xs text-muted">
                        {[t(`images.kind.${a.kind}`), sizeText(a), a.bytes !== null ? fileSize(a.bytes) : null].filter(Boolean).join(' · ')}
                      </span>
                    ) : a.status === 'failed' ? (
                      <span className="text-xs text-danger">
                        {code ? t(`images.errors.${code}`) : t('images.errors.processing_failed')}
                      </span>
                    ) : (
                      <span className="text-xs text-muted" role="status">
                        {t('images.processing')}
                      </span>
                    )}
                  </span>
                  {sponsors && canEdit && a.status === 'ready' && (
                    <label className="flex items-center gap-1.5 text-xs">
                      <input
                        type="checkbox"
                        className="size-4 accent-brand-600"
                        checked={a.sponsor}
                        aria-label={t('images.sponsorLabel', { name: a.name })}
                        onChange={e => setSponsor.mutate({ assetId: a.id, sponsor: e.target.checked })}
                      />
                      {t('images.sponsor')}
                    </label>
                  )}
                  {canEdit && (
                    <Button
                      size="sm"
                      variant="danger"
                      aria-label={t('images.deleteLabel', { name: a.name })}
                      onClick={() => confirmDelete(a)}
                    >
                      {t('images.delete')}
                    </Button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
        {remove.isError && <ErrorMessage>{t('common.error')}</ErrorMessage>}
        {canEdit && (
          <form key={formKey} onSubmit={submit} className="flex flex-col gap-2 border-t border-line-soft pt-3">
            <label htmlFor={`${titleId}-file`} className="text-[13px] font-semibold">
              {t('images.file')}
            </label>
            <span className="text-[13px] text-muted">{t('images.fileHelp')}</span>
            <input
              id={`${titleId}-file`}
              type="file"
              accept={IMAGE_ACCEPT}
              className="text-[13px] file:mr-2 file:h-8 file:rounded file:border file:border-field file:bg-white file:px-3 file:font-[inherit]"
              onChange={e => {
                const chosen = e.target.files?.[0] ?? null
                setFile(chosen)
                if (chosen) setName(assetNameFromFile(chosen.name))
              }}
            />
            {problem && <ErrorMessage>{problem}</ErrorMessage>}
            <label htmlFor={`${titleId}-name`} className="text-[13px] font-semibold">
              {t('images.name')}
            </label>
            <input id={`${titleId}-name`} className={fieldClass} value={name} maxLength={100} onChange={e => setName(e.target.value)} />
            {upload.isError && (
              <ErrorMessage>
                {upload.error instanceof ApiError && upload.error.code === 'tooManyImages' ? t('images.tooMany') : t('images.uploadFailed')}
              </ErrorMessage>
            )}
            <Button
              type="submit"
              variant="primary"
              className="self-start"
              disabled={!file || Boolean(problem) || !name.trim() || upload.isPending}
            >
              {upload.isPending ? t('images.uploading') : t('images.upload')}
            </Button>
          </form>
        )}
      </div>
    </Panel>
  )
}
