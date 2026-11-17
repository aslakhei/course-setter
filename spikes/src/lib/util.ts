import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const MM_PER_INCH = 25.4
export const PT_PER_MM = 72 / MM_PER_INCH
/** OCAD paper coordinates are in 1/100 mm. */
export const OCAD_UNITS_PER_MM = 100

export const mmToPx = (mm: number, dpi: number) => (mm / MM_PER_INCH) * dpi
export const pxToMm = (px: number, dpi: number) => (px / dpi) * MM_PER_INCH

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'out')

/** Path inside spikes/out/ (gitignored: renders are club property). */
export const outPath = (name: string) => join(OUT_DIR, name)

/** True when the module at `metaUrl` is the script being run (Node 22 has no import.meta.main). */
export const isMain = (metaUrl: string) => fileURLToPath(metaUrl) === process.argv[1]

export function writeOut(path: string, data: Uint8Array | string): string {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, data)
  return path
}
