-- Incolla TUTTO questo nel SQL Editor di Supabase e premi Run (si può rifare senza problemi).

-- 14) PREVISIONI a orizzonte fisso (21/63/252 sedute): scritte ogni notte per tutti i titoli, MAI modificate.
--     Il risultato reale va in una tabella separata. Tre modelli confrontati (base, simili, bootstrap).
create table if not exists public.previsioni (
  id bigint generated always as identity primary key,
  ticker text not null check (ticker ~ '^[A-Z0-9.-]{1,12}$'),
  data_prev date not null,                          -- chiusura su cui si basa la previsione
  orizzonte integer not null check (orizzonte in (21, 63, 252)),
  modello text not null check (modello in ('base', 'simili', 'bootstrap')),
  versione text not null,
  prob_su numeric not null check (prob_su >= 0 and prob_su <= 1),
  mediana numeric, p05 numeric, p95 numeric,        -- rendimento in %
  prob_perd5 numeric, prob_guad5 numeric, prob_perd10 numeric, prob_guad10 numeric,
  n_eff integer,
  stato text,
  creato_il timestamptz not null default now(),
  unique (ticker, data_prev, orizzonte, modello, versione)
);
create index if not exists previsioni_ticker_idx on public.previsioni (ticker, data_prev desc);

create table if not exists public.previsioni_esiti (
  previsione_id bigint primary key references public.previsioni(id) on delete cascade,
  data_ingresso date not null,
  prezzo_ingresso numeric not null,
  su_apertura boolean not null,                     -- true = ingresso all'apertura di T+1; false = chiusura di T+1 (dati vecchi senza apertura)
  data_esito date not null,
  rendimento numeric not null,                      -- %
  su boolean not null,
  valutato_il timestamptz not null default now()
);

-- risultati delle verifiche di backtest (scritti dal workflow "Validazione")
create table if not exists public.validazioni (
  id bigint generated always as identity primary key,
  eseguita_il timestamptz not null default now(),
  versione text not null,
  esito jsonb not null
);

alter table public.previsioni enable row level security;         -- nessuna policy: solo server
alter table public.previsioni_esiti enable row level security;   -- nessuna policy: solo server
alter table public.validazioni enable row level security;        -- nessuna policy: solo server

-- previsioni di un titolo non ancora valutate (solo server)
create or replace function public.previsioni_aperte(p_ticker text)
returns table (id bigint, data_prev date, orizzonte integer)
language sql security definer stable set search_path = public as $$
  select p.id, p.data_prev, p.orizzonte
    from public.previsioni p
    left join public.previsioni_esiti e on e.previsione_id = p.id
   where p.ticker = upper(p_ticker) and e.previsione_id is null
   order by p.data_prev
   limit 2000;
$$;
revoke all on function public.previsioni_aperte(text) from public, anon, authenticated;
grant execute on function public.previsioni_aperte(text) to service_role;

-- Valutazione pubblica (aggregata): per modello e orizzonte, quanto sono buone le probabilita' rispetto alla base.
-- Brier = errore quadratico medio delle probabilita' (piu' basso e' meglio). BSS > 0: meglio della base.
-- "giorni" = numero di date distinte: i titoli della stessa data non sono prove indipendenti.
create or replace function public.valutazione_previsioni()
returns jsonb
language sql security definer stable set search_path = public as $$
  with m as (
    select p.ticker, p.data_prev, p.orizzonte, p.modello, p.prob_su, e.su::int as y, e.rendimento
      from public.previsioni p join public.previsioni_esiti e on e.previsione_id = p.id
  ),
  b as (select ticker, data_prev, orizzonte, prob_su as prob_base from m where modello = 'base'),
  j as (
    select m.*, b.prob_base from m join b using (ticker, data_prev, orizzonte)
  ),
  r as (
    select modello, orizzonte, count(*) n, count(distinct data_prev) giorni,
           avg(power(prob_su - y, 2)) brier, avg(power(prob_base - y, 2)) brier_base,
           avg(prob_su) prob_media, avg(y::numeric) freq_osservata, avg(rendimento) rend_medio
      from j group by modello, orizzonte
  ),
  cal as (
    select modello, orizzonte, least(floor(prob_su * 10), 9)::int fascia, count(*) n,
           avg(prob_su) dichiarato, avg(y::numeric) osservato
      from m group by 1, 2, 3
  )
  select jsonb_build_object(
    'dal', (select min(data_prev) from public.previsioni),
    'emesse', (select count(*) from public.previsioni),
    'maturate', (select count(*) from public.previsioni_esiti),
    'modelli', coalesce((select jsonb_agg(jsonb_build_object(
        'modello', modello, 'orizzonte', orizzonte, 'n', n, 'giorni', giorni,
        'brier', round(brier::numeric, 4), 'brier_base', round(brier_base::numeric, 4),
        'bss', case when brier_base > 0 then round((1 - brier / brier_base)::numeric, 4) end,
        'prob_media', round((100 * prob_media)::numeric, 1), 'osservato', round((100 * freq_osservata)::numeric, 1),
        'rend_medio', round(rend_medio::numeric, 2)) order by orizzonte, modello) from r), '[]'::jsonb),
    'calibrazione', coalesce((select jsonb_agg(jsonb_build_object(
        'modello', modello, 'orizzonte', orizzonte, 'fascia', fascia, 'n', n,
        'dichiarato', round((100 * dichiarato)::numeric, 1), 'osservato', round((100 * osservato)::numeric, 1))
        order by orizzonte, modello, fascia) from cal where n >= 20), '[]'::jsonb),
    'ultima_validazione', (select esito from public.validazioni order by eseguita_il desc limit 1)
  );
$$;
revoke all on function public.valutazione_previsioni() from public, anon;
grant execute on function public.valutazione_previsioni() to authenticated, service_role;
