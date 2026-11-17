/** A map scale as its denominator: 15000 means 1:15 000. */
export type ScaleDenominator = number

function assertScale(scale: ScaleDenominator): void {
  if (!Number.isFinite(scale) || scale <= 0) throw new RangeError(`Invalid map scale 1:${scale}`)
}

/** Ground distance in metres for a distance in millimetres on paper printed at `scale`. */
export function paperMmToGroundM(mm: number, scale: ScaleDenominator): number {
  assertScale(scale)
  return (mm * scale) / 1000
}

/** Distance in millimetres on paper printed at `scale` for a ground distance in metres. */
export function groundMToPaperMm(m: number, scale: ScaleDenominator): number {
  assertScale(scale)
  return (m * 1000) / scale
}
