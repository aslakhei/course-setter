export {
  addControl,
  addCourse,
  deleteControl,
  deleteCourse,
  insertCourseControl,
  moveControl,
  moveCourseControl,
  removeCourseControl,
  setControlCode,
  setLegBends,
  setStandard,
  updateCourse,
} from './course/commands.ts'
export {
  CONTROL_KINDS,
  type Control,
  type ControlKind,
  type Course,
  CourseError,
  controlById,
  courseById,
  defaultStandard,
  type EventDoc,
  emptyDoc,
  eventDocSchema,
  legKey,
  parseDoc,
  SCHEMA_VERSION,
  STANDARDS,
  type Standard,
} from './course/doc.ts'
export { canRedo, canUndo, createHistory, HISTORY_LIMIT, type History, record, redo, undo } from './course/history.ts'
export { courseLength, legLengths, legPath, pathLength } from './course/length.ts'
export { chainTransforms, type MovedDoc, moveDocToVersion } from './course/move.ts'
export { type CourseStop, courseStops, coursesUsing, FIRST_CODE, nextFreeCode } from './course/numbering.ts'
export { allControlsDrawing, courseDrawing, type Primitive, type SymbolSizes, symbolSizes, toPaperMm } from './course/symbols.ts'
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
