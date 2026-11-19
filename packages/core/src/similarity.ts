// Similarity transforms (shift, rotation, uniform scale) between map frames, used to carry courses
// from one map version to the next. A transform is { a, b, tx, ty }:
//   x' = a·x − b·y + tx
//   y' = b·x + a·y + ty
// i.e. multiplication by the complex number a + bi plus a shift; scale = √(a² + b²), rotation = atan2(b, a).

export type Similarity = { a: number; b: number; tx: number; ty: number }
export type Point = [number, number]

export const IDENTITY: Similarity = { a: 1, b: 0, tx: 0, ty: 0 }

export function apply(t: Similarity, [x, y]: Point): Point {
  return [t.a * x - t.b * y + t.tx, t.b * x + t.a * y + t.ty]
}

/** `second` after `first`: apply(compose(second, first), p) = apply(second, apply(first, p)). */
export function compose(second: Similarity, first: Similarity): Similarity {
  const [tx, ty] = apply(second, [first.tx, first.ty])
  return { a: second.a * first.a - second.b * first.b, b: second.a * first.b + second.b * first.a, tx, ty }
}

export function inverse(t: Similarity): Similarity {
  const n = t.a * t.a + t.b * t.b
  if (n === 0) throw new RangeError('Degenerate transform')
  const a = t.a / n
  const b = -t.b / n
  return { a, b, tx: -(a * t.tx - b * t.ty), ty: -(b * t.tx + a * t.ty) }
}

export const scaleOf = (t: Similarity) => Math.hypot(t.a, t.b)
export const rotationDegOf = (t: Similarity) => (Math.atan2(t.b, t.a) * 180) / Math.PI

/** True when `t` moves no point of a map (within ~10 km of the origin) by more than a millimetre. */
export function isIdentity(t: Similarity): boolean {
  return Math.abs(t.a - 1) < 1e-7 && Math.abs(t.b) < 1e-7 && Math.hypot(t.tx, t.ty) < 1e-3
}

export type PointPair = { from: Point; to: Point }

export type Fit = {
  transform: Similarity
  /** Root mean square distance between the transformed `from` points and the `to` points, in metres. */
  rms: number
  /** Distance per pair, same order as the input. */
  residuals: number[]
}

/** Least-squares similarity taking each `from` onto its `to` (needs 2 pairs that are not the same point). */
export function fitSimilarity(pairs: PointPair[]): Fit {
  if (pairs.length < 2) throw new RangeError('At least two point pairs are needed')
  const n = pairs.length
  const [fx, fy] = pairs.reduce(([sx, sy], p) => [sx + p.from[0] / n, sy + p.from[1] / n], [0, 0])
  const [gx, gy] = pairs.reduce(([sx, sy], p) => [sx + p.to[0] / n, sy + p.to[1] / n], [0, 0])
  let sum = 0
  let ra = 0
  let rb = 0
  for (const { from, to } of pairs) {
    const dx = from[0] - fx
    const dy = from[1] - fy
    const ex = to[0] - gx
    const ey = to[1] - gy
    sum += dx * dx + dy * dy
    ra += dx * ex + dy * ey
    rb += dx * ey - dy * ex
  }
  if (sum < 1e-12) throw new RangeError('The points on the first map are all in the same place')
  const a = ra / sum
  const b = rb / sum
  const transform = { a, b, tx: gx - (a * fx - b * fy), ty: gy - (b * fx + a * fy) }
  const residuals = pairs.map(({ from, to }) => {
    const [x, y] = apply(transform, from)
    return Math.hypot(x - to[0], y - to[1])
  })
  const rms = Math.sqrt(residuals.reduce((s, r) => s + r * r, 0) / n)
  return { transform, rms, residuals }
}

/** Georeferencing as read from an OCAD file. */
export type Georef = {
  /** EPSG code of the projected coordinate system, when known. */
  epsg: number | null
  /** Projected coordinates of the paper origin, in metres. */
  easting: number
  northing: number
  /** Angle between grid north and map north, in degrees. */
  grivationDeg: number
  /** OCAD's own grid id. */
  ocadGridId: number | null
}

/**
 * Map frame -> projected coordinates. The frame is paper position × scale (ground metres, y up) and
 * OCAD rotates it by −grivation before adding the origin (as ocad2geojson's Crs.toProjectedCoord).
 */
export function frameToProjected(g: Georef): Similarity {
  const theta = (-g.grivationDeg * Math.PI) / 180
  return { a: Math.cos(theta), b: Math.sin(theta), tx: g.easting, ty: g.northing }
}

const sameGrid = (p: Georef, q: Georef) =>
  (p.epsg !== null && p.epsg === q.epsg) || (p.epsg === null && q.epsg === null && p.ocadGridId !== null && p.ocadGridId === q.ocadGridId)

/** What the worker knows about a processed version. */
export type VersionFrame = { kind: 'ocad' | 'pdf'; scale: number; georef: Georef | null }

/**
 * The transform from the previous version's frame to the next one's, when the files themselves say
 * how they line up; null when an admin has to match points by hand.
 * - Both georeferenced in the same grid: exact, from the georeferencing.
 * - Both OCAD without georeferencing at the same scale: the same file edited further, whose paper
 *   coordinates OCAD keeps, so nothing moved. (An admin can still line it up by hand if it did.)
 */
export function automaticAlignment(
  previous: VersionFrame,
  next: VersionFrame,
): { transform: Similarity; method: 'identity' | 'georef' } | null {
  if (previous.georef && next.georef) {
    if (!sameGrid(previous.georef, next.georef)) return null
    const transform = compose(inverse(frameToProjected(next.georef)), frameToProjected(previous.georef))
    return isIdentity(transform) ? { transform: IDENTITY, method: 'identity' } : { transform, method: 'georef' }
  }
  if (previous.kind === 'ocad' && next.kind === 'ocad' && !previous.georef && !next.georef && previous.scale === next.scale) {
    return { transform: IDENTITY, method: 'identity' }
  }
  return null
}
