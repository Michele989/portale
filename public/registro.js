// Pagina "Affidabilità": registro pubblico dei verdetti (dati aggregati, nessun dato personale).
(function () {
  var esc = function (s) { return window.MA.esc(s); }, fmt = function (n, d) { return window.MA.fmt(n, d); };
  var NOMI = { breve: "Breve (1 mese)", medio: "Medio (3 mesi)", lungo: "Lungo (1 anno)" };
  var pc = function (x) { return x === null || x === undefined ? "n/d" : fmt(Number(x), 0) + "%"; };

  function grafico(mesi) {
    var pt = mesi.filter(function (m) { return m.fav_pct !== null || m.sfav_pct !== null; });
    if (pt.length < 2) return '<div class="muted">L\'andamento nel tempo comparirà quando ci saranno almeno due mesi di esiti.</div>';
    var W = 320, H = 120, X = function (i) { return 10 + i / (pt.length - 1) * (W - 20); }, Y = function (v) { return H - 10 - Number(v) / 100 * (H - 20); };
    var linea = function (k, col) {
      var p = pt.map(function (m, i) { return m[k] === null ? null : X(i).toFixed(1) + "," + Y(m[k]).toFixed(1); }).filter(Boolean).join(" ");
      return p ? '<polyline fill="none" stroke="' + col + '" stroke-width="2" points="' + p + '"/>' : "";
    };
    return '<svg viewBox="0 0 ' + W + " " + H + '" class="ventaglio" role="img" aria-label="Percentuale di rialzi nel tempo: verdetti favorevoli contro sfavorevoli">' +
      '<line x1="10" x2="' + (W - 10) + '" y1="' + Y(50) + '" y2="' + Y(50) + '" stroke="var(--line)" stroke-dasharray="3 3"/>' + linea("fav_pct", "var(--buy)") + linea("sfav_pct", "var(--sell)") + "</svg>" +
      '<div class="muted"><span class="ok">━ Favorevoli</span> · <span class="err">━ Sfavorevoli</span> · % di casi in cui il prezzo è salito; mesi: ' + esc(pt[0].mese) + " – " + esc(pt[pt.length - 1].mese) + "</div>";
  }

  function html(d) {
    if (!d || !d.chiusi) return '<div class="vuoto">Il registro è appena iniziato: ' + ((d && d.aperti) || 0) + " verdetti in attesa di esito (servono 1, 3 o 12 mesi a seconda dell'orizzonte). I risultati compariranno qui, buoni o cattivi che siano.</div>";
    var h = '<div class="muted">Dal ' + MA_data(d.dal) + ": <b>" + d.chiusi + "</b> verdetti con esito, " + d.aperti + " ancora aperti.</div>";
    h += '<div class="scroll"><table><thead><tr><th>Orizzonte</th><th>Casi</th><th>Salito in generale</th><th>Dopo «Favorevole»</th><th>Dopo «Neutro»</th><th>Dopo «Sfavorevole»</th></tr></thead><tbody>' +
      d.orizzonti.map(function (o) {
        return "<tr><td>" + esc(NOMI[o.orizzonte] || o.orizzonte) + "</td><td>" + o.n + "</td><td>" + pc(o.base_pct) + "</td><td>" + pc(o.fav_pct) + ' <span class="muted">(' + o.n_fav + ")</span></td><td>" + pc(o.neu_pct) + ' <span class="muted">(' + o.n_neu + ")</span></td><td>" + pc(o.sfav_pct) + ' <span class="muted">(' + o.n_sfav + ")</span></td></tr>";
      }).join("") + "</tbody></table></div>";
    h += '<div class="muted">Se il servizio funziona, dopo «Favorevole» il prezzo sale più spesso che in generale e dopo «Sfavorevole» meno spesso. Tra parentesi il numero di casi: con pochi casi le percentuali ballano molto.</div>';
    h += "<h3>Calibrazione</h3>";
    if (d.calibrazione && d.calibrazione.length) {
      h += '<div class="scroll"><table><thead><tr><th>Probabilità dichiarata</th><th>Casi</th><th>Dichiarato (media)</th><th>Salito davvero</th><th>Scarto</th></tr></thead><tbody>' +
        d.calibrazione.map(function (f) {
          var sc = Number(f.osservato) - Number(f.dichiarato);
          return "<tr><td>" + f.da + "–" + (f.da + 10) + "%</td><td>" + f.n + "</td><td>" + pc(f.dichiarato) + "</td><td>" + pc(f.osservato) + '</td><td class="' + (Math.abs(sc) > 10 ? "err" : "ok") + '">' + (sc > 0 ? "+" : "") + fmt(sc, 0) + " punti</td></tr>";
        }).join("") + "</tbody></table></div>";
    } else h += '<div class="muted">Non ci sono ancora esiti con probabilità dichiarata.</div>';
    if (d.brier !== null && d.brier !== undefined) {
      h += '<div class="muted" style="margin-top:8px">Brier score: <b>' + fmt(Number(d.brier), 3) + "</b> (riferimento «dire sempre la media»: " + fmt(Number(d.brier_base), 3) + "; più basso è meglio). " +
        (Number(d.brier) < Number(d.brier_base) ? "Migliore del riferimento." : "Non migliore del riferimento: le percentuali dichiarate non stanno aggiungendo informazione.") + "</div>";
    }
    h += "<h3>Andamento nel tempo</h3>" + grafico(d.mesi || []);
    return h;
  }
  function MA_data(iso) { return window.MA.data(iso); }
  window.MA_REGISTRO = { html: html };
})();
