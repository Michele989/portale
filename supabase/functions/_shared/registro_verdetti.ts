// Registro automatico dei verdetti per orizzonte: ogni notte salva il verdetto di ogni titolo
// e, quando e' passato l'orizzonte (21/63/252 giorni di borsa), registra cosa e' successo davvero.
import type { Barra } from "./analisi.ts";
import { controllaDati } from "./analisi.ts";
import { analizzaOrizzonti, ORIZZONTI } from "./orizzonti.ts";
import type { NomeOrizzonte } from "./orizzonti.ts";

export interface RigaVerdetto {
  ticker: string; orizzonte: NomeOrizzonte; data_verdetto: string; prezzo: number; verdetto: string; punteggio: number;
}
export interface RigaAperta { id: number; orizzonte: NomeOrizzonte; data_verdetto: string }
export interface Chiusura { id: number; data_esito: string; rendimento: number }

// recenti = barre dal piu' recente (come in cache). aperti = verdetti non ancora chiusi del titolo.
export function elaboraVerdetti(
  ticker: string, recenti: Barra[], aperti: RigaAperta[], oggi: Date = new Date(),
): { nuovi: RigaVerdetto[]; chiusure: Chiusura[] } {
  const cron = recenti.slice().reverse();
  const nuovi: RigaVerdetto[] = [];
  const chiusure: Chiusura[] = [];
  if (cron.length < 60) return { nuovi, chiusure };
  // chiusure: servono almeno "giorni" sedute dopo la data del verdetto
  for (const a of aperti) {
    const g = ORIZZONTI[a.orizzonte] && ORIZZONTI[a.orizzonte].giorni;
    if (!g) continue;
    const i = cron.findIndex((b) => b.d === a.data_verdetto);
    if (i < 0 || i + g > cron.length - 1) continue;
    const fine = cron[i + g];
    chiusure.push({ id: a.id, data_esito: fine.d, rendimento: (fine.c / cron[i].c - 1) * 100 });
  }
  // nuovo verdetto solo con dati aggiornati e senza anomalie gravi
  const q = controllaDati(recenti, oggi);
  if (!q.gravi) {
    const ultima = cron[cron.length - 1];
    const studio = analizzaOrizzonti(cron, { datiOk: true });
    for (const nome of Object.keys(ORIZZONTI) as NomeOrizzonte[]) {
      const s = studio[nome];
      if (!s || s.verdetto === "non_valutabile") continue;
      nuovi.push({ ticker, orizzonte: nome, data_verdetto: ultima.d, prezzo: ultima.c, verdetto: s.verdetto, punteggio: s.punteggio });
    }
  }
  return { nuovi, chiusure };
}

// Intervallo di Wilson al 95% per una proporzione (in %)
export function wilson(k: number, n: number): [number, number] | null {
  if (n <= 0) return null;
  const z = 1.96, p = k / n, d = 1 + z * z / n;
  const c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [Math.max(0, (c - m) / d) * 100, Math.min(1, (c + m) / d) * 100];
}

export interface RigaConteggio { orizzonte: string; verdetto: string; n: number; positivi: number; rend_medio: number | null }

// Riepilogo per il pannello admin: % di casi in cui l'esito e' andato come dice il verdetto, contro il caso.
export function riepilogoVerdetti(righe: RigaConteggio[], aperti: Record<string, number>) {
  const out: any[] = [];
  for (const nome of Object.keys(ORIZZONTI)) {
    const r = righe.filter((x) => x.orizzonte === nome);
    const tot = r.reduce((s, x) => s + x.n, 0), pos = r.reduce((s, x) => s + x.positivi, 0);
    const base = tot ? pos / tot * 100 : null;
    const riga = (verd: string) => {
      const x = r.find((y) => y.verdetto === verd);
      if (!x || !x.n) return { n: 0, azzeccati: null, pct: null, ic: null, rend_medio: null };
      const az = verd === "favorevole" ? x.positivi : x.n - x.positivi; // sfavorevole: azzeccato se il prezzo non sale
      return { n: x.n, azzeccati: az, pct: az / x.n * 100, ic: wilson(az, x.n), rend_medio: x.rend_medio };
    };
    out.push({
      orizzonte: nome, chiusi: tot, aperti: aperti[nome] || 0, base_positivi: base,
      favorevole: riga("favorevole"), sfavorevole: riga("sfavorevole"), neutro: riga("neutro"),
    });
  }
  return out;
}
