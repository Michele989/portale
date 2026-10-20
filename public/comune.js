// Funzioni condivise da index.html e admin.html
(function () {
  var C = window.CONFIG;
  var MA = {
    C: C,
    sb: null,
    configurato: function () {
      return /^https?:\/\//.test(C.SUPABASE_URL) && String(C.SUPABASE_ANON_KEY).length > 20;
    },
    init: function () {
      this.sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY);
      return this.sb;
    },
    esc: function (s) {
      return String(s === null || s === undefined ? "" : s).replace(/[&<>"']/g, function (c) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
      });
    },
    fmt: function (n, d) {
      if (n === null || n === undefined || !isFinite(n)) return "n/d";
      return Number(n).toLocaleString("it-IT", { minimumFractionDigits: d === undefined ? 2 : d, maximumFractionDigits: d === undefined ? 2 : d });
    },
    data: function (iso, conOra) {
      if (!iso) return "—";
      var d = new Date(iso);
      if (isNaN(d.getTime())) return "—";
      return conOra ? d.toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" }) : d.toLocaleDateString("it-IT");
    },
    attendi: function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); },
    // Chiama una Edge Function con il token dell'utente
    chiama: async function (nome, body) {
      try {
        var s = await this.sb.auth.getSession();
        var sessione = s && s.data && s.data.session;
        if (!sessione) return { ok: false, codice: "NON_AUTENTICATO", errore: "Sessione scaduta: accedi di nuovo." };
        var r = await fetch(C.SUPABASE_URL + "/functions/v1/" + nome, {
          method: "POST",
          headers: { Authorization: "Bearer " + sessione.access_token, apikey: C.SUPABASE_ANON_KEY, "Content-Type": "application/json" },
          body: JSON.stringify(body || {})
        });
        var j;
        try { j = await r.json(); } catch (e) { j = { ok: false, errore: "Risposta non valida dal server." }; }
        j.http = r.status;
        return j;
      } catch (e) {
        return { ok: false, codice: "RETE", errore: "Connessione assente o server non raggiungibile." };
      }
    },
    copia: async function (testo) {
      try { await navigator.clipboard.writeText(testo); return true; } catch (e) { return false; }
    }
  };
  window.MA = MA;
})();
