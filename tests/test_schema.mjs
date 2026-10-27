import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
await db.exec(`
 create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
 create schema auth;
 create table auth.users(id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
 grant usage on schema auth to anon, authenticated, service_role;
 grant usage on schema public to anon, authenticated, service_role;
`);
const sql = readFileSync("../supabase/schema.sql", "utf8");
await db.exec(sql); await db.exec(sql); // idempotente
await db.exec(`grant select, insert, update, delete on all tables in schema public to authenticated, service_role;`);

const nuovo = async (email, meta) => (await db.query(`insert into auth.users(email, raw_user_meta_data) values ($1,$2) returning id`, [email, JSON.stringify(meta)])).rows[0].id;
const come = async (uid, fn) => { await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${uid}',false);`); try { return await fn(); } finally { await db.exec(`reset role;`); } };
const falla = async (p, msg) => { let e = null; try { await p; } catch (x) { e = x; } assert.ok(e, msg); };

const a = await nuovo("a@x.it", { username: "Mario", termini: "true" });
const b = await nuovo("b@x.it", { username: "mario" }); // duplicato -> viene rinominato
const c = await nuovo("carlo@x.it", {});
const pr = (await db.query(`select username, termini_accettati_il from profiles order by created_at, username`)).rows;
assert.equal(new Set(pr.map(x => x.username.toLowerCase())).size, 3, "username unici");
assert.equal((await db.query(`select username from profiles where user_id=$1`, [c])).rows[0].username, "carlo");
assert.ok((await db.query(`select termini_accettati_il t from profiles where user_id=$1`, [a])).rows[0].t);
assert.equal((await db.query(`select username_disponibile('MARIO') v`)).rows[0].v, false);
assert.equal((await db.query(`select username_disponibile('libero') v`)).rows[0].v, true);

// chiavi
const k1 = (await db.query(`select crea_chiave($1,'MA-AAAA-BBBB-CCCC',3,30,'prova') id`, [a])).rows[0].id;
const k2 = (await db.query(`select crea_chiave($1,'MA-DDDD-EEEE-FFFF',5,null,null) id`, [a])).rows[0].id;
assert.equal((await db.query(`select stato from access_keys where id=$1`, [k1])).rows[0].stato, "sostituita");
await falla(db.query(`select crea_chiave($1,'MA-DDDD-EEEE-FFFF',5,null,null)`, [b]), "codice duplicato");
assert.equal((await db.query(`select stato from access_keys where id=$1`, [k2])).rows[0].stato, "attiva");
// consumo
for (const atteso of [4, 3, 2, 1, 0, -1]) assert.equal((await db.query(`select consuma_uso($1) v`, [a])).rows[0].v, atteso);
assert.equal((await db.query(`select rimborsa_uso($1) v`, [a])).rows[0].v, 1);
assert.equal((await db.query(`select aggiungi_usi($1,10,null) v`, [k2])).rows[0].v, 11);
assert.equal((await db.query(`select consuma_uso($1) v`, [b])).rows[0].v, -1, "senza chiave");
await db.query(`update access_keys set stato='disattivata' where id=$1`, [k2]);
assert.equal((await db.query(`select consuma_uso($1) v`, [a])).rows[0].v, -1, "disattivata");
await db.query(`update access_keys set stato='attiva', scade_il=now()-interval '1 day' where id=$1`, [k2]);
assert.equal((await db.query(`select consuma_uso($1) v`, [a])).rows[0].v, -1, "scaduta");

// RLS: l'utente non puo' usare le funzioni ne' scrivere chiavi
await come(a, async () => {
  await falla(db.query(`select consuma_uso($1)`, [a]), "consuma_uso vietata ai client");
  await falla(db.query(`select crea_chiave($1,'ZZZZZZ',9,null,null)`, [a]), "crea_chiave vietata");
});
await db.exec(`reset role`);
// (update senza policy non da' errore ma 0 righe: verifichiamo il valore)
await come(a, async () => { await db.query(`update access_keys set usi_rimasti=999`); await db.query(`insert into access_keys(codice,user_id,usi_totali,usi_rimasti) values ('HACK-1',$1,9,9)`, [a]).catch(() => {}); });
assert.notEqual((await db.query(`select usi_rimasti v from access_keys where id=$1`, [k2])).rows[0].v, 999);
assert.equal((await db.query(`select count(*)::int n from access_keys where codice='HACK-1'`)).rows[0].n, 0);
// isolamento dati
await come(a, async () => {
  assert.equal((await db.query(`select count(*)::int n from access_keys`)).rows[0].n, 2);
  assert.equal((await db.query(`select count(*)::int n from profiles`)).rows[0].n, 1);
  await db.query(`insert into watchlist(user_id,ticker,tipo) values ($1,'AAPL','azioni')`, [a]);
  await falla(db.query(`insert into watchlist(user_id,ticker) values ($1,'bad ticker!')`, [a]), "ticker non valido");
  await falla(db.query(`insert into watchlist(user_id,ticker) values ($1,'MSFT')`, [b]), "scrittura per altro utente");
  await db.query(`insert into portfolio(user_id,ticker,quantita,prezzo_acquisto) values ($1,'AAPL',2,100)`, [a]);
  await falla(db.query(`insert into portfolio(user_id,ticker,quantita,prezzo_acquisto) values ($1,'MSFT',-1,100)`, [a]), "quantita negativa");
  assert.equal((await db.query(`select count(*)::int n from price_cache`)).rows[0].n, 0);
});
await come(b, async () => {
  assert.equal((await db.query(`select count(*)::int n from watchlist`)).rows[0].n, 0);
  assert.equal((await db.query(`select count(*)::int n from portfolio`)).rows[0].n, 0);
});
// limite 500 titoli
await come(c, async () => {
  for (let i = 0; i < 500; i++) await db.query(`insert into watchlist(user_id,ticker) values ($1,$2)`, [c, "T" + i]);
  await falla(db.query(`insert into watchlist(user_id,ticker) values ($1,'T61')`, [c]), "limite 500");
});
const a2 = await nuovo('zeta@x.it', {});

// ---- affidabilita': registro segnali, aggregate, calibrazione ----
{
  const ins = (t, tipo, d, p, esito, rend) => db.query(`insert into segnali(ticker,tipo,data_segnale,prezzo,p_prevista,esito,rendimento) values ($1,$2,$3,100,$4,$5,$6)`, [t, tipo, d, p, esito, rend]);
  await ins("AAA", "trend", "2026-01-01", 70, "vinto", 8);
  await ins("BBB", "trend", "2026-01-02", 70, "perso", -8.4);
  await ins("CCC", "ribasso", "2026-01-03", 30, "perso", -8.4);
  await ins("DDD", "ribasso", "2026-01-04", 30, "scaduto", 1);
  await ins("EEE", "trend", "2026-01-05", null, null, null); // aperto
  await falla(ins("AAA", "trend", "2026-01-01", 70, null, null), "segnale duplicato");
  await falla(db.query(`insert into segnali(ticker,tipo,data_segnale,prezzo) values ('x y','trend','2026-01-01',1)`), "ticker non valido");
  await db.query(`insert into backtest_ticker(ticker,tipo,vinti,persi,scaduti) values ('AAA','trend',5,3,2),('BBB','trend',1,1,1),('AAA','ribasso',2,2,0)`);
  const tr = (await come(a2, async () => (await db.query(`select track_record() t`)).rows[0].t));
  assert.equal(tr.chiusi, 4); assert.equal(tr.vinti, 1); assert.equal(tr.persi, 2); assert.equal(tr.scaduti, 1); assert.equal(tr.aperti, 1);
  assert.equal(tr.dal, "2026-01-01");
  assert.equal(tr.calibrazione.length, 2, "due fasce: 20-40 e 60-80");
  const fascia70 = tr.calibrazione.find((x) => x.da === 60); assert.equal(Math.round(fascia70.osservato), 50); assert.equal(fascia70.n, 2);
  const fascia30 = tr.calibrazione.find((x) => x.da === 20); assert.equal(Math.round(fascia30.osservato), 0);
  // Brier: (0.7-1)^2,(0.7-0)^2,(0.3-0)^2,(0.3-0)^2 -> media = (0.09+0.49+0.09+0.09)/4 = 0.19
  assert.ok(Math.abs(tr.brier - 0.19) < 1e-6, "brier " + tr.brier);
  assert.ok(Math.abs(tr.brier_base - 0.1875) < 1e-6, "brier base " + tr.brier_base);
  const ag = await come(a2, async () => (await db.query(`select statistiche_aggregate() t`)).rows[0].t);
  const trend = ag.find((x) => x.tipo === "trend"); assert.equal(trend.titoli, 2); assert.equal(trend.vinti, 6); assert.equal(trend.persi, 4);
  // i client non leggono le tabelle grezze ne' possono scrivere
  await come(a2, async () => {
    assert.equal((await db.query(`select count(*)::int n from segnali`)).rows[0].n, 0);
    assert.equal((await db.query(`select count(*)::int n from backtest_ticker`)).rows[0].n, 0);
    await db.query(`insert into segnali(ticker,tipo,data_segnale,prezzo) values ('HACK','trend','2026-02-01',1)`).then(() => assert.fail("insert consentito"), (e) => assert.ok(!(e instanceof assert.AssertionError)));
  });
  // anon non puo' chiamare le funzioni
  await db.exec(`set role anon`); await falla(db.query(`select track_record()`), "anon vietato"); await db.exec(`reset role`);
  // spread
  assert.equal((await db.query(`select column_default d from information_schema.columns where table_name='impostazioni_rischio' and column_name='spread'`)).rows[0].d, "0.1");
  await falla(db.query(`insert into impostazioni_rischio(user_id,spread) values ($1,9)`, [b]), "spread fuori range");
}


// ---- avvisi email: destinatari, token protetto, disiscrizione ----
{
  const u1 = await nuovo("avv1@x.it", { username: "avviso1" }), u2 = await nuovo("avv2@x.it", { username: "avviso2" }),
        u3 = await nuovo("avv3@x.it", { username: "avviso3" }), u4 = await nuovo("avv4@x.it", { username: "avviso4" });
  for (const u of [u1, u2, u3, u4]) {
    await db.query(`insert into impostazioni_rischio(user_id, avvisi_email, avvisi_consenso_il) values ($1, $2, $3)`,
      [u, u !== u4, u === u3 ? null : new Date().toISOString()]);
    await db.query(`insert into portfolio(user_id,ticker,quantita,prezzo_acquisto) values ($1,'AAPL',1,100),($1,'MSFT',2,50)`, [u]);
    await db.query(`select crea_chiave($1,$2,10,30,null)`, [u, "MA-AVV-" + u.slice(0, 8)]);
  }
  // u1 ok; u2: chiave scaduta; u3: senza consenso (avvisi_email true ma consenso null); u4: avvisi spenti
  await db.query(`update access_keys set scade_il = now() - interval '1 day' where user_id = $1`, [u2]);
  const dd = (await db.query(`select avvisi_destinatari() d`)).rows[0].d;
  assert.equal(dd.length, 1, "solo chi ha consenso, avvisi attivi e chiave valida");
  assert.equal(dd[0].username, "avviso1"); assert.equal(dd[0].posizioni.length, 2); assert.equal(dd[0].posizioni[0].ticker, "AAPL");
  assert.match(dd[0].token, /^[0-9a-f-]{36}$/);
  // senza posizioni: escluso
  await db.query(`delete from portfolio where user_id = $1`, [u1]);
  assert.equal((await db.query(`select jsonb_array_length(avvisi_destinatari()) n`)).rows[0].n, 0);
  await db.query(`insert into portfolio(user_id,ticker,quantita,prezzo_acquisto) values ($1,'AAPL',1,100)`, [u1]);
  // il client non puo' scegliere ne' cambiare il proprio token
  const tok0 = (await db.query(`select avvisi_token t from impostazioni_rischio where user_id=$1`, [u1])).rows[0].t;
  await come(u1, async () => {
    await db.query(`update impostazioni_rischio set avvisi_token = '11111111-1111-1111-1111-111111111111'`);
    await db.query(`insert into impostazioni_rischio(user_id, avvisi_token) values ($1, '22222222-2222-2222-2222-222222222222') on conflict (user_id) do update set avvisi_email = true`, [u1]);
  });
  assert.equal((await db.query(`select avvisi_token t from impostazioni_rischio where user_id=$1`, [u1])).rows[0].t, tok0, "token immutabile");
  const nuovoUtente = await nuovo("avv5@x.it", { username: "avviso5" });
  await come(nuovoUtente, async () => { await db.query(`insert into impostazioni_rischio(user_id, avvisi_token) values ($1, '33333333-3333-3333-3333-333333333333')`, [nuovoUtente]); });
  assert.notEqual((await db.query(`select avvisi_token t from impostazioni_rischio where user_id=$1`, [nuovoUtente])).rows[0].t, "33333333-3333-3333-3333-333333333333", "token scelto dal client ignorato");
  // consenso gestibile dal cliente
  await come(u1, async () => { await db.query(`update impostazioni_rischio set avvisi_email = true, avvisi_consenso_il = now()`); });
  // registro e dedupe
  await db.query(`insert into avvisi_inviati(user_id,ticker,motivo) values ($1,'AAPL','stop_pct')`, [u1]);
  await db.query(`insert into avvisi_inviati(user_id,ticker,motivo,inviato_il) values ($1,'AAPL','stop_atr', now() - interval '10 days')`, [u1]);
  const rc = (await db.query(`select avvisi_recenti() r`)).rows[0].r;
  assert.equal(rc.length, 1, "solo gli ultimi 7 giorni"); assert.equal(rc[0].motivo, "stop_pct");
  await come(u1, async () => { assert.equal((await db.query(`select count(*)::int n from avvisi_inviati`)).rows[0].n, 0); });
  await come(u1, async () => { await falla(db.query(`select avvisi_destinatari()`), "funzione vietata ai client"); });
  await db.exec(`set role anon`); await falla(db.query(`select disattiva_avvisi('11111111-1111-1111-1111-111111111111')`), "anon vietato"); await db.exec(`reset role`);
  // disiscrizione con token
  assert.equal((await db.query(`select disattiva_avvisi($1) v`, [tok0])).rows[0].v, true);
  assert.equal((await db.query(`select avvisi_email v from impostazioni_rischio where user_id=$1`, [u1])).rows[0].v, false);
  assert.equal((await db.query(`select disattiva_avvisi('99999999-9999-9999-9999-999999999999') v`)).rows[0].v, false);
  assert.equal((await db.query(`select jsonb_array_length(avvisi_destinatari()) n`)).rows[0].n, 0);
}

// precaricamento notturno: elenco dei titoli non aggiornati
{
  await db.query(`delete from price_cache`); await db.query(`delete from watchlist`); await db.query(`delete from portfolio`);
  await db.query(`insert into watchlist(user_id,ticker) values ($1,'PRE1'),($1,'PRE2'),($1,'PRE3') on conflict do nothing`, [a]);
  await db.query(`insert into price_cache(ticker,dati,aggiornato_il) values ('PRE1','{"b":[],"v":2}', now())`);   // scaricato dopo l'ultima chiusura: escluso
  await db.query(`insert into price_cache(ticker,dati,aggiornato_il) values ('PRE2','{"b":[],"v":2}', now() - interval '3 days')`); // vecchio
  await db.query(`insert into price_cache(ticker,dati,aggiornato_il) values ('PRE3','{"b":[]}', now() - interval '1 hour')`);         // versione vecchia
  const l = (await db.query(`select ticker from titoli_da_precaricare(50)`)).rows.map((x) => x.ticker);
  assert.ok(l.includes("SPY") && l.includes("PRE2") && l.includes("PRE3") && !l.includes("PRE1"), l.join());
  assert.equal(l.indexOf("SPY"), 0, "mai scaricati per primi");
  assert.equal((await db.query(`select count(*)::int n from titoli_da_precaricare(1)`)).rows[0].n, 1);
  const ex = (await db.query(`select ticker from titoli_da_precaricare(50, array['zzx1','ZZX2','bad ticker!'])`)).rows.map((x) => x.ticker);
  const ordine = (await db.query(`select ticker from titoli_da_precaricare(50, array['AAA1'])`)).rows.map((x) => x.ticker);
  assert.ok(ordine.indexOf("PRE2") < ordine.indexOf("AAA1") && ordine.indexOf("SPY") < ordine.indexOf("AAA1"), "prima i titoli dei clienti: " + ordine.join());
  assert.ok(ex.includes("ZZX1") && ex.includes("ZZX2") && !ex.some((t) => /bad/i.test(t)), "extra dal catalogo: " + ex.join());
  await db.exec(`set role authenticated`); await falla(db.query(`select * from titoli_da_precaricare(5)`), "vietata ai client"); await db.exec(`reset role`);
  await db.query(`delete from watchlist where ticker like 'PRE%'`);
  // registro verdetti
  await db.query(`insert into verdetti_orizzonte(ticker,orizzonte,data_verdetto,prezzo,verdetto,punteggio,data_esito,rendimento) values
    ('V1','breve','2026-01-02',100,'favorevole',3,'2026-02-02',4),('V2','breve','2026-01-02',100,'favorevole',3,'2026-02-02',-1),
    ('V3','breve','2026-01-02',100,'sfavorevole',0,'2026-02-02',-2),('V4','breve','2026-01-02',100,'neutro',2,null,null)`);
  const vc = (await db.query(`select verdetti_conteggi() r`)).rows[0].r;
  const fav = vc.righe.find((x) => x.verdetto === "favorevole");
  assert.equal(fav.n, 2); assert.equal(fav.positivi, 1); assert.equal(vc.aperti.breve, 1);
  await falla(db.query(`insert into verdetti_orizzonte(ticker,orizzonte,data_verdetto,prezzo,verdetto) values ('V1','breve','2026-01-02',1,'neutro')`), "unico per giorno");
  await db.exec(`set role authenticated`); await falla(db.query(`select verdetti_conteggi()`), "vietata ai client"); await db.exec(`reset role`);
  await db.query(`delete from verdetti_orizzonte`);
}

// studio di gruppo: aggregazione nel database
{
  const hist = (...coppie) => { const a = new Array(152).fill(0); for (const [i, v] of coppie) a[i] = v; return JSON.stringify(a); };
  await db.query(`delete from profili_titolo`);
  await db.query(`insert into profili_titolo(ticker,gruppo,orizzonte,profilo,n,indip,pos,hist) values
    ('G1','etf','breve',3,100,10,60,$1), ('G2','etf','breve',3,50,5,20,$2), ('G3','azioni','breve',3,999,99,500,$1), ('G1','etf','medio',1,10,1,5,$1)`, [hist([51, 60], [40, 40]), hist([51, 20], [40, 30])]);
  const r = (await db.query(`select studio_gruppo('etf', '[{"o":"breve","p":3},{"o":"lungo","p":0}]'::jsonb) r`)).rows[0].r;
  const b = r.find((x) => x.o === "breve"), l = r.find((x) => x.o === "lungo");
  assert.equal(b.titoli, 2); assert.equal(b.n, 150); assert.equal(b.indip, 15); assert.equal(b.pos, 80);
  assert.equal(b.hist.length, 152); assert.equal(b.hist[51], 80); assert.equal(b.hist[40], 70); assert.equal(b.hist.reduce((a, x) => a + x, 0), 150, "istogramma sommato");
  assert.equal(l.n, 0); assert.deepEqual(l.hist, [], "profilo senza dati");
  await db.exec(`set role authenticated`); await falla(db.query(`select studio_gruppo('etf','[]'::jsonb)`), "vietata ai client"); await db.exec(`reset role`);
  await falla(db.query(`insert into profili_titolo(ticker,gruppo,orizzonte,profilo,n,indip,pos,hist) values ('X1','boh','breve',1,1,1,1,'[]')`), "gruppo non valido");
  await db.query(`delete from profili_titolo`);
}

// cancellazione utente = cascata
await db.query(`delete from auth.users where id=$1`, [a]);
assert.equal((await db.query(`select count(*)::int n from access_keys where user_id=$1`, [a])).rows[0].n, 0);
console.log("test_schema OK");
