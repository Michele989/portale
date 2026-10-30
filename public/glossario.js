// Glossario unico di Tickly: ogni etichetta mostrata nell'app ha qui il suo significato in parole semplici,
// i dati reali del titolo considerati e quanto fidarsi. Nessun altro file contiene queste spiegazioni.
(function () {
  var fm = function (x, d) {
    if (x === null || x === undefined || !isFinite(x)) return "n/d";
    d = d === undefined ? 0 : d;
    return (window.MA && window.MA.fmt) ? window.MA.fmt(x, d) : Number(x).toFixed(d).replace(".", ",");
  };
  var sg = function (x, d) { if (x === null || x === undefined || !isFinite(x)) return "n/d"; return (x > 0 ? "+" : "") + fm(x, d); };
  var ok = function (v) { return v === true ? "✓" : v === false ? "✗" : "–"; };

  var VERDETTI = {
    favorevole: { t: "Favorevole", icona: "▲", s: "Il titolo è in una situazione che in passato è stata seguita da rialzi PIÙ spesso del normale, in modo abbastanza netto da non essere solo fortuna." },
    neutro: { t: "Neutro", icona: "●", s: "Nessun vantaggio chiaro rispetto a un giorno qualsiasi: le regole danno segnali misti oppure il vantaggio è troppo piccolo per fidarsi." },
    sfavorevole: { t: "Sfavorevole", icona: "▼", s: "Le regole sono contrarie e/o in passato, in situazioni simili, il prezzo è salito meno spesso del normale." },
    non_valutabile: { t: "Non valutabile", icona: "?", s: "Lo storico è troppo corto o i dati sono insufficienti per dare un giudizio." }
  };

  var VOCI = {
    verdetto: {
      titolo: function (c) { return "Verdetto: " + VERDETTI[c.o.verdetto].t; },
      semplice: function (c) { return VERDETTI[c.o.verdetto].s + " Non è una previsione e non è un consiglio personalizzato."; },
      dati: function (c) {
        var o = c.o, u = c.u, l = [];
        l.push("Criteri soddisfatti: " + o.punteggio + " su 4 (" + o.criteri.map(function (x) { return ok(x.ok); }).join(" ") + ")");
        if (u && u.pPositivi !== null) l.push("Dopo " + o.giorni + " giorni di borsa il prezzo era più alto nel " + fm(u.pPositivi, 0) + "% dei casi simili a oggi");
        if (o.base !== null && o.base !== undefined) l.push("In un periodo qualsiasi della stessa durata: " + fm(o.base, 0) + "%");
        if (o.vantaggioMin !== null && o.vantaggioMin !== undefined) l.push("Estremo inferiore (95%) dei casi simili: " + fm(o.vantaggioMin, 0) + "% — per «favorevole» deve superare il " + fm(o.base, 0) + "% del solito");
        l.push("Modello usato: " + (o.modello === "rimbalzo" ? "Rimbalzo" : "Trend"));
        return l;
      },
      fiducia: function (c) { return "Guarda sempre anche l'affidabilità: un verdetto con affidabilità «bassa» poggia su pochi dati." ; }
    },
    punteggio: {
      titolo: function () { return "Punteggio 0–100"; },
      semplice: function () { return "Un voto unico per mettere i titoli in fila. Più è alto, più i dati storici sono favorevoli e solidi. Non è una probabilità di guadagno."; },
      dati: function (c) { return c.o.scomposizione.map(function (x) { return x.voce + ": " + (x.max ? fm(x.punti, 1) + " su " + x.max : fm(x.punti, 0)); }).concat(["Totale: " + c.o.punteggio100 + " su 100"]); },
      fiducia: function () { return "È una sintesi: apri il dettaglio per vedere cosa lo compone. Con dati incerti il punteggio resta sotto 40."; }
    },
    vantaggio: {
      titolo: function () { return "Vantaggio rispetto al solito"; },
      semplice: function () { return "Quanti punti percentuali in PIÙ (o in meno) di rialzi ci sono stati, dopo giorni come oggi, rispetto a un giorno qualsiasi. Il «solito» è il punto di partenza: molti titoli salgono spesso a prescindere."; },
      dati: function (c) {
        var o = c.o, u = c.u, l = [];
        l.push("Solito (periodo qualsiasi di " + o.giorni + " giorni): salito nel " + fm(o.base, 0) + "% dei casi");
        l.push("Dopo giorni simili a oggi: " + (o.storico.usato === "simili" && u ? fm(u.pPositivi, 0) + "% su " + u.indipendenti + " periodi indipendenti" : "campione troppo piccolo, uso tutto lo storico"));
        l.push("Vantaggio: " + (o.vantaggio === null || o.vantaggio === undefined ? "non calcolabile" : sg(o.vantaggio, 1) + " punti"));
        if (o.pShrink !== null && o.pShrink !== undefined) l.push("Dopo la correzione verso la media del gruppo: " + fm(o.pShrink, 0) + "%");
        l.push("Ultimi 12 mesi: " + (o.oos.esito === "conferma" ? "vantaggio confermato" : o.oos.esito === "non_conferma" ? "vantaggio NON confermato" : "verifica non possibile"));
        return l;
      },
      fiducia: function (c) { return c.o.oos.esito === "conferma" ? "Il vantaggio ha retto anche sugli ultimi 12 mesi, che non erano usati per calcolarlo." : "Un vantaggio piccolo o non confermato negli ultimi 12 mesi può essere solo fortuna."; }
    },
    affidabilita: {
      titolo: function (c) { return "Affidabilità: " + c.o.affidabilita; },
      semplice: function () { return "Quanto sono solidi i dati dietro il verdetto, NON quanto è probabile che il titolo salga. «Alta» è rara: serve molto storico e la conferma sugli ultimi 12 mesi."; },
      dati: function (c) {
        var o = c.o, l = ["Periodi indipendenti nello storico: " + (c.u ? c.u.indipendenti : "n/d") + " (per «alta» ne servono almeno 80)"];
        if (o.ampiezza95 !== null && o.ampiezza95 !== undefined) l.push("Incertezza della percentuale (95%): ± " + fm(o.ampiezza95 / 2, 0) + " punti");
        l.push("Verifica sugli ultimi 12 mesi: " + (o.oos.esito === "conferma" ? "superata" : o.oos.esito === "non_conferma" ? "non superata" : "non disponibile"));
        if (o.fragile === true) l.push("Segnale fragile: cambia se si spostano di poco i parametri");
        return l.concat(o.motivi || []);
      },
      fiducia: function (c) { return c.o.affidabilita === "alta" ? "Dati solidi, ma il futuro resta incerto." : c.o.affidabilita === "media" ? "Utile come indicazione, non come certezza." : "Pochi dati: considera il verdetto solo un'ipotesi."; }
    },
    ipervenduto: {
      titolo: function () { return "Ipervenduto"; },
      semplice: function () { return "Il prezzo è sceso molto e in fretta, sotto la sua media a 50 giorni. In passato a volte ha rimbalzato, a volte ha continuato a scendere."; },
      dati: function (c) { return ["RSI a 14 giorni: " + fm(c.a.rsi, 1) + " (sotto 35 = scesa rapida)", "Distanza dalla media a 50 giorni: " + sg(c.a.distanza, 1) + "%"]; },
      fiducia: function () { return "I rimbalzi sono meno regolari dei trend: guarda l'affidabilità del modello Rimbalzo."; }
    },
    volume: {
      titolo: function () { return "Volume alto"; },
      semplice: function () { return "Oggi sono state scambiate più azioni del solito: il movimento di prezzo è più «sentito» dal mercato."; },
      dati: function (c) { return ["Volume dell'ultima seduta rispetto alla media a 20 giorni: " + (c.a.volume === null || c.a.volume === undefined ? "n/d" : fm(c.a.volume, 2) + " volte")]; },
      fiducia: function () { return "Un solo giorno di volume alto dice poco da solo."; }
    },
    trimestrale: {
      titolo: function () { return "Trimestrale in arrivo"; },
      semplice: function () { return "Entro pochi giorni l'azienda pubblica i conti: il prezzo può muoversi molto, in qualunque direzione, a prescindere dai segnali tecnici."; },
      dati: function () { return ["Per questo l'affidabilità non supera «media» e il punteggio perde 5 punti"]; },
      fiducia: function () { return "Prudenza: i segnali tecnici contano meno prima dei conti."; }
    },
    incerti: {
      titolo: function () { return "Dati incerti"; },
      semplice: function () { return "I prezzi di questo titolo non hanno superato un controllo (anomalie o differenze rispetto a una seconda fonte)."; },
      dati: function () { return ["Affidabilità fissata a «bassa»", "Il titolo non entra tra i primi posti della classifica (punteggio massimo 39)"]; },
      fiducia: function () { return "Non fidarti di questo risultato finché i dati non tornano regolari."; }
    },
    mercato: {
      titolo: function () { return "Mercato debole"; },
      semplice: function () { return "L'indice generale (SPY) è sotto la sua media a 200 giorni. Quando il mercato è debole, i titoli in trend rialzista falliscono più spesso."; },
      dati: function () { return ["I verdetti «favorevole» basati sul trend diventano «neutro»", "Il punteggio perde 10 punti"]; },
      fiducia: function () { return "È una regola di prudenza basata su molti anni di dati, non una previsione del mercato."; }
    },
    fragile: {
      titolo: function () { return "Segnale fragile"; },
      semplice: function () { return "Il segnale cambia se si spostano di poco i parametri (media a 45 o 55 giorni invece di 50, RSI 30 o 40 invece di 35). Un segnale vero non dovrebbe dipendere da un numero preciso."; },
      dati: function () { return ["L'affidabilità scende di un livello", "Il punteggio perde 8 punti"]; },
      fiducia: function () { return "Considera il verdetto con molta cautela."; }
    },
    confermato: {
      titolo: function () { return "Confermato 3 giorni"; },
      semplice: function () { return "Il segnale di trend è presente da almeno tre sedute di fila, non da un solo giorno."; },
      dati: function (c) { return ["Stato del titolo: " + c.a.stato]; },
      fiducia: function () { return "Riduce i falsi allarmi, non li elimina."; }
    }
  };

  var G = {
    verdetti: VERDETTI,
    voci: VOCI,
    // HTML del popover per una voce, con i dati reali del titolo (c = { a, o, u })
    popover: function (chiave, c, esc) {
      var v = VOCI[chiave]; if (!v) return "";
      esc = esc || function (x) { return String(x).replace(/[&<>"']/g, function (m) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]; }); };
      var righe = (v.dati ? v.dati(c) : []).map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("");
      return "<h4>" + esc(v.titolo(c)) + "</h4><p>" + esc(v.semplice(c)) + "</p>" +
        (righe ? "<b>Dati considerati per " + esc(c.a.ticker) + "</b><ul>" + righe + "</ul>" : "") +
        "<b>Quanto fidarsi</b><p>" + esc(v.fiducia(c)) + "</p>";
    },
    // Legenda generale (sempre consultabile): senza dati di un titolo specifico
    legenda: function (esc) {
      esc = esc || function (x) { return String(x); };
      var gen = {
        verdetto: "Il giudizio sintetico: Favorevole, Neutro, Sfavorevole o Non valutabile.",
        punteggio: VOCI.punteggio.semplice({}),
        vantaggio: VOCI.vantaggio.semplice({}),
        affidabilita: VOCI.affidabilita.semplice({}),
        ipervenduto: VOCI.ipervenduto.semplice({}), volume: VOCI.volume.semplice({}), trimestrale: VOCI.trimestrale.semplice({}),
        incerti: VOCI.incerti.semplice({}), mercato: VOCI.mercato.semplice({}), fragile: VOCI.fragile.semplice({}), confermato: VOCI.confermato.semplice({})
      };
      var nomi = { verdetto: "Verdetto", punteggio: "Punteggio 0–100", vantaggio: "Vantaggio sul solito", affidabilita: "Affidabilità", ipervenduto: "Ipervenduto", volume: "Volume alto", trimestrale: "Trimestrale in arrivo", incerti: "Dati incerti", mercato: "Mercato debole", fragile: "Segnale fragile", confermato: "Confermato 3 giorni" };
      return Object.keys(gen).map(function (k) { return "<dt>" + esc(nomi[k]) + "</dt><dd>" + esc(gen[k]) + "</dd>"; }).join("");
    }
  };
  if (typeof window !== "undefined") window.MA_GLOSS = G;
  if (typeof module !== "undefined") module.exports = G;
})();
