-- =========================================================================
-- PIANIFICAZIONE DEGLI AVVISI EMAIL (modello)
-- Lo script INSTALLA_AVVISI.bat genera da questo file "cron_avvisi_pronto.sql"
-- con i tuoi dati gia' inseriti: incolla quello nel SQL Editor di Supabase.
-- Prima abilita le estensioni:  Database -> Extensions -> pg_cron e pg_net.
-- Orari in UTC, dal lunedi al venerdi: la borsa USA chiude alle 20:00/21:00 UTC;
-- si controlla 4 volte dopo le 21:10 UTC (ogni passata scarica solo alcuni titoli
-- nuovi per rispettare il limite del servizio dati, la successiva continua).
-- =========================================================================
select cron.unschedule(jobname) from cron.job where jobname like 'avvisi-sera-%';

select cron.schedule('avvisi-sera-1', '15 21 * * 1-5', $$
  select net.http_post(url := '__PROJECT_URL__/functions/v1/avvisi',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '__CRON_SECRET__'),
    body := '{}'::jsonb, timeout_milliseconds := 140000) $$);
select cron.schedule('avvisi-sera-2', '35 21 * * 1-5', $$
  select net.http_post(url := '__PROJECT_URL__/functions/v1/avvisi',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '__CRON_SECRET__'),
    body := '{}'::jsonb, timeout_milliseconds := 140000) $$);
select cron.schedule('avvisi-sera-3', '55 21 * * 1-5', $$
  select net.http_post(url := '__PROJECT_URL__/functions/v1/avvisi',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '__CRON_SECRET__'),
    body := '{}'::jsonb, timeout_milliseconds := 140000) $$);
select cron.schedule('avvisi-sera-4', '15 22 * * 1-5', $$
  select net.http_post(url := '__PROJECT_URL__/functions/v1/avvisi',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '__CRON_SECRET__'),
    body := '{}'::jsonb, timeout_milliseconds := 140000) $$);

-- Per controllare che siano state create:   select jobname, schedule from cron.job;
-- Per vedere come sono andate le chiamate:  select * from cron.job_run_details order by start_time desc limit 10;
-- Per spegnere gli avvisi:                  select cron.unschedule(jobname) from cron.job where jobname like 'avvisi-sera-%';
