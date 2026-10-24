-- =========================================================================
-- SCHEMA DATABASE - Tickly (accesso con chiavi a usi)
-- =========================================================================
-- Da eseguire nel SQL Editor di Supabase (New query -> incolla -> Run).
-- E' idempotente: puoi rieseguirlo senza danni.
-- =========================================================================

-- 1) PROFILI: uno per ogni utente registrato (username scelto in registrazione)
create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  email text not null,
  termini_accettati_il timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists profiles_username_lower_uidx
  on public.profiles (lower(username));

-- 2) AMMINISTRATORI
create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);

-- 3) CHIAVI DI ACCESSO: una chiave attiva per utente, con usi e scadenza
create table if not exists public.access_keys (
  id bigint generated always as identity primary key,
  codice text not null unique,
  user_id uuid not null references auth.users(id) on delete cascade,
  stato text not null default 'attiva'
    check (stato in ('attiva', 'disattivata', 'sostituita')),
  usi_totali integer not null check (usi_totali >= 0),
  usi_rimasti integer not null check (usi_rimasti >= 0),
  scade_il timestamptz,
  creata_il timestamptz not null default now(),
  ultimo_uso_il timestamptz,
  note text
);
create unique index if not exists access_keys_una_attiva_per_utente
  on public.access_keys (user_id) where stato = 'attiva';
create index if not exists access_keys_user_idx on public.access_keys (user_id);

-- 4) DATI PERSONALI DEL CLIENTE
create table if not exists public.watchlist (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  ticker text not null check (ticker ~ '^[A-Z0-9.-]{1,12}$'),
  tipo text not null default 'azioni' check (tipo in ('azioni', 'etf', 'crescita')),
  created_at timestamptz not null default now(),
  unique (user_id, ticker)
);

create table if not exists public.portfolio (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  ticker text not null check (ticker ~ '^[A-Z0-9.-]{1,12}$'),
  quantita numeric not null check (quantita > 0),
  prezzo_acquisto numeric not null check (prezzo_acquisto > 0),
  data_acquisto date not null default current_date,
  unique (user_id, ticker)
);

create table if not exists public.impostazioni_rischio (
  user_id uuid primary key references auth.users(id) on delete cascade,
  stop_loss numeric not null default 8 check (stop_loss > 0 and stop_loss < 100),
  take_profit numeric not null default 8 check (take_profit > 0 and take_profit <= 1000),
  commissione numeric not null default 0.2 check (commissione >= 0 and commissione <= 10),
  capitale numeric not null default 1000 check (capitale >= 0 and capitale <= 1000000000),
  rischio_pct numeric not null default 1 check (rischio_pct > 0 and rischio_pct <= 100),
  inizializzato boolean not null default false
);

-- 5) CACHE DEI PREZZI (condivisa tra tutti i clienti, solo server)
create table if not exists public.price_cache (
  ticker text primary key,
  dati jsonb not null,
  aggiornato_il timestamptz not null default now()
);

-- 6) FUNZIONI
-- 6a) Crea il profilo alla registrazione, gestendo username duplicati
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base text;
  v_user text;
begin
  v_base := nullif(trim(coalesce(new.raw_user_meta_data->>'username', '')), '');
  if v_base is null then
    v_base := split_part(coalesce(new.email, 'utente'), '@', 1);
  end if;
  v_base := left(regexp_replace(v_base, '[^A-Za-z0-9_.-]', '', 'g'), 20);
  if length(v_base) < 3 then
    v_base := 'utente' || floor(random() * 9000 + 1000)::int;
  end if;
  v_user := v_base;
  while exists (select 1 from public.profiles where lower(username) = lower(v_user)) loop
    v_user := left(v_base, 15) || floor(random() * 9000 + 1000)::int;
  end loop;
  insert into public.profiles (user_id, username, email, termini_accettati_il)
  values (
    new.id, v_user, coalesce(new.email, ''),
    case when (new.raw_user_meta_data->>'termini') = 'true' then now() end
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 6b) Controllo disponibilita' username (usato dal modulo di registrazione)
create or replace function public.username_disponibile(p_username text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select not exists (
    select 1 from public.profiles where lower(username) = lower(trim(p_username))
  );
$$;
grant execute on function public.username_disponibile(text) to anon, authenticated;

-- 6c) Consumo atomico di UN uso. Restituisce gli usi rimasti, oppure -1 se
--     la chiave non esiste, e' disattivata, scaduta o senza usi.
create or replace function public.consuma_uso(p_user uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v integer;
begin
  update public.access_keys
     set usi_rimasti = usi_rimasti - 1,
         ultimo_uso_il = now()
   where user_id = p_user
     and stato = 'attiva'
     and usi_rimasti > 0
     and (scade_il is null or scade_il > now())
  returning usi_rimasti into v;
  if v is null then
    return -1;
  end if;
  return v;
end;
$$;

-- 6d) Rimborso di un uso (se l'analisi fallisce per colpa del servizio dati)
create or replace function public.rimborsa_uso(p_user uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v integer;
begin
  update public.access_keys
     set usi_rimasti = least(usi_totali, usi_rimasti + 1)
   where user_id = p_user and stato = 'attiva'
  returning usi_rimasti into v;
  return coalesce(v, -1);
end;
$$;

-- Solo il server (service_role) puo' consumare o rimborsare usi:
revoke all on function public.consuma_uso(uuid) from public, anon, authenticated;
revoke all on function public.rimborsa_uso(uuid) from public, anon, authenticated;
grant execute on function public.consuma_uso(uuid) to service_role;
grant execute on function public.rimborsa_uso(uuid) to service_role;

-- 6e) Elenco dei titoli da precaricare di notte (seguiti da almeno un cliente e scaricati prima dell'ultima chiusura, 21:10 UTC)
drop function if exists public.titoli_da_precaricare(integer);
create or replace function public.titoli_da_precaricare(p_limite integer default 12, p_extra text[] default '{}')
returns table (ticker text)
language sql
security definer
set search_path = public
as $$
  select t.ticker
    from (select u.ticker, min(u.prio) prio
            from (select w.ticker, 0 prio from public.watchlist w
                  union all select p.ticker, 0 from public.portfolio p
                  union all select 'SPY'::text, 0
                  union all select upper(x), 1 from unnest(coalesce(p_extra, '{}')) x
                             where upper(x) ~ '^[A-Z0-9.-]{1,12}$') u
           group by u.ticker) t
    left join public.price_cache c on c.ticker = t.ticker
   where c.ticker is null
      or coalesce((c.dati->>'v')::integer, 1) < 2
      or c.aggiornato_il < ((date_trunc('day', (now() at time zone 'utc') - interval '21 hours 10 minutes')
                             + interval '21 hours 10 minutes') at time zone 'utc')
   order by t.prio, c.aggiornato_il asc nulls first, t.ticker
   limit greatest(1, least(coalesce(p_limite, 12), 50));
$$;
revoke all on function public.titoli_da_precaricare(integer, text[]) from public, anon, authenticated;
grant execute on function public.titoli_da_precaricare(integer, text[]) to service_role;

-- 6f) Registro automatico dei verdetti per orizzonte (misura l'affidabilita' reale nel tempo)
create table if not exists public.verdetti_orizzonte (
  id bigint generated always as identity primary key,
  ticker text not null check (ticker ~ '^[A-Z0-9.-]{1,12}$'),
  orizzonte text not null check (orizzonte in ('breve', 'medio', 'lungo')),
  data_verdetto date not null,
  prezzo numeric not null,
  verdetto text not null check (verdetto in ('favorevole', 'neutro', 'sfavorevole')),
  punteggio integer,
  data_esito date,
  rendimento numeric,            -- % tra il giorno del verdetto e la fine dell'orizzonte (prezzi corretti)
  creato_il timestamptz not null default now(),
  unique (ticker, orizzonte, data_verdetto)
);
create index if not exists verdetti_aperti_idx on public.verdetti_orizzonte (ticker) where data_esito is null;
alter table public.verdetti_orizzonte enable row level security;  -- nessuna policy: solo server

create or replace function public.verdetti_conteggi()
returns jsonb
language sql
security definer
stable
set search_path = public
as $$
  select jsonb_build_object(
    'righe', coalesce((select jsonb_agg(jsonb_build_object(
        'orizzonte', orizzonte, 'verdetto', verdetto, 'n', n, 'positivi', pos, 'rend_medio', rm))
      from (select orizzonte, verdetto, count(*) n, count(*) filter (where rendimento > 0) pos, avg(rendimento) rm
              from public.verdetti_orizzonte where data_esito is not null group by 1, 2) x), '[]'::jsonb),
    'aperti', coalesce((select jsonb_object_agg(orizzonte, n)
      from (select orizzonte, count(*) n from public.verdetti_orizzonte where data_esito is null group by 1) y), '{}'::jsonb),
    'dal', (select min(data_verdetto) from public.verdetti_orizzonte)
  );
$$;
revoke all on function public.verdetti_conteggi() from public, anon, authenticated;
grant execute on function public.verdetti_conteggi() to service_role;

-- 7) SICUREZZA A LIVELLO DI RIGA (RLS): ognuno vede solo i propri dati.
--    Le chiavi si creano e modificano SOLO dal pannello admin (server).
alter table public.profiles enable row level security;
alter table public.admins enable row level security;
alter table public.access_keys enable row level security;
alter table public.watchlist enable row level security;
alter table public.portfolio enable row level security;
alter table public.impostazioni_rischio enable row level security;
alter table public.price_cache enable row level security;  -- nessuna policy: solo server

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select using (auth.uid() = user_id);

drop policy if exists admins_select_own on public.admins;
create policy admins_select_own on public.admins
  for select using (auth.uid() = user_id);

drop policy if exists keys_select_own on public.access_keys;
create policy keys_select_own on public.access_keys
  for select using (auth.uid() = user_id);

drop policy if exists wl_select_own on public.watchlist;
create policy wl_select_own on public.watchlist
  for select using (auth.uid() = user_id);
drop policy if exists wl_insert_own on public.watchlist;
create policy wl_insert_own on public.watchlist
  for insert with check (
    auth.uid() = user_id
    and (select count(*) from public.watchlist w where w.user_id = auth.uid()) < 500
  );
drop policy if exists wl_delete_own on public.watchlist;
create policy wl_delete_own on public.watchlist
  for delete using (auth.uid() = user_id);

drop policy if exists pf_select_own on public.portfolio;
create policy pf_select_own on public.portfolio
  for select using (auth.uid() = user_id);
drop policy if exists pf_insert_own on public.portfolio;
create policy pf_insert_own on public.portfolio
  for insert with check (auth.uid() = user_id);
drop policy if exists pf_update_own on public.portfolio;
create policy pf_update_own on public.portfolio
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists pf_delete_own on public.portfolio;
create policy pf_delete_own on public.portfolio
  for delete using (auth.uid() = user_id);

drop policy if exists imp_select_own on public.impostazioni_rischio;
create policy imp_select_own on public.impostazioni_rischio
  for select using (auth.uid() = user_id);
drop policy if exists imp_insert_own on public.impostazioni_rischio;
create policy imp_insert_own on public.impostazioni_rischio
  for insert with check (auth.uid() = user_id);
drop policy if exists imp_update_own on public.impostazioni_rischio;
create policy imp_update_own on public.impostazioni_rischio
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 8) FUNZIONI AMMINISTRATIVE ATOMICHE (solo server / service_role)
-- 8a) Crea una nuova chiave per l'utente; l'eventuale chiave attiva precedente
--     diventa 'sostituita'. Se il codice esiste gia' tutto viene annullato.
create or replace function public.crea_chiave(
  p_user uuid, p_codice text, p_usi integer, p_giorni integer, p_note text
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint;
begin
  update public.access_keys
     set stato = 'sostituita'
   where user_id = p_user and stato = 'attiva';
  insert into public.access_keys (codice, user_id, stato, usi_totali, usi_rimasti, scade_il, note)
  values (
    p_codice, p_user, 'attiva', p_usi, p_usi,
    case when p_giorni is not null then now() + make_interval(days => p_giorni) end,
    p_note
  )
  returning id into v_id;
  return v_id;
end;
$$;

-- 8b) Aggiunge usi (ed eventualmente giorni) a una chiave attiva. -1 se non trovata.
create or replace function public.aggiungi_usi(p_key bigint, p_usi integer, p_giorni integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v integer;
begin
  update public.access_keys
     set usi_totali = usi_totali + greatest(p_usi, 0),
         usi_rimasti = usi_rimasti + greatest(p_usi, 0),
         scade_il = case
           when p_giorni is not null and scade_il is not null
             then greatest(scade_il, now()) + make_interval(days => p_giorni)
           else scade_il end
   where id = p_key and stato = 'attiva'
  returning usi_rimasti into v;
  return coalesce(v, -1);
end;
$$;

revoke all on function public.crea_chiave(uuid, text, integer, integer, text) from public, anon, authenticated;
revoke all on function public.aggiungi_usi(bigint, integer, integer) from public, anon, authenticated;
grant execute on function public.crea_chiave(uuid, text, integer, integer, text) to service_role;
grant execute on function public.aggiungi_usi(bigint, integer, integer) to service_role;

-- 9) AFFIDABILITA': registro dei segnali reali, statistiche aggregate, calibrazione
-- 9a) Nuovo parametro: spread/slittamento (costo reale oltre la commissione)
alter table public.impostazioni_rischio
  add column if not exists spread numeric not null default 0.1;
do $$ begin
  alter table public.impostazioni_rischio
    add constraint impostazioni_spread_check check (spread >= 0 and spread <= 5);
exception when duplicate_object then null; end $$;

-- 9b) Registro dei segnali emessi (uno per titolo/tipo/giorno, condiviso da tutti i clienti).
--     L'esito viene valutato dal server con regole fisse 8% / 8% / 0,2% e massimo 40 giorni.
create table if not exists public.segnali (
  id bigint generated always as identity primary key,
  ticker text not null check (ticker ~ '^[A-Z0-9.-]{1,12}$'),
  tipo text not null check (tipo in ('trend', 'ribasso')),
  data_segnale date not null,
  prezzo numeric not null,
  p_prevista numeric,            -- % di successo storico dichiarata al momento del segnale
  n_storico integer,
  esito text check (esito in ('vinto', 'perso', 'scaduto')),
  data_esito date,
  giorni integer,
  rendimento numeric,            -- % netto
  creato_il timestamptz not null default now(),
  unique (ticker, tipo, data_segnale)
);
create index if not exists segnali_aperti_idx on public.segnali (ticker) where esito is null;

-- 9c) Conteggi storici standard per titolo (per le statistiche aggregate su molti titoli)
create table if not exists public.backtest_ticker (
  ticker text not null,
  tipo text not null check (tipo in ('trend', 'ribasso')),
  vinti integer not null default 0,
  persi integer not null default 0,
  scaduti integer not null default 0,
  aggiornato_il timestamptz not null default now(),
  primary key (ticker, tipo)
);

alter table public.segnali enable row level security;          -- nessuna policy: solo server
alter table public.backtest_ticker enable row level security;  -- nessuna policy: solo server

-- 9d) Track record pubblico (aggregato, senza dati personali) con calibrazione e Brier score
create or replace function public.track_record()
returns jsonb
language sql
security definer
stable
set search_path = public
as $$
  with c as (select * from public.segnali where esito is not null),
  tot as (
    select count(*) n,
           count(*) filter (where esito = 'vinto') v,
           count(*) filter (where esito = 'perso') p,
           count(*) filter (where esito = 'scaduto') s,
           avg(rendimento) r
      from c
  ),
  base as (
    select case when count(*) > 0 then count(*) filter (where esito = 'vinto')::numeric / count(*) end b from c
  ),
  brier as (
    select avg(power(p_prevista / 100 - (esito = 'vinto')::int, 2)) bs,
           avg(power((select b from base) - (esito = 'vinto')::int, 2)) bb
      from c where p_prevista is not null
  ),
  bucket as (
    select width_bucket(least(p_prevista, 99.999), 0, 100, 5) k,
           count(*) n, avg(p_prevista) prev, avg((esito = 'vinto')::int) * 100 oss
      from c where p_prevista is not null group by 1
  )
  select jsonb_build_object(
    'chiusi', (select n from tot),
    'vinti', (select v from tot),
    'persi', (select p from tot),
    'scaduti', (select s from tot),
    'aperti', (select count(*) from public.segnali where esito is null),
    'rendimento_medio', (select r from tot),
    'dal', (select min(data_segnale) from public.segnali),
    'brier', (select bs from brier),
    'brier_base', (select bb from brier),
    'calibrazione', coalesce((select jsonb_agg(jsonb_build_object(
        'da', (k - 1) * 20, 'a', k * 20, 'previsto', prev, 'osservato', oss, 'n', n) order by k) from bucket), '[]'::jsonb),
    'per_tipo', coalesce((select jsonb_agg(jsonb_build_object(
        'tipo', tipo, 'chiusi', n, 'vinti', v) order by tipo) from (
          select tipo, count(*) n, count(*) filter (where esito = 'vinto') v from c group by tipo) x), '[]'::jsonb)
  );
$$;

-- 9e) Somma dei casi storici su tutti i titoli analizzati: campione molto piu' ampio del singolo titolo
create or replace function public.statistiche_aggregate()
returns jsonb
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'tipo', tipo, 'titoli', titoli, 'vinti', v, 'persi', p, 'scaduti', s) order by tipo), '[]'::jsonb)
  from (
    select tipo, count(*) titoli, sum(vinti)::int v, sum(persi)::int p, sum(scaduti)::int s
      from public.backtest_ticker group by tipo
  ) x;
$$;

revoke all on function public.track_record() from public, anon;
revoke all on function public.statistiche_aggregate() from public, anon;
grant execute on function public.track_record() to authenticated, service_role;
grant execute on function public.statistiche_aggregate() to authenticated, service_role;

-- 10) AVVISI EMAIL A FINE GIORNATA (segnali tecnici di uscita sul portafoglio)
alter table public.impostazioni_rischio add column if not exists avvisi_email boolean not null default false;
alter table public.impostazioni_rischio add column if not exists avvisi_consenso_il timestamptz;
alter table public.impostazioni_rischio add column if not exists avvisi_token uuid not null default gen_random_uuid();
create unique index if not exists impostazioni_avvisi_token_uidx on public.impostazioni_rischio (avvisi_token);

-- Il token di disiscrizione non puo' essere scelto ne' cambiato dal client
create or replace function public.proteggi_token()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    new.avvisi_token := gen_random_uuid();
  else
    new.avvisi_token := old.avvisi_token;
  end if;
  return new;
end;
$$;
drop trigger if exists impostazioni_proteggi_token on public.impostazioni_rischio;
create trigger impostazioni_proteggi_token
  before insert or update on public.impostazioni_rischio
  for each row execute function public.proteggi_token();

-- Avvisi gia' inviati (per non ripetere la stessa segnalazione ogni giorno)
create table if not exists public.avvisi_inviati (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  ticker text not null,
  motivo text not null,
  inviato_il timestamptz not null default now()
);
create index if not exists avvisi_inviati_idx on public.avvisi_inviati (user_id, ticker, motivo, inviato_il desc);
alter table public.avvisi_inviati enable row level security;  -- nessuna policy: solo server

-- Destinatari: consenso dato, email presente, almeno una posizione, chiave attiva e non scaduta
create or replace function public.avvisi_destinatari()
returns jsonb
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'user_id', p.user_id, 'username', p.username, 'email', p.email, 'token', i.avvisi_token,
    'stop_loss', i.stop_loss, 'take_profit', i.take_profit, 'commissione', i.commissione,
    'posizioni', (select jsonb_agg(jsonb_build_object(
        'ticker', f.ticker, 'quantita', f.quantita, 'prezzo_acquisto', f.prezzo_acquisto) order by f.ticker)
      from public.portfolio f where f.user_id = p.user_id)
  )), '[]'::jsonb)
  from public.impostazioni_rischio i
  join public.profiles p on p.user_id = i.user_id
  where i.avvisi_email
    and i.avvisi_consenso_il is not null
    and coalesce(p.email, '') <> ''
    and exists (select 1 from public.portfolio f where f.user_id = i.user_id)
    and exists (select 1 from public.access_keys k
                 where k.user_id = i.user_id and k.stato = 'attiva'
                   and (k.scade_il is null or k.scade_il > now()));
$$;

create or replace function public.avvisi_recenti()
returns jsonb
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('user_id', user_id, 'ticker', ticker, 'motivo', motivo)), '[]'::jsonb)
    from public.avvisi_inviati where inviato_il > now() - interval '7 days';
$$;

create or replace function public.disattiva_avvisi(p_token uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  update public.impostazioni_rischio set avvisi_email = false where avvisi_token = p_token;
  get diagnostics n = row_count;
  return n > 0;
end;
$$;

revoke all on function public.avvisi_destinatari() from public, anon, authenticated;
revoke all on function public.avvisi_recenti() from public, anon, authenticated;
revoke all on function public.disattiva_avvisi(uuid) from public, anon, authenticated;
grant execute on function public.avvisi_destinatari() to service_role;
grant execute on function public.avvisi_recenti() to service_role;
grant execute on function public.disattiva_avvisi(uuid) to service_role;
