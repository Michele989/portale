// Collauda lo smoke test contro un finto sito/Supabase locale (successo e fallimento).
import assert from "node:assert/strict";
import http from "node:http";
import { spawnSync } from "node:child_process";

function avvia({ analisiOk = true, scalo = true, adminAperto = false } = {}) {
  let usi = 10;
  const srv = http.createServer((req, res) => {
    let corpo = ""; req.on("data", (c) => (corpo += c)); req.on("end", () => {
      const j = (st, o) => { res.writeHead(st, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };
      const auth = req.headers.authorization === "Bearer TOK";
      const u = req.url;
      if (u.startsWith("/site/")) { res.writeHead(200); return res.end(u.endsWith("config.js") ? "window.CONFIG={}" : "<html></html>"); }
      if (u.startsWith("/auth/v1/token")) return j(200, { access_token: "TOK" });
      if (u.startsWith("/rest/v1/profiles")) return j(200, [{ username: "prova" }]);
      if (u.startsWith("/rest/v1/access_keys")) return j(200, [{ usi_rimasti: usi, stato: "attiva" }]);
      if (u.startsWith("/rest/v1/rpc/track_record")) return j(200, { chiusi: 0 });
      if (u.startsWith("/rest/v1/segnali")) return j(200, []);
      if (u.startsWith("/functions/v1/analizza")) {
        if (!auth) return j(401, { ok: false });
        if (!analisiOk) return j(502, { ok: false, errore: "dati" });
        if (scalo) usi--;
        return j(200, { ok: true, prezzo: 100, giorniStorico: 1300, backtest: { n: 12 }, usi_rimasti: usi });
      }
      if (u.startsWith("/functions/v1/avvisi")) return j(401, { ok: false });
      if (u.startsWith("/functions/v1/disiscrivi")) return j(400, { ok: false });
      if (u.startsWith("/functions/v1/admin")) return adminAperto ? j(200, { ok: true }) : j(403, { ok: false });
      j(404, {});
    });
  });
  return new Promise((r) => srv.listen(0, () => r(srv)));
}
async function lancia(opz) {
  const srv = await avvia(opz), p = srv.address().port, base = "http://127.0.0.1:" + p;
  const r = await new Promise((ok) => {
    import("node:child_process").then(({ spawn }) => {
      const c = spawn(process.execPath, ["smoke_live.mjs"], { env: { ...process.env, SITE_URL: base + "/site", SUPABASE_URL: base, SUPABASE_ANON_KEY: "k".repeat(30), SMOKE_EMAIL: "a@b.it", SMOKE_PASSWORD: "x" } });
      let out = ""; c.stdout.on("data", (d) => (out += d)); c.stderr.on("data", (d) => (out += d));
      c.on("close", (code) => ok({ code, out }));
    });
  });
  srv.close(); return r;
}
let r = await lancia({}); assert.equal(r.code, 0, r.out); assert.match(r.out, /Tutti i controlli superati/);
r = await lancia({ analisiOk: false }); assert.equal(r.code, 1, "analisi fallita => exit 1"); assert.match(r.out, /FALLITO analisi/);
r = await lancia({ scalo: false }); assert.equal(r.code, 1); assert.match(r.out, /FALLITO usi scalati/);
r = await lancia({ adminAperto: true }); assert.equal(r.code, 1); assert.match(r.out, /FALLITO pannello admin/);
const m = spawnSync(process.execPath, ["smoke_live.mjs"], { env: { PATH: process.env.PATH }, encoding: "utf8" }); assert.equal(m.status, 2);
console.log("test_smoke OK");
