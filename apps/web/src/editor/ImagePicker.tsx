// Choosing an image for a print layout: the club's library, one's own images, or the event's own (where
// new ones can be uploaded too). A personal image is copied into the event when chosen, so everyone who
// edits the event sees it.
import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, ErrorMessage, fieldClass, Loading } from '../components/ui.tsx'
import { ApiError } from '../lib/api.ts'
import {
  type AssetScope,
  assetKindOf,
  assetNameFromFile,
  IMAGE_ACCEPT,
  type LayoutAsset,
  MAX_IMAGE_BYTES,
  shownPath,
  useCopyToEvent,
  useLibrary,
  useSignedUrls,
  useUploadAsset,
} from '../lib/assets.ts'
import { formatBytes } from '../lib/format.ts'
import { Modal } from './Dialogs.tsx'
import { Segmented } from './PrintView.tsx'

type Tab = 'club' | 'personal' | 'event'

/** The chosen image as the layout will use it: its id (a personal image's copy in the event) and proportions. */
export type ChosenImage = { id: string; aspect: number | undefined }

const aspectOf = (a: LayoutAsset) => (a.width && a.height ? a.width / a.height : undefined)

export function ImagePicker({
  clubId,
  eventId,
  onChoose,
  onClose,
}: {
  clubId: string
  eventId: string
  onChoose: (image: ChosenImage) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [tab, setTab] = useState<Tab>('club')
  const scope: AssetScope =
    tab === 'club' ? { scope: 'club', clubId } : tab === 'event' ? { scope: 'event', eventId } : { scope: 'personal' }
  const library = useLibrary(scope)
  const ready = (library.data ?? []).filter(a => a.status === 'ready')
  const urls = useSignedUrls(ready.flatMap(a => shownPath(a) ?? []))
  const copy = useCopyToEvent(eventId)
  const upload = useUploadAsset({ scope: 'event', eventId })
  const [file, setFile] = useState<File | null>(null)

  const choose = async (a: LayoutAsset) => {
    if (tab !== 'personal') return onChoose({ id: a.id, aspect: aspectOf(a) })
    const id = await copy.mutateAsync(a).catch(() => null)
    if (id) onChoose({ id, aspect: aspectOf(a) })
  }
  const problem = !file
    ? null
    : !assetKindOf(file.name)
      ? t('images.wrongType')
      : file.size > MAX_IMAGE_BYTES
        ? t('images.tooLarge', { size: formatBytes(file.size) })
        : null
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!file || problem) return
    upload.mutate({ file, name: assetNameFromFile(file.name) || file.name }, { onSuccess: () => setFile(null) })
  }

  return (
    <Modal titleId="image-picker-heading" onClose={onClose} wide>
      <div className="flex items-center gap-3">
        <h2 id="image-picker-heading" className="m-0 grow text-base font-semibold">
          {t('layout.picker.heading')}
        </h2>
        <Button size="sm" onClick={onClose}>
          {t('layout.picker.close')}
        </Button>
      </div>
      <Segmented
        name="image-picker-tab"
        label={t('layout.picker.heading')}
        options={['club', 'personal', 'event'] as const}
        value={tab}
        text={o => t(`layout.picker.tabs.${o}`)}
        onChange={setTab}
      />
      <span className="text-xs text-muted">{t(`layout.picker.help.${tab}`)}</span>
      {library.isError ? (
        <ErrorMessage>{t('common.error')}</ErrorMessage>
      ) : library.data === undefined ? (
        <Loading label={t('common.loading')} />
      ) : (library.data ?? []).length === 0 ? (
        <span className="text-[13px] text-muted">{t('images.empty')}</span>
      ) : (
        <ul
          aria-label={t(`layout.picker.tabs.${tab}`)}
          className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-2 p-0"
        >
          {(library.data ?? []).map(a => {
            const path = shownPath(a)
            const url = path ? urls.data?.get(path) : undefined
            const isReady = a.status === 'ready'
            return (
              <li key={a.id}>
                <button
                  type="button"
                  disabled={!isReady || copy.isPending}
                  onClick={() => void choose(a)}
                  className="flex w-full flex-col gap-1 rounded border border-line bg-white p-1.5 text-left hover:border-brand-600 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="flex h-20 items-center justify-center overflow-hidden rounded bg-subtle">
                    {url && <img src={url} alt="" className="max-h-full max-w-full object-contain" />}
                  </span>
                  <span className="truncate text-[13px]">{a.name}</span>
                  {!isReady && (
                    <span className="text-xs text-muted">{a.status === 'failed' ? t('layout.picker.failed') : t('images.processing')}</span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {copy.isPending && <span className="text-xs text-muted">{t('layout.picker.copying')}</span>}
      {copy.isError && <ErrorMessage>{t('common.error')}</ErrorMessage>}
      {tab === 'event' && (
        <form onSubmit={submit} className="flex flex-col gap-1.5 border-t border-line-soft pt-3">
          <label htmlFor="image-picker-file" className="text-[13px] font-semibold">
            {t('layout.picker.upload')}
          </label>
          <span className="flex flex-wrap items-center gap-2">
            <input
              id="image-picker-file"
              type="file"
              accept={IMAGE_ACCEPT}
              className={`${fieldClass} h-auto py-1 text-[13px]`}
              onChange={e => setFile(e.target.files?.[0] ?? null)}
            />
            <Button type="submit" size="sm" variant="primary" disabled={!file || Boolean(problem) || upload.isPending}>
              {upload.isPending ? t('images.uploading') : t('images.upload')}
            </Button>
          </span>
          {problem && <ErrorMessage>{problem}</ErrorMessage>}
          {upload.isError && (
            <ErrorMessage>
              {upload.error instanceof ApiError && upload.error.code === 'tooManyImages' ? t('images.tooMany') : t('images.uploadFailed')}
            </ErrorMessage>
          )}
        </form>
      )}
    </Modal>
  )
}
