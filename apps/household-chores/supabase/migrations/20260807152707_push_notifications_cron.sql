-- Household Chores: scheduled trigger for the daily-notifications Edge Function
--
-- Follows Supabase's documented recipe for triggering an Edge Function on a
-- schedule: pg_cron fires an hourly job, pg_net makes the HTTP call, and the
-- function URL + service role key are read from Vault rather than hardcoded
-- (so the same migration works unchanged across local/staging/prod).
--
-- One-time manual setup AFTER deploying the Edge Function (not part of this
-- migration, since the project URL doesn't exist until the project does):
--
--   select vault.create_secret('https://<project-ref>.functions.supabase.co', 'project_functions_url');
--   select vault.create_secret('<service-role-key>', 'service_role_key');
--
-- Runs hourly (not daily) because households can be in any timezone; the
-- Edge Function itself decides, per household, whether "today" has just
-- started there before sending anything.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'daily-chore-notifications',
  '0 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_functions_url') || '/daily-notifications',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);
