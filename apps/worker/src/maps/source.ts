/** What is wrong with an uploaded map file, as a code the app translates for the admin. */
export type MapErrorCode = 'not_ocad' | 'unsupported_ocad_version' | 'not_pdf' | 'unreadable_file' | 'empty_map'

/** A problem with the file itself: retrying does not help, so the version fails at once. */
export class MapError extends Error {
  readonly code: MapErrorCode
  constructor(code: MapErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

export type Georef = {
  /** EPSG code of the projected coordinate system, when OCAD knows it. */
  epsg: number | null
  /** Projected coordinates of the paper origin, in metres. */
  easting: number
  northing: number
  /** Angle between grid north and map north, in degrees. */
  grivationDeg: number
  /** OCAD's own grid id, kept for formats we do not map to EPSG yet. */
  ocadGridId: number | null
}

export type Region = { x: number; y: number; width: number; height: number }

/** A loaded map file, ready to be rendered piece by piece. */
export type MapSource = {
  kind: 'ocad' | 'pdf'
  widthMm: number
  heightMm: number
  scale: number
  /** Top-left corner of the map in the map frame (ground metres, y up). */
  origin: [number, number]
  georef: Georef | null
  ocadVersion: string | null
  /**
   * RGB pixels (3 bytes each, rows top to bottom, white background) of `region` of the map drawn at
   * `mmPerPx` paper millimetres per pixel; pixel (0, 0) is the map's top-left corner.
   */
  render(region: Region, mmPerPx: number): Buffer
}

export const MM_PER_INCH = 25.4
export const PT_PER_MM = 72 / MM_PER_INCH
