export { groundMToPaperMm, paperMmToGroundM, type ScaleDenominator } from './scale.ts'
export {
  apply,
  automaticAlignment,
  compose,
  type Fit,
  fitSimilarity,
  frameToProjected,
  type Georef,
  IDENTITY,
  inverse,
  isIdentity,
  type Point,
  type PointPair,
  rotationDegOf,
  type Similarity,
  scaleOf,
  type VersionFrame,
} from './similarity.ts'
export {
  type Extent,
  FINEST_PAPER_MM_PER_PX,
  maxZoom,
  TILE_SIZE,
  type TileGrid,
  type TileLevel,
  tileGrid,
  tilePixelAt,
} from './tiles.ts'
