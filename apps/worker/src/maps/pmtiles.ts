// PMTiles v3 writer: one file holding all tiles of a map version, read by the browser with HTTP range
// requests. Spec: https://github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md
// Directories and metadata are gzipped; tile data is stored as is (PNGs are already compressed),
// clustered in tile-id order, with identical tiles stored once.
import { gzipSync } from 'node:zlib'
import { zxyToTileId } from 'pmtiles'

export const TileType = { png: 2 } as const
const COMPRESSION_NONE = 1
const COMPRESSION_GZIP = 2
const HEADER_BYTES = 127
/** Readers fetch the first 16 KiB at once; header and root directory must fit in it. */
const MAX_ROOT_BYTES = 16384 - HEADER_BYTES

export type Tile = { z: number; x: number; y: number; data: Uint8Array }
type Entry = { tileId: number; offset: number; length: number; runLength: number }

function varint(out: number[], n: number) {
  let v = n
  while (v >= 0x80) {
    out.push((v & 0x7f) | 0x80)
    v = Math.floor(v / 128)
  }
  out.push(v)
}

function serializeDirectory(entries: Entry[]): Buffer {
  const out: number[] = []
  varint(out, entries.length)
  let lastId = 0
  for (const e of entries) {
    varint(out, e.tileId - lastId)
    lastId = e.tileId
  }
  for (const e of entries) varint(out, e.runLength)
  for (const e of entries) varint(out, e.length)
  entries.forEach((e, i) => {
    const prev = entries[i - 1]
    varint(out, prev && e.offset === prev.offset + prev.length ? 0 : e.offset + 1)
  })
  return gzipSync(Uint8Array.from(out))
}

/** Root directory, and leaf directories when the root alone would not fit in the first 16 KiB. */
function directories(entries: Entry[]): { root: Buffer; leaves: Buffer } {
  const root = serializeDirectory(entries)
  if (root.length <= MAX_ROOT_BYTES) return { root, leaves: Buffer.alloc(0) }
  for (let perLeaf = 4096; ; perLeaf *= 2) {
    const leafEntries: Entry[] = []
    const leafData: Buffer[] = []
    let offset = 0
    for (let i = 0; i < entries.length; i += perLeaf) {
      const chunk = entries.slice(i, i + perLeaf)
      const leaf = serializeDirectory(chunk)
      leafEntries.push({ tileId: chunk[0]?.tileId ?? 0, offset, length: leaf.length, runLength: 0 })
      leafData.push(leaf)
      offset += leaf.length
    }
    const leafRoot = serializeDirectory(leafEntries)
    if (leafRoot.length <= MAX_ROOT_BYTES) return { root: leafRoot, leaves: Buffer.concat(leafData) }
  }
}

export function writePmtiles(tiles: Tile[], metadata: object, minZoom: number, maxZoom: number): Buffer {
  const sorted = tiles.map(t => ({ ...t, tileId: zxyToTileId(t.z, t.x, t.y) })).sort((a, b) => a.tileId - b.tileId)

  const chunks: Uint8Array[] = []
  const byContent = new Map<string, { offset: number; length: number }>()
  const entries: Entry[] = []
  let dataLength = 0
  for (const t of sorted) {
    const key = Buffer.from(t.data).toString('base64')
    let loc = byContent.get(key)
    if (!loc) {
      loc = { offset: dataLength, length: t.data.length }
      byContent.set(key, loc)
      chunks.push(t.data)
      dataLength += t.data.length
    }
    const prev = entries.at(-1)
    if (prev && prev.tileId + prev.runLength === t.tileId && prev.offset === loc.offset) prev.runLength++
    else entries.push({ tileId: t.tileId, offset: loc.offset, length: loc.length, runLength: 1 })
  }

  const { root, leaves } = directories(entries)
  const meta = gzipSync(Buffer.from(JSON.stringify(metadata)))
  const rootOffset = HEADER_BYTES
  const metaOffset = rootOffset + root.length
  const leavesOffset = metaOffset + meta.length
  const dataOffset = leavesOffset + leaves.length

  const h = Buffer.alloc(HEADER_BYTES)
  h.write('PMTiles', 0, 'ascii')
  h.writeUInt8(3, 7)
  const u64 = (pos: number, v: number) => h.writeBigUInt64LE(BigInt(v), pos)
  u64(8, rootOffset)
  u64(16, root.length)
  u64(24, metaOffset)
  u64(32, meta.length)
  u64(40, leavesOffset)
  u64(48, leaves.length)
  u64(56, dataOffset)
  u64(64, dataLength)
  u64(72, sorted.length) // addressed tiles
  u64(80, entries.length) // tile entries
  u64(88, chunks.length) // tile contents
  h.writeUInt8(1, 96) // clustered
  h.writeUInt8(COMPRESSION_GZIP, 97) // directories and metadata
  h.writeUInt8(COMPRESSION_NONE, 98) // tiles
  h.writeUInt8(TileType.png, 99)
  h.writeUInt8(minZoom, 100)
  h.writeUInt8(maxZoom, 101)
  // Bounds and centre (102..126) stay 0: the archive is in a local map frame, not longitude/latitude.
  h.writeUInt8(minZoom, 118)

  return Buffer.concat([h, root, meta, leaves, ...chunks])
}
