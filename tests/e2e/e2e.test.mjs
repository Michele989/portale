// Test end-to-end in un browser vero (Chromium): login, lista, analisi, classifica, dettaglio, portafoglio, usi esauriti.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { extname, join } from "node:path";
import { chromium } from "playwright";

const PUB = new URL("../../public/", import.meta.url).pathname, FIX = readFileSync(new URL("./fixture.json", import.meta.url), "utf8"), FALSO = readFileSync(new URL("./falso_supabase.js", import.meta.url), "utf8");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/json" };
const srv = createServer((q, r) => {
  const p = new URL(q.url, "http://x").pathname; const f = join(PUB, p === "/" ? "index.html" : p);
  if (!existsSync(f)) { r.statusCode = 404; return r.end(); }
  let b = readFileSync(f);
  if (p === "/config.js") b = Buffer.from(b.toString().replace("INSERISCI_URL_PROGETTO_SUPABASE", "https://prova.supabase.co").replace("INSERISCI_ANON_KEY_SUPABASE", "k".repeat(40)).replace("PAUSA_MS: 7700", "PAUSA_MS: 0"));
  r.setHeader("content-type", MIME[extname(f)] || "text/plain"); r.end(b);
}).listen(0);
const base = "http://localhost:" + srv.address().port + "/";
const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });

async function pagina(scenario, vista = { width: 1280, height: 900 }, tema = "light") {
  const ctx = await br.newContext({ viewport: vista, colorScheme: tema, serviceWorkers: "block" });
  const pg = await ctx.newPage(); const errori = []; pg.on("pageerror", (e) => errori.push(e.message));
  await pg.route("**/cdn.jsdelivr.net/**", (rt) => rt.fulfill({ contentType: "text/javascript", body: "/* stub */" }));
  await pg.addInitScript("window.__FIXTURE = " + FIX + ";"); await pg.addInitScript(FALSO);
  pg.on("dialog", (d) => d.accept());
  await pg.goto(base + "?scenario=" + scenario);
  return { pg, errori, ctx };
}

try {
  // 1) login, onboarding, lista, analisi, classifica, dettaglio, portafoglio
  {
    const { pg, errori } = await pagina("");
    await pg.fill("#loginEmail", "m@x.it"); await pg.fill("#loginPassword", "sbagliata"); await pg.click("#btnLogin");
    await pg.waitForSelector("#authMsg:has-text('non corretti')");
    await pg.fill("#loginPassword", "password1"); await pg.click("#btnLogin");
    await pg.waitForSelector("#onboarding:not(.hidden)"); assert.match(await pg.textContent("#onbCorpo"), /Passo 1 di 4/);
    await pg.click("#onbSalta"); await pg.waitForSelector("#onboarding", { state: "hidden" });
    await pg.waitForSelector("#numUsi"); assert.equal(await pg.textContent("#numUsi"), "20");
    await pg.waitForSelector("#chips-etf .chip");
    await pg.click("#btnAnalizzaTutto"); await pg.waitForSelector("#progresso:has-text('Completato')", { timeout: 20000 }).catch(async (e) => { console.log("PROG:", await pg.textContent("#progresso"), "WL:", await pg.textContent("#btnAnalizzaTutto")); throw e; });
    const righe = await pg.$$("#boxClassifica .riga[data-t]"); assert.ok(righe.length >= 3, "righe: " + righe.length);
    assert.equal(await pg.textContent("#numUsi"), String(20 - 13));
    // badge cliccabile -> popover con dati reali
    await pg.click("#boxClassifica .riga[data-t] [data-g=verdetto]"); await pg.waitForSelector("#popover:not(.hidden)");
    assert.match(await pg.textContent("#popover"), /Dati considerati[\s\S]*Quanto fidarsi/); await pg.keyboard.press("Escape"); await pg.waitForSelector("#popover", { state: "hidden" });
    // dettaglio a 3 livelli
    await pg.click("#boxClassifica [data-vai]"); await pg.waitForSelector("#pannello:not(.hidden)");
    const tx = await pg.textContent("#pannelloCorpo"); assert.match(tx, /Riassunto[\s\S]*Perché[\s\S]*Per esperti/);
    assert.equal(await pg.$eval("#pannelloCorpo details.esperti", (e) => e.open), false); await pg.keyboard.press("Escape"); await pg.waitForSelector("#pannello", { state: "hidden" });
    // portafoglio
    await pg.click("#menu [data-tab=portafoglio]"); await pg.fill("#posTicker", "SPY"); await pg.fill("#posQta", "2"); await pg.fill("#posPrezzo", "100"); await pg.click("#btnPos");
    await pg.waitForSelector("#tabellaPf:has-text('SPY')"); assert.match(await pg.textContent("#tabellaPf"), /Verdetto oggi/);
    assert.deepEqual(errori, []);
    await pg.context().close();
  }
  // 2) usi esauriti: messaggio chiaro, niente analisi
  {
    const { pg, errori } = await pagina("esauriti");
    await pg.waitForSelector("#boxStato:has-text('Usi esauriti')"); assert.equal(await pg.isDisabled("#btnAnalizzaTutto"), true);
    assert.deepEqual(errori, []); await pg.context().close();
  }
  // 3) mobile scuro: nessuno scroll orizzontale e pannello a tutto schermo
  {
    const { pg, errori } = await pagina("loggato", { width: 390, height: 844 }, "dark");
    await pg.waitForSelector("#onboarding:not(.hidden)"); await pg.click("#onbSalta"); await pg.waitForSelector("#chips-etf .chip");
    await pg.click("#btnAnalizzaTutto"); await pg.waitForSelector("#progresso:has-text('Completato')", { timeout: 20000 }).catch(async (e) => { console.log("PROG:", await pg.textContent("#progresso"), "WL:", await pg.textContent("#btnAnalizzaTutto")); throw e; });
    const larghezza = await pg.evaluate(() => document.documentElement.scrollWidth); assert.ok(larghezza <= 392, "nessuno scroll orizzontale: " + larghezza);
    await pg.click("#boxClassifica [data-vai]"); await pg.waitForSelector("#pannello:not(.hidden)");
    const box = await pg.$eval("#pannello .foglio", (e) => { const r = e.getBoundingClientRect(); return [r.width, r.height]; }); assert.ok(box[0] >= 388, "pannello a tutta larghezza: " + box[0]);
    assert.deepEqual(errori, []); await pg.context().close();
  }
  // 4) pagine pubbliche
  {
    const { pg, errori } = await pagina("");
    for (const f of ["registro.html", "stato.html", "metodo.html", "privacy.html", "termini.html", "cookie.html"]) { await pg.goto(base + f); assert.ok((await pg.textContent("body")).length > 200, f); }
    assert.deepEqual(errori, []); await pg.context().close();
  }
  console.log("e2e OK");
} finally { await br.close(); srv.close(); }
