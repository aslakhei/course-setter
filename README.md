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

| Command                                     | Does                                                               |
| ------------------------------------------- | ------------------------------------------------------------------ |
| `pnpm dev`                                  | Start the web app in development mode                              |
| `pnpm lint`                                 | Biome lint + format check (what CI runs)                           |
| `pnpm fix`                                  | Apply Biome formatting and safe fixes                              |
| `pnpm typecheck`                            | TypeScript in every package                                        |
| `pnpm test`                                 | Vitest across all apps and packages                                |
| `pnpm build`                                | Production build of the web app                                    |
| `pnpm --filter @course-setter/worker start` | Run the worker (`PORT`, default 8080; reads `apps/worker/.env`)    |
| `pnpm db:start` / `db:stop`                 | Start / stop local Supabase                                        |
| `pnpm db:reset`                             | Recreate the local database from migrations                        |
| `pnpm db:test`                              | Database tests (pgTAP: row-level security, clubs, job queue)       |
| `pnpm db:types`                             | Regenerate `apps/web/src/lib/database.types.ts` from the schema    |
| `pnpm test:integration`                     | Tests against local Supabase (storage, club files, jobs)           |
| `pnpm test:e2e`                             | End-to-end tests: web app build in Chromium against local Supabase |

End-to-end tests need Chromium once: `pnpm --filter @course-setter/web exec playwright install chromium`. They sign test users in with a password, which only local Supabase allows; the app itself only offers Google.

CI runs lint, typecheck, test and build, plus database and integration tests against a local Supabase (including the job queue through the built worker image), on every pull request and on `main`.

## Clubs and access

Everything users create belongs to a club, and row-level security limits it to the club's members (`supabase/migrations/*_create_clubs.sql`):

- Anyone signed in can create a club (`create_club()`) and becomes its first admin. A club always keeps at least one admin.
- Admins invite people with links: a row in `club_invites` whose random token goes into `/invite/<token>`. Links last 14 days by default (at most 90), can be revoked and can be used by many people. `invite_info()` shows what a link leads to; `accept_invite()` joins as member.
- Members see the club, the other members and their name and avatar (never email addresses). Admins also rename the club, change roles, remove members and manage invite links. Anyone can leave.
- Maps: admins upload OCAD or PDF maps on the club's Maps tab (a PDF needs its scale); the worker processes them and members open them in the map viewer (OpenLayers in the map's own metre frame, with a scale bar and a measuring tool).
- Map files live in two private Storage buckets, under `<club_id>/<map_id>/<version_id>/...`. `map-originals`: club admins upload, only the worker reads (users never download an original). `map-tiles`: only the worker writes, club members read (signed URLs for the editor).

## Worker

Background work (map processing, tiles, PDF export) goes through the `jobs` table. Inserting a job makes the database call the worker's `POST /jobs/run` (trigger + `pg_net`, with a shared secret in the `x-worker-secret` header); the worker claims due jobs one at a time, runs them and reports the result. Failed jobs are retried with backoff up to `max_attempts`, then marked `failed`. A `pg_cron` sweep every minute requeues jobs whose worker died and pokes the worker when retries are due. The `ping` job type checks the whole path (`{"fail": true}` makes it fail).

Map jobs (`apps/worker/src/maps/`): `process_map_version` downloads the uploaded original, reads it (OCAD via ocad2geojson and resvg, PDF via mupdf), renders every zoom level from the vector source in strips of rows, cuts 256 px palette-PNG tiles at 0.05 mm of paper per pixel at the finest level, writes one PMTiles archive to `map-tiles/<club>/<map>/<version>/tiles.pmtiles` and fills in scale, paper size, frame extent, georeferencing and the tile grid on the version. A file that cannot be read fails at once with an `error_code` the app explains (`not_ocad`, `unsupported_ocad_version`, `not_pdf`, `unreadable_file`, `empty_map`); other errors are retried. `delete_map_version` removes the files and the row. A 40 × 43 cm OCAD map takes about 1.5 minutes on one CPU and peaks around 0.5 GB of memory.

The OCAD test maps in `apps/worker/test/fixtures/ocad/` come from ocad2geojson's test data (AGPL-3.0). The club's own map is only ever tested locally from `spikes/maps/`: `TEST_CLUB_MAP=1 pnpm --filter @course-setter/worker exec vitest run src/maps/club-map.test.ts` (skipped otherwise).

The database finds the worker through two Vault secrets. Set them in the SQL editor (hosted) or with `psql` (local), and run it again to change them:

```sql
delete from vault.secrets where name in ('worker_url', 'worker_secret');
select vault.create_secret('https://<worker-url>/jobs/run', 'worker_url');
select vault.create_secret('<same value as the worker''s WORKER_SECRET>', 'worker_secret');
```

Without them jobs wait in the queue. Locally, run the worker with `apps/worker/.env` (see `.env.example`) and use `http://host.docker.internal:8080/jobs/run` as `worker_url`.

Then try it:

```sql
insert into public.jobs (type) values ('ping');
select id, status, attempts, result, error from public.jobs order by id desc limit 5;
```

## Deployment

- Merging to `main` applies new migrations to the hosted Supabase project (Stockholm), deploys the worker to Google Cloud Run (`europe-north1`, service `worker`, scales to zero, 2 GiB) and deploys the web app to Cloudflare Pages.
- Every pull request gets a preview of the web app at `https://<branch>.course-setter.pages.dev`.
- Sign-in returns to the page it started from (an invite link stays an invite link), so hosted Supabase -> Authentication -> URL Configuration lists `https://course-setter.pages.dev/**` and `https://*.course-setter.pages.dev/**` as redirect URLs.
- Non-secret settings are GitHub repository variables (`SUPABASE_PROJECT_REF`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, and for the worker `GCP_PROJECT_ID`, `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_DEPLOY_SERVICE_ACCOUNT`, `GCP_WORKER_SERVICE_ACCOUNT`); secrets (`SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`) are GitHub repository secrets.
- GitHub Actions deploys to Google Cloud through Workload Identity Federation (no stored keys). The worker's own secrets live in Google Secret Manager: `supabase-secret-key` (Supabase secret key) and `worker-secret` (must match the Vault secret `worker_secret`). The worker deploy is skipped until `GCP_PROJECT_ID` is set. One-time Google Cloud setup (APIs, Artifact Registry, service accounts, Workload Identity Federation, secrets, budget): [`scripts/setup-gcp.sh`](scripts/setup-gcp.sh).

### Cost limit

The worker is meant to stay inside Google Cloud's free tier: it scales to zero, runs at most one instance (2 GiB, used only while a job runs) and only the two newest images are kept. As a hard stop, a monthly budget (default 1 unit of the billing account's currency, after the free tier) sends its notifications through Pub/Sub to the `budget-guard` Cloud Run service. When the month's cost reaches the budget, it removes public access to the worker, so no worker instance can start; jobs wait in the queue. Billing data lags by a few hours, so the cost can go slightly past the budget before the guard acts.

- Later deploys keep a cut-off worker cut off (the Deploy run shows a warning).
- To raise the budget: `BUDGET_AMOUNT=<amount> PROJECT_ID=<id> bash scripts/setup-gcp.sh` (or edit the `course-setter` budget in the console; keep the Pub/Sub topic).
- To turn the worker back on: Actions -> Deploy -> Run workflow on `main` with "enable worker" ticked. The budget is monthly, so it also resets at the start of the next month, but the worker only comes back when you redeploy like this.

## Map files

Club maps are club property. Put test maps in `spikes/maps/` (gitignored, never commit them); anything rendered from them goes to `spikes/out/` (also gitignored).
