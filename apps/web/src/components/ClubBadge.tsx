// The club mark with the club's logo, when it has one: fetched by its image id.
import { useLogoUrl } from '../lib/assets.ts'
import { ClubMark } from './ui.tsx'

export function ClubBadge({ name, logoAssetId, size }: { name: string; logoAssetId: string | null; size?: number }) {
  const url = useLogoUrl(logoAssetId)
  return <ClubMark name={name} logoUrl={url} {...(size ? { size } : {})} />
}
