# Map rendering prototype – findings

Date: 2026-11-17. Test maps (club property, not committed): one OCAD map (Skarpåsen-Stavsjøfjellet, 1:15 000), an OCAD-exported A3 reference PDF of part of it, and one older vector PDF map of another area (Old-map-2017).

## Summary

| Question                                      | Answer                                                                                                                                            |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Can we read OCAD?                             | Yes. ocad2geojson reads the map in ~0.1 s, 0 warnings. Format version 2018, saved by OCAD 2020.                                                   |
| Is the render at correct scale?               | Yes. Against OCAD's own PDF export: scale error +0.020 % (x) / −0.015 % (y), max local shift 0.5 mm over an A3 sheet.                             |
| Is the render faithful enough for the editor? | Yes, after one fix (pattern ids, below). Remaining differences are cosmetic: overprint colour blending, hatch phase, slightly different CMYK→RGB. |
| Can we render PDF maps?                       | Yes. mupdf.js renders vector PDFs at any dpi; page size gives paper mm exactly. Slow: 6–13 s per page.                                            |
| Tile format                                   | **256-colour palette PNG** in one PMTiles archive per map version.                                                                                |
| Storage per map version                       | **~14 MB** of tiles (+ original file 4–6 MB), far below the 100–300 MB estimate.                                                                  |
| Print PDF at correct scale?                   | Yes. Known boulders 79.12 mm apart at 1:15 000 and 76.96 mm at 1:10 000 measure exactly that (±0.01 mm) in the rendered PDF.                      |

## OCAD parsing

- `Skarpåsen-Stavsjøfjellet.ocd`: 5.5 MB, format 2018 (OCAD 2020 still writes the 2018 format; the reference PDF's creator is OCAD 2020.8.6), 1:15 000, georeferenced EPSG:32632 (UTM 32N), grivation 1.76°, 394 × 433 mm paper (5.9 × 6.5 km), 19 437 objects, 133 symbols used, 35 colours.
- **Supported OCAD format versions** (from ocad2geojson source): 10, 11, 12 and 2018. Files in format < 10 (OCAD 6–9) are rejected with a clear error. Any newer format number would crash with "Cls is not a constructor" instead of a clear message.
- Workaround for unsupported files: open in a newer OCAD (or OpenOrienteering Mapper) and save as OCAD 12 or 2018 format.
- Format 2018 is, to the club's knowledge, the newest OCAD file format, and the club has no files older than OCAD 10. So all of the club's maps are readable. The app should still give a clear error for unknown or too-old versions, with a "save as OCAD 2018" hint.
- Symbol names are in `symbol.description` (not `name`).
- `Crs.toMapCoord()` ignores grivation (rotation): bug to remember when adding georeferencing. `toProjectedCoord()` is correct.

## Rendering fidelity (ocad2geojson → SVG → resvg)

Compared with `compare-reference.ts`: automatic alignment of the A3 reference inside our render, 25 local patches for scale, side-by-side crops and a difference image.

Found and handled:

1. **Pattern ids lost (blocking, fixed in the spike).** ocad2geojson sets `node.id = …`; xmldom does not turn that into an attribute, so every `<pattern>` lost its id. All hatched and structured areas (marsh, north lines, out-of-bounds, scattered trees, …) disappeared: about 2 300 objects on this map. Fixed by defining an `id` accessor on xmldom's `Element` (see `render-ocad.ts`). Worth reporting upstream.

Remaining differences, none blocking for MVP:
2. **Overprint colours not simulated.** OCAD prints "Blue 100% marshes (overprint)" with Multiply, so blue hatch over yellow turns green; we paint it opaque. Visible as a colour shift in marsh-on-open-land areas at low zoom. Fix in the map processing worker: render objects whose colour has the overprint flag with `mix-blend-mode: multiply` (resvg supports it).
3. Hatch/structure patterns start at a different phase than OCAD's. Cosmetic.
4. CMYK→RGB conversion differs slightly (e.g. blue 0,185,242 vs OCAD 0,173,239; brown 194,97,39 vs 185,103,48). Cosmetic; could tune to match OCAD.
5. Text is drawn with system fonts (fallback Arial). Matches the reference here. **The worker Docker image must include the fonts OCAD maps use** (Arial or a metric-compatible substitute such as Liberation Sans).
6. "Pointed end" line caps are not supported. Not visible on this map.

Pixel colour agreement is only 51.5 % on inked pixels, but almost all of that comes from items 2–4 and anti-aliasing. Geometry agrees to fractions of a millimetre.

## PDF maps

- Both PDFs are single-page vector exports from OCAD 2020, with no embedded images or fonts. mupdf prints a harmless "premature end of data in flate filter" warning for both.
- `Old-map-2017.pdf`: 478 × 268 mm. Scale is not stored in the PDF. Estimated 1:15 000 from north lines 33.3 mm apart (= 500 m at 1:15 000) and stroke widths matching the 1:15 000 reference (no 150 % enlargement); **confirmed 1:15 000 by the club**. This supports the plan's rule that the admin confirms the scale for PDF maps.
- Render time: 6 s (300 dpi) to 13 s (508 dpi) per page, single-threaded WASM. Acceptable in a background job.

## Tiles

Built by `build-tiles.ts`: render once at the finest level, cut 256 px tiles, downsample per level, skip all-white tiles, write PMTiles v3 (own minimal writer, validated by reading back with the official `pmtiles` reader).

- Map frame: ground metres, y up. OCAD: paper coordinates × scale. PDF: origin at the page's bottom-left corner.
- Finest level 0.05 mm paper per pixel (508 dpi) = 0.75 m/px at 1:15 000. 7 levels (z0–z6).
- Grid maths checked: 40/40 boulder centres from the OCAD file land on black pixels when converted to tile + pixel with the OpenLayers formula.

| Map                | Finest level   | Tiles | Render | png-palette       | webp-q80 | png-lossless | webp-lossless |
| ------------------ | -------------- | ----- | ------ | ----------------- | -------- | ------------ | ------------- |
| Skarpåsen (OCAD)   | 7882 × 8669 px | 736   | 5 s    | **13.7 MB**, 9 s  | 12.7 MB  | 27.1 MB      | 22.6 MB, 20 s |
| Old-map-2017 (PDF) | 9565 × 5350 px | 789   | 13 s   | **13.3 MB**, 10 s | 10.5 MB  | 29.6 MB      | –             |

- **Lossy WebP is not suitable**: 4:2:0 chroma subsampling turns alternating blue/yellow marsh lines teal (PSNR 20 dB vs lossless; smart subsampling does not help). Palette PNG reaches 58 dB and looks identical; maps have few colours.
- Memory: the finest level is held as raw RGB (~150–205 MB for these maps). A 60 × 60 cm map would be ~12 000² px (~430 MB RGB). For large maps the worker should render in strips (resvg can render any viewBox region, as `make-print-pdf.ts` does).
- Viewer: `pnpm --dir spikes serve`, then http://127.0.0.1:8787. It uses an OpenLayers custom projection in metres, reads tiles from PMTiles via HTTP range requests, and has a scale line, a measuring tool and markers on the test boulders.

## Print PDF

`make-print-pdf.ts`: A4, 600 dpi palette-PNG map raster rendered just for the print area, 8 mm white margins, two 5 mm control circles + leg line in purple with Multiply blending, and a 1 km scale bar. Verified by rendering the PDF back with mupdf and finding the boulders.

| Print scale         | Map raster     | Time    | PDF size | Expected vs measured distance |
| ------------------- | -------------- | ------- | -------- | ----------------------------- |
| 1:15 000            | 4961 × 7016 px | 5 + 3 s | 5.1 MB   | 79.12 vs 79.12 mm             |
| 1:10 000 (enlarged) | 4961 × 7016 px | 4 + 3 s | 4.1 MB   | 76.96 vs 76.96 mm             |

Deferred: a physical printout measured with a ruler (printer scaling must be "100 % / actual size"). The PDF export's acceptance test repeats it.

The viewer was checked by hand: a distance measured in the viewer matches the same distance in OCAD.

## Decisions for the plan

- Renderer: ocad2geojson + xmldom (with the id fix) + resvg-js for OCAD; mupdf.js for PDF; pdf-lib for print PDFs. sharp for image work.
- Tiles: palette PNG, 256 px, PMTiles, finest 0.05 mm/px, all-white tiles skipped.
- Storage budget: ~15–20 MB per map version including the original.

## Open questions

1. A ruler check of a printed `out/print/*.pdf` at 100 % printer scaling (deferred; the PDF export's acceptance test repeats it).

## Scripts

All run from the repo root with `pnpm --dir spikes <script> …`; outputs go to `spikes/out/` (gitignored).

| Script                                        | Purpose                                              |
| --------------------------------------------- | ---------------------------------------------------- |
| `inspect-ocad <map.ocd>`                      | Version, scale, georef, extent, symbol/object counts |
| `dump-symbols <map.ocd>`                      | Colour table and used symbols                        |
| `render-ocad <map.ocd> [dpi]`                 | Full map PNG + SVG                                   |
| `render-pdf <map.pdf> [dpi]`                  | PDF page PNG + page size                             |
| `compare-reference <map.ocd> <ref.pdf> [dpi]` | Alignment, scale error, diff + detail crops          |
| `pdf-line-widths <map.pdf>`                   | Stroke-width histogram (print-scale estimate)        |
| `build-tiles <map> [--scale N]`               | Tile pyramid, format comparison, PMTiles, checks     |
| `tile-quality <name> <z> <x> <y>`             | Encoding comparison for one tile                     |
| `serve`                                       | Local viewer on http://127.0.0.1:8787                |
| `make-print-pdf <map.ocd> [--print-scale N]`  | A4 print PDF + scale verification                    |
