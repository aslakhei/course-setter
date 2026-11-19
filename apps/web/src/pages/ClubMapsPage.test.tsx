import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as maps from '../lib/maps.ts'
import { ada, clubContext, mo, mutation, query, renderClubPage } from '../test/helpers.tsx'
import { ClubMapsPage } from './ClubMapsPage.tsx'

vi.mock('../lib/supabase.ts', () => ({ supabase: {} }))
vi.mock('../lib/maps.ts', async importOriginal => ({
  ...(await importOriginal<typeof import('../lib/maps.ts')>()),
  useMaps: vi.fn(),
  useUploadMap: vi.fn(),
}))

const version = (extra: Partial<maps.MapVersionSummary>): maps.MapVersionSummary => ({
  id: 'v1',
  version: 1,
  kind: 'ocad',
  status: 'ready',
  fileName: 'skogen.ocd',
  scale: 15000,
  errorCode: null,
  errorMessage: null,
  createdAt: '2026-11-18T10:00:00Z',
  ...extra,
})

let upload: ReturnType<typeof mutation>

beforeEach(() => {
  upload = mutation()
  vi.mocked(maps.useUploadMap).mockReturnValue(upload as ReturnType<typeof maps.useUploadMap>)
  vi.mocked(maps.useMaps).mockReturnValue(
    query<maps.ClubMap[]>([
      {
        id: 'm1',
        name: 'Skogen',
        versions: [version({ id: 'v2', version: 2, status: 'processing', fileName: 'skogen-2.ocd' }), version({})],
      },
      {
        id: 'm2',
        name: 'Old map',
        versions: [version({ id: 'v3', kind: 'pdf', status: 'failed', errorCode: 'not_pdf', fileName: 'old.pdf' })],
      },
    ]),
  )
})

describe('maps page', () => {
  it('links ready maps and explains versions that are not ready', () => {
    renderClubPage(<ClubMapsPage />, clubContext(ada))
    expect(screen.getByRole('link', { name: 'Skogen' })).toHaveAttribute('href', '/m1')
    expect(screen.getByText(/^Version 1 · 1:15.000 · OCAD$/)).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Version 2 (skogen-2.ocd) is being processed.')
    // A map with no ready version is not a link yet.
    expect(screen.queryByRole('link', { name: 'Old map' })).toBeNull()
    expect(screen.getByText(/Version 1 \(old.pdf\) could not be processed: the file is not a PDF\./)).toBeInTheDocument()
  })

  it('asks for the scale of a PDF map and uploads it', async () => {
    renderClubPage(<ClubMapsPage />, clubContext(ada))
    expect(screen.queryByLabelText('Map scale')).toBeNull()
    const file = new File(['%PDF-1.7'], 'Gamle kart.pdf', { type: 'application/pdf' })
    await userEvent.upload(screen.getByLabelText('Map file'), file)
    expect(screen.getByLabelText('Map name')).toHaveValue('Gamle kart')

    const scale = screen.getByLabelText('Map scale')
    await userEvent.clear(scale)
    await userEvent.type(scale, '75')
    expect(screen.getByText(/whole number between 500 and 100 000/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Upload' })).toBeDisabled()

    await userEvent.clear(scale)
    await userEvent.type(scale, '10 000')
    await userEvent.click(screen.getByRole('button', { name: 'Upload' }))
    expect(upload.mutate).toHaveBeenCalledWith({ file, name: 'Gamle kart', scale: 10000 }, expect.anything())
  })

  it('refuses files that are not OCAD or PDF', async () => {
    renderClubPage(<ClubMapsPage />, clubContext(ada))
    // The file picker suggests .ocd and .pdf, but people can still choose any file.
    const user = userEvent.setup({ applyAccept: false })
    await user.upload(screen.getByLabelText('Map file'), new File(['x'], 'map.omap'))
    expect(screen.getByText('Choose an OCAD (.ocd) or PDF file.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Upload' })).toBeDisabled()
  })

  it('shows members the maps but no upload form', () => {
    renderClubPage(<ClubMapsPage />, clubContext(mo))
    expect(screen.getByRole('link', { name: 'Skogen' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Upload a map' })).toBeNull()
  })
})
