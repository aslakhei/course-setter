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

Local Supabase (database, auth, storage) runs in Docker, so Docker Desktop must be running.

```sh
pnpm install
pnpm db:start     # local Supabase; first run downloads images
pnpm db:status    # API URL and publishable key for the next step
# copy apps/web/.env.example -> apps/web/.env.local and fill in the two values
# copy supabase/.env.example -> supabase/.env and fill in the Google OAuth client
pnpm dev          # web app on http://localhost:5173
```

Database changes are SQL migrations in `supabase/migrations/` (create one with `pnpm exec supabase migration new <name>`). Every table enables row-level security and grants access explicitly; the hosted project does not expose new tables automatically. After a schema change run `pnpm db:reset` and `pnpm db:types`.

## Scripts

| Command                                     | Does                                                            |
| ------------------------------------------- | --------------------------------------------------------------- |
| `pnpm dev`                                  | Start the web app in development mode                           |
| `pnpm lint`                                 | Biome lint + format check (what CI runs)                        |
| `pnpm fix`                                  | Apply Biome formatting and safe fixes                           |
| `pnpm typecheck`                            | TypeScript in every package                                     |
| `pnpm test`                                 | Vitest across all apps and packages                             |
| `pnpm build`                                | Production build of the web app                                 |
| `pnpm --filter @course-setter/worker start` | Run the worker (`PORT`, default 8080)                           |
| `pnpm db:start` / `db:stop`                 | Start / stop local Supabase                                     |
| `pnpm db:reset`                             | Recreate the local database from migrations                     |
| `pnpm db:test`                              | Database tests (pgTAP, row-level security)                      |
| `pnpm db:types`                             | Regenerate `apps/web/src/lib/database.types.ts` from the schema |
| `pnpm test:integration`                     | Tests against local Supabase (storage range requests)           |

CI runs lint, typecheck, test and build, plus database and storage tests against a local Supabase, on every pull request and on `main`.

## Deployment

- Merging to `main` applies new migrations to the hosted Supabase project (Stockholm) and deploys the web app to Cloudflare Pages.
- Every pull request gets a preview of the web app at `https://<branch>.course-setter.pages.dev`.
- Non-secret settings are GitHub repository variables (`SUPABASE_PROJECT_REF`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`); secrets (`SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`) are GitHub repository secrets.

## Map files

Club maps are club property. Put test maps in `spikes/maps/` (gitignored, never commit them); anything rendered from them goes to `spikes/out/` (also gitignored).
