# course-setter

Web application for setting orienteering courses on club maps. Club admins upload maps (OCAD or PDF) once; members set courses in the browser and export print-ready PDFs and IOF XML 3.0.

Licence: AGPL-3.0.

## Repository layout

| Path            | What                                                                                   |
| --------------- | -------------------------------------------------------------------------------------- |
| `apps/web`      | Browser app: React + Vite (OpenLayers map editor to come)                              |
| `apps/worker`   | Node service for map processing, tiles and PDF export (runs in a container)            |
| `packages/core` | Shared course logic: scale, lengths, control descriptions, IOF XML                     |
| `spikes`        | Map rendering prototypes and their findings ([spikes/FINDINGS.md](spikes/FINDINGS.md)) |

TypeScript is run directly by Node (type stripping), so packages have no build step; only `apps/web` is built by Vite. Use `.ts` extensions in relative imports and only erasable TypeScript syntax (no `enum`, no `namespace`).

## Setup

Requirements: Node 26 (see `.nvmrc`) and pnpm 12 (`npm install -g pnpm`; the exact version comes from `packageManager` in `package.json`).

```sh
pnpm install
pnpm dev          # web app on http://localhost:5173
```

## Scripts

| Command                                     | Does                                     |
| ------------------------------------------- | ---------------------------------------- |
| `pnpm dev`                                  | Start the web app in development mode    |
| `pnpm lint`                                 | Biome lint + format check (what CI runs) |
| `pnpm fix`                                  | Apply Biome formatting and safe fixes    |
| `pnpm typecheck`                            | TypeScript in every package              |
| `pnpm test`                                 | Vitest across all apps and packages      |
| `pnpm build`                                | Production build of the web app          |
| `pnpm --filter @course-setter/worker start` | Run the worker (`PORT`, default 8080)    |

CI runs lint, typecheck, test and build on every pull request and on `main`.

## Map files

Club maps are club property. Put test maps in `spikes/maps/` (gitignored, never commit them); anything rendered from them goes to `spikes/out/` (also gitignored).
