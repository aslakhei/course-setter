-- Job queue: access, claiming, retries and the sweep. Run with: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

-- Access: only the worker (service_role) sees jobs or calls the queue functions.
set local role anon;
select throws_ok($$ select * from public.jobs $$, '42501', null, 'anonymous visitors cannot read jobs');
select throws_ok($$ select public.claim_job('x') $$, '42501', null, 'anonymous visitors cannot claim jobs');
set local role authenticated;
select throws_ok($$ select * from public.jobs $$, '42501', null, 'signed-in users cannot read jobs');
select throws_ok($$ insert into public.jobs (type) values ('ping') $$, '42501', null, 'signed-in users cannot add jobs');
select throws_ok($$ select public.fail_job(1, 'x') $$, '42501', null, 'signed-in users cannot fail jobs');
select throws_ok($$ select private.sweep_jobs() $$, '42501', null, 'signed-in users cannot run the sweep');
reset role;

set local role service_role;

-- Without worker_url/worker_secret in Vault, adding a job just queues it.
insert into public.jobs (type, payload) values ('ping', '{"n": 1}');
insert into public.jobs (type, payload, run_after) values ('ping', '{"n": 2}', now() + interval '1 hour');

select results_eq(
  $$ select payload ->> 'n', status::text, attempts from public.claim_job('w1') $$,
  $$ values ('1', 'running', 1) $$,
  'claim_job takes the oldest due job and counts the attempt'
);
select is_empty($$ select * from public.claim_job('w1') $$, 'jobs not yet due are not claimed');

select public.complete_job(id, '{"pong": true}') from public.jobs where payload ->> 'n' = '1';
select results_eq(
  $$ select status::text, result, finished_at is not null from public.jobs where payload ->> 'n' = '1' $$,
  $$ values ('done', '{"pong": true}'::jsonb, true) $$,
  'complete_job marks the job done with its result'
);

-- Retries: a failing job is requeued with backoff, then marked failed after max_attempts.
insert into public.jobs (type, max_attempts) values ('fail', 2);
select public.fail_job(id, 'boom 1') from public.claim_job('w1');
select results_eq(
  $$ select status::text, error, run_after > now() from public.jobs where type = 'fail' $$,
  $$ values ('queued', 'boom 1', true) $$,
  'the first failure requeues the job with a delay'
);
select is_empty($$ select * from public.claim_job('w1') $$, 'a failed job is not retried before its backoff');

update public.jobs set run_after = now() where type = 'fail';
select results_eq(
  $$ select attempts from public.claim_job('w1') $$,
  $$ values (2) $$,
  'after the backoff the job is claimed again'
);
select public.fail_job(id, 'boom 2') from public.jobs where type = 'fail';
select results_eq(
  $$ select status::text, error, finished_at is not null from public.jobs where type = 'fail' $$,
  $$ values ('failed', 'boom 2', true) $$,
  'the last allowed failure marks the job failed'
);
select is_empty($$ select * from public.claim_job('w1') $$, 'failed jobs are never claimed');

select public.complete_job(id) from public.jobs where type = 'fail';
select is(
  (select status::text from public.jobs where type = 'fail'),
  'failed',
  'only running jobs can be completed'
);
reset role;

-- Sweep: a running job whose lock expired is requeued, or failed when out of attempts.
insert into public.jobs (type, status, attempts, max_attempts, locked_until, payload) values
  ('ping', 'running', 1, 3, now() - interval '1 second', '{"n": "stuck"}'),
  ('ping', 'running', 3, 3, now() - interval '1 second', '{"n": "stuck-last"}'),
  ('ping', 'running', 1, 3, now() + interval '1 hour', '{"n": "busy"}');
select private.sweep_jobs();
select results_eq(
  $$ select payload ->> 'n', status::text from public.jobs where payload ->> 'n' like 'stuck%' or payload ->> 'n' = 'busy' order by id $$,
  $$ values ('stuck', 'queued'), ('stuck-last', 'failed'), ('busy', 'running') $$,
  'the sweep requeues expired jobs, fails those out of attempts and leaves live ones'
);

-- With worker_url/worker_secret set, adding a job queues a request to the worker with the secret.
select vault.create_secret('http://worker.test/jobs/run', 'worker_url');
select vault.create_secret('s3cret', 'worker_secret');
delete from net.http_request_queue;
insert into public.jobs (type) values ('ping'), ('ping');
select results_eq(
  $$ select url, method::text, headers ->> 'x-worker-secret' from net.http_request_queue $$,
  $$ values ('http://worker.test/jobs/run', 'POST', 's3cret') $$,
  'one insert statement sends one request to the worker'
);

delete from net.http_request_queue;
select private.sweep_jobs();
select is(
  (select count(*) from net.http_request_queue),
  1::bigint,
  'the sweep pokes the worker when jobs are due'
);

select is(
  (select count(*) from cron.job where jobname = 'sweep-jobs' and schedule = '* * * * *'),
  1::bigint,
  'the sweep is scheduled every minute'
);

select * from finish();
rollback;
