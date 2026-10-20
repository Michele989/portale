-- =========================================================================
-- PRECARICAMENTO NOTTURNO DEI PREZZI (modello)
-- INSTALLA_PRECARICA.bat genera da questo file "cron_precarica_pronto.sql"
-- con i tuoi dati gia' inseriti: incolla quello nel SQL Editor di Supabase.
-- Prima abilita le estensioni:  Database -> Extensions -> pg_cron e pg_net.
-- Orari in UTC. Parte dopo gli avvisi (21:15-22:15) e usa il limite giornaliero
-- del servizio dati, che si azzera a mezzanotte UTC. Ogni chiamata scarica fino a
-- 12 titoli (circa 8 al minuto, il limite del piano gratuito).
-- =========================================================================
select cron.unschedule(jobname) from cron.job where jobname like 'precarica-%';

select cron.schedule('precarica-sera', '30-59/3 22-23 * * 1-5', $$
  select net.http_post(url := '__PROJECT_URL__/functions/v1/precarica',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '__PRECARICA_SECRET__'),
    body := '{}'::jsonb, timeout_milliseconds := 150000) $$);
select cron.schedule('precarica-notte', '*/3 0-1 * * 2-6', $$
  select net.http_post(url := '__PROJECT_URL__/functions/v1/precarica',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '__PRECARICA_SECRET__'),
    body := '{}'::jsonb, timeout_milliseconds := 150000) $$);

-- Per controllare:      select jobname, schedule from cron.job;
-- Esito delle chiamate: select * from cron.job_run_details order by start_time desc limit 10;
-- Per spegnere:         select cron.unschedule(jobname) from cron.job where jobname like 'precarica-%';
