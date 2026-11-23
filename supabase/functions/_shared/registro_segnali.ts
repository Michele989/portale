// Registro dei segnali reali e conteggi per le statistiche aggregate.
// Chiamato sia da "analizza" (quando un cliente analizza un titolo) sia da "precarica" (ogni notte,
// su tutto l'universo): cosi' il registro non dipende da cosa guardano gli utenti.
// Un segnale si registra solo il PRIMO giorno in cui il titolo entra nello stato (non ogni giorno che ci resta).
import { statisticheStandard, valutaSegnale } from "./analisi.ts";
import type { Barra } from "./analisi.ts";
import { serieStati } from "./previsioni.ts";

export async function aggiornaRegistro(sb: any, ticker: string, barre: Barra[], qualitaGravi: boolean): Promise<void> {
  try {
    if (qualitaGravi) return; // dati dubbi: nulla viene registrato
    const st = statisticheStandard(barre);
    const ora = new Date().toISOString();
    await sb.from("backtest_ticker").upsert([
      { ticker, tipo: "trend", vinti: st.trend.vinti, persi: st.trend.persi, scaduti: st.trend.scaduti, rend_somma: (st.trend.attesa ?? 0) * st.trend.n, caso_n: st.caso.n, caso_vinti: st.caso.vinti, caso_rend_somma: (st.caso.attesa ?? 0) * st.caso.n, aggiornato_il: ora },
      { ticker, tipo: "ribasso", vinti: st.ribasso.vinti, persi: st.ribasso.persi, scaduti: st.ribasso.scaduti, rend_somma: (st.ribasso.attesa ?? 0) * st.ribasso.n, caso_n: st.caso.n, caso_vinti: st.caso.vinti, caso_rend_somma: (st.caso.attesa ?? 0) * st.caso.n, aggiornato_il: ora },
    ], { onConflict: "ticker,tipo" });
    const { data: aperti } = await sb.from("segnali").select("id, data_segnale").eq("ticker", ticker).is("esito", null);
    for (const sg of aperti || []) {
      const r = valutaSegnale(barre, sg.data_segnale);
      if (r) await sb.from("segnali").update({ esito: r.esito, data_esito: r.data_esito, giorni: r.giorni, rendimento: r.rendimento }).eq("id", sg.id);
    }
    const cron = barre.slice().reverse();
    const stati = serieStati(cron);
    const i = cron.length - 1;
    const stato = stati[i];
    if ((stato === "forte" || stato === "ipervenduto") && stati[i - 1] !== stato) {
      const tipo = stato === "forte" ? "trend" : "ribasso";
      const stat = tipo === "trend" ? st.trend : st.ribasso;
      await sb.from("segnali").upsert(
        { ticker, tipo, data_segnale: cron[i].d, prezzo: cron[i].c, p_prevista: stat.n >= 10 ? stat.pct : null, n_storico: stat.n },
        { onConflict: "ticker,tipo,data_segnale", ignoreDuplicates: true },
      );
    }
  } catch (_e) { /* il registro non deve mai far fallire l'analisi */ }
}
