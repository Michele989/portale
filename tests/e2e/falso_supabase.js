// Supabase finto che gira nel browser (solo per i test e2e): memoria + fixture delle analisi.
(function () {
  var P = new URLSearchParams(location.search), SC = P.get("scenario") || "";
  var db = { profiles: [{ user_id: "u1", username: "mario", email: "m@x.it" }], admins: [], watchlist: [], portfolio: [], impostazioni_rischio: [],
    access_keys: [{ id: 1, user_id: "u1", stato: "attiva", usi_totali: 20, usi_rimasti: SC === "esauriti" ? 0 : 20, scade_il: null }] };
  var sessione = SC === "loggato" || SC === "esauriti" ? { access_token: "t", user: { id: "u1", email: "m@x.it" } } : null, ascolti = [];
  function tab(nome) {
    var filtri = [], op = "select", payload, lim, ord;
    function righe() { return db[nome].filter(function (r) { return filtri.every(function (f) { return Array.isArray(f[1]) ? f[1].indexOf(r[f[0]]) >= 0 : r[f[0]] === f[1]; }); }); }
    function esegui(singolo) {
      if (op === "select") { var r = righe().map(function (x) { return Object.assign({}, x); }); if (lim) r = r.slice(0, lim); return Promise.resolve(singolo ? { data: r[0] || null, error: null } : { data: r, error: null }); }
      if (op === "delete") { db[nome] = db[nome].filter(function (r) { return righe().indexOf(r) < 0; }); return Promise.resolve({ error: null }); }
      (Array.isArray(payload) ? payload : [payload]).forEach(function (n) {
        var es = nome === "impostazioni_rischio" ? db[nome].filter(function (r) { return r.user_id === n.user_id; })[0] : (nome === "watchlist" || nome === "portfolio") ? db[nome].filter(function (r) { return r.user_id === n.user_id && r.ticker === n.ticker; })[0] : null;
        if (es) Object.assign(es, n); else db[nome].push(Object.assign({ id: db[nome].length + 1 }, n));
      });
      return Promise.resolve({ error: null });
    }
    var api = { select: function () { return api; }, eq: function (c, v) { filtri.push([c, v]); return api; }, in: function (c, v) { filtri.push([c, v]); return api; },
      order: function () { return api; }, limit: function (n) { lim = n; return api; }, insert: function (p) { op = "insert"; payload = p; return api; },
      upsert: function (p) { op = "upsert"; payload = p; return api; }, delete: function () { op = "delete"; return api; },
      maybeSingle: function () { return esegui(true); }, then: function (a, b) { return esegui(false).then(a, b); } };
    return api;
  }
  window.supabase = { createClient: function () { return {
    auth: {
      getSession: function () { return Promise.resolve({ data: { session: sessione } }); },
      signInWithPassword: function (x) { if (x.password !== "password1") return Promise.resolve({ error: { message: "x" } }); sessione = { access_token: "t", user: { id: "u1", email: x.email } }; return Promise.resolve({ data: { session: sessione }, error: null }); },
      signOut: function () { sessione = null; ascolti.forEach(function (f) { f("SIGNED_OUT"); }); return Promise.resolve({}); },
      onAuthStateChange: function (f) { ascolti.push(f); return { data: {} }; }, resetPasswordForEmail: function () { return Promise.resolve({ error: null }); }, updateUser: function () { return Promise.resolve({ error: null }); }, signUp: function () { return Promise.resolve({ error: { message: "no" } }); } },
    rpc: function (n) { if (n === "registro_pubblico") return Promise.resolve({ data: { chiusi: 0, aperti: 4 } }); return Promise.resolve({ data: n === "username_disponibile" ? true : null }); },
    from: tab }; } };
  window.fetch = function (url, init) {
    var body = {}; try { body = JSON.parse(init.body); } catch (e) { /* vuoto */ }
    var J = function (o, st) { return Promise.resolve({ status: st || 200, ok: (st || 200) < 400, json: function () { return Promise.resolve(o); } }); };
    if (String(url).indexOf("/functions/v1/analizza") < 0) return J({}, 404);
    var k = db.access_keys[0];
    if (k.usi_rimasti <= 0) return J({ ok: false, codice: "USI_ESAURITI", errore: "Hai esaurito gli usi. Contatta l'amministratore per ricaricare." }, 403);
    var f = window.__FIXTURE[body.ticker] || (/^[A-Z]{1,5}$/.test(body.ticker) && body.ticker !== "ZZZZ" ? Object.assign({}, window.__FIXTURE.SPY, { ticker: body.ticker }) : null); if (!f) return J({ ok: false, codice: "TICKER_NON_TROVATO", errore: "Ticker non trovato: " + body.ticker, usi_rimasti: k.usi_rimasti }, 404);
    k.usi_rimasti--; return J(Object.assign({}, f, { usi_rimasti: k.usi_rimasti }));
  };
})();
