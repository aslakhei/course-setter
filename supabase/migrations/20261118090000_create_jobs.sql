-- Background jobs (map processing, tiles, PDF export) run by the worker service.
--
-- Flow: inserting a job pokes the worker over HTTP (pg_net). The worker then claims jobs one at a time
-- with claim_job() (FOR UPDATE SKIP LOCKED, so several workers never get the same job) and reports
-- complete_job() or fail_job(). A failed job is retried with backoff until max_attempts, then marked
-- failed. A pg_cron sweep every minute requeues jobs whose worker died and pokes the worker when
-- retries are due.
--
-- The worker's URL and shared secret live in Vault (secrets `worker_url` and `worker_secret`); without
-- them jobs simply wait in the queue. See README "Worker" for how to set them.

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

create type public.job_status as enum ('queued', 'running', 'done', 'failed');

create table public.jobs (
  id bigint generated always as identity primary key,
  type text not null,
  payload jsonb not null default '{}',
  status public.job_status not null default 'queued',
  attempts integer not null default 0,
  max_attempts integer not null default 3 check (max_attempts > 0),
  -- Not claimed before this time (backoff between retries).
  run_after timestamptz not null default now(),
  -- While running: the job is given up on (requeued or failed) by the sweep after this time.
  locked_until timestamptz,
  locked_by text,
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

comment on table public.jobs is 'Background work for the worker service; see migration create_jobs for the life cycle.';

create index jobs_queued_idx on public.jobs (run_after, id) where status = 'queued';
create index jobs_running_idx on public.jobs (locked_until) where status = 'running';

-- Only the worker (secret key = service_role) touches jobs for now; users get read access to their
-- own jobs together with clubs and map upload.
alter table public.jobs enable row level security;
revoke all on public.jobs from anon, authenticated;
grant all on public.jobs to service_role;

-- Claim the next due job, or return no row when the queue is empty.
create function public.claim_job(worker text, lock_seconds integer default 900)
returns setof public.jobs
language sql
set search_path = ''
as $$
  update public.jobs j
  set status = 'running',
      attempts = j.attempts + 1,
      locked_by = worker,
      locked_until = now() + make_interval(secs => lock_seconds),
      started_at = now(),
      error = null
  where j.id = (
    select id from public.jobs
    where status = 'queued' and run_after <= now()
    order by run_after, id
    limit 1
    for update skip locked
  )
  returning j.*;
$$;

create function public.complete_job(job_id bigint, job_result jsonb default null)
returns void
language sql
set search_path = ''
as $$
  update public.jobs
  set status = 'done', result = job_result, finished_at = now(), locked_until = null
  where id = job_id and status = 'running';
$$;

-- Requeue with backoff (30 s, 60 s, 90 s, ...) or mark failed when no attempts are left.
create function public.fail_job(job_id bigint, job_error text)
returns void
language sql
set search_path = ''
as $$
  update public.jobs
  set status = case when attempts >= max_attempts then 'failed'::public.job_status else 'queued' end,
      run_after = now() + make_interval(secs => 30 * attempts),
      finished_at = case when attempts >= max_attempts then now() end,
      locked_until = null,
      error = job_error
  where id = job_id and status = 'running';
$$;

-- Internal functions, not reachable through the API (the schema is not exposed).
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- Ask the worker to drain the queue. Fire and forget: pg_net sends the request after commit.
create function private.poke_worker()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  url text;
  secret text;
begin
  select decrypted_secret into url from vault.decrypted_secrets where name = 'worker_url';
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'worker_secret';
  if url is null or secret is null then
    return;
  end if;
  perform net.http_post(
    url := url,
    body := '{}'::jsonb,
    headers := jsonb_build_object('content-type', 'application/json', 'x-worker-secret', secret),
    -- The worker answers when the queue is drained, which can take minutes for map jobs.
    timeout_milliseconds := 15 * 60 * 1000
  );
end;
$$;

create function private.poke_worker_on_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.poke_worker();
  return null;
end;
$$;

-- One request per insert statement, however many jobs it adds.
create trigger jobs_poke_worker
  after insert on public.jobs
  for each statement execute function private.poke_worker_on_insert();

-- Give up on jobs whose lock expired (worker crashed or timed out), then poke the worker if any job is due.
create function private.sweep_jobs()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.jobs
  set status = case when attempts >= max_attempts then 'failed'::public.job_status else 'queued' end,
      run_after = now(),
      finished_at = case when attempts >= max_attempts then now() end,
      locked_until = null,
      error = 'timed out (worker stopped or exceeded its lock)'
  where status = 'running' and locked_until < now();

  if exists (select 1 from public.jobs where status = 'queued' and run_after <= now()) then
    perform private.poke_worker();
  end if;
end;
$$;

-- Supabase grants execute on new functions to the API roles by default; only the worker may call these.
revoke execute on function public.claim_job(text, integer) from public, anon, authenticated;
revoke execute on function public.complete_job(bigint, jsonb) from public, anon, authenticated;
revoke execute on function public.fail_job(bigint, text) from public, anon, authenticated;
grant execute on function public.claim_job(text, integer) to service_role;
grant execute on function public.complete_job(bigint, jsonb) to service_role;
grant execute on function public.fail_job(bigint, text) to service_role;
revoke execute on function private.poke_worker() from public, anon, authenticated;
revoke execute on function private.poke_worker_on_insert() from public, anon, authenticated;
revoke execute on function private.sweep_jobs() from public, anon, authenticated;

select cron.schedule('sweep-jobs', '* * * * *', 'select private.sweep_jobs()');
