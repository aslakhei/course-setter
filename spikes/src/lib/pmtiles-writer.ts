// Minimal PMTiles v3 writer (single root directory, clustered, gzip-compressed directory + metadata).
// Spec: https://github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md
// Read back with the official `pmtiles` reader to validate.
import { gzipSync } from 'node:zlib'
import { zxyToTileId } from 'pmtiles'

export const TileType = { png: 2, jpeg: 3, webp: 4 } as const
const COMPRESSION_NONE = 1
const COMPRESSION_GZIP = 2
const HEADER_BYTES = 127
/** Readers fetch the first 16 KiB; header + root directory must fit in it. */
const MAX_ROOT_BYTES = 16384 - HEADER_BYTES

export type Tile = { z: number; x: number; y: number; data: Uint8Array }

function varint(out: number[], n: number) {
  while (n >= 0x80) {
    out.push((n & 0x7f) | 0x80)
    n = Math.floor(n / 128)
  }
  out.push(n)
}

type Entry = { tileId: number; offset: number; length: number; runLength: number }

function serializeDirectory(entries: Entry[]): Uint8Array {
  const out: number[] = []
  varint(out, entries.length)
  let last = 0
  for (const e of entries) {
    varint(out, e.tileId - last)
    last = e.tileId
  }
  for (const e of entries) varint(out, e.runLength)
  for (const e of entries) varint(out, e.length)
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    const prev = entries[i - 1]
    varint(out, i > 0 && e.offset === prev.offset + prev.length ? 0 : e.offset + 1)
  }
  return gzipSync(Uint8Array.from(out))
}

export function writePmtiles(tiles: Tile[], tileType: number, metadata: object, minZoom: number, maxZoom: number): Buffer {
  const sorted = tiles.map(t => ({ ...t, tileId: zxyToTileId(t.z, t.x, t.y) })).sort((a, b) => a.tileId - b.tileId)

  // Tile data in tile-id order (clustered); identical consecutive tiles become run-lengths,
  // identical non-consecutive tiles share data via a content hash.
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
    const prev = entries[entries.length - 1]
    if (prev && prev.tileId + prev.runLength === t.tileId && prev.offset === loc.offset) prev.runLength++
    else entries.push({ tileId: t.tileId, offset: loc.offset, length: loc.length, runLength: 1 })
  }

  const root = serializeDirectory(entries)
  if (root.length > MAX_ROOT_BYTES)
    throw new Error(`Root directory ${root.length} B too large; leaf directories not implemented in this spike`)
  const meta = gzipSync(Buffer.from(JSON.stringify(metadata)))

  const rootOffset = HEADER_BYTES
  const metaOffset = rootOffset + root.length
  const dataOffset = metaOffset + meta.length

  const h = Buffer.alloc(HEADER_BYTES)
  h.write('PMTiles', 0, 'ascii')
  h.writeUInt8(3, 7)
  const u64 = (pos: number, v: number) => h.writeBigUInt64LE(BigInt(v), pos)
  u64(8, rootOffset)
  u64(16, root.length)
  u64(24, metaOffset)
  u64(32, meta.length)
  u64(40, dataOffset) // leaf directories: none
  u64(48, 0)
  u64(56, dataOffset)
  u64(64, dataLength)
  u64(72, sorted.length) // addressed tiles
  u64(80, entries.length) // tile entries
  u64(88, chunks.length) // tile contents
  h.writeUInt8(1, 96) // clustered
  h.writeUInt8(COMPRESSION_GZIP, 97) // internal compression
  h.writeUInt8(COMPRESSION_NONE, 98) // tile compression (images are already compressed)
  h.writeUInt8(tileType, 99)
  h.writeUInt8(minZoom, 100)
  h.writeUInt8(maxZoom, 101)
  // Bounds/centre (102..126) left as 0: this archive is in a local map frame, not WGS84.
  h.writeUInt8(minZoom, 118)

  return Buffer.concat([h, root, meta, ...chunks])
}
