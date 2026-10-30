// Livello "fornitore dati": tutto cio' che dipende dal servizio esterno sta qui, cosi' cambiare fornitore
// (o aggiungerne uno) non tocca il resto del codice. Funzioni pure o con fetch iniettabile: testabili.
import type { Barra } from "./analisi.ts";
import { ErroreServizio } from "./dati.ts";

export interface FornitoreDati {
  nome: string;
  // barre dalla piu' recente alla piu' vecchia (come nella cache); null = non disponibile per questo titolo
  serie: (ticker: string) => Promise<Barra[] | null>;
}

// Riprova con attesa crescente (0,5s, 1s, 2s...) solo per errori TEMPORANEI. I limiti di richieste
// (al minuto/al giorno) e gli errori definitivi non si riprovano: lo gestisce il chiamante.
const TEMPORANEI = ["ERRORE_DATI"];
export async function conRetry<T>(
  fn: () => Promise<T>, opz: { tentativi?: number; baseMs?: number; attendi?: (ms: number) => Promise<void> } = {},
): Promise<T> {
  const max = opz.tentativi ?? 3, base = opz.baseMs ?? 500;
  const attendi = opz.attendi ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let ultimo: unknown;
  for (let i = 0; i < max; i++) {
    try { return await fn(); } catch (e) {
      ultimo = e;
      if (!(e instanceof ErroreServizio) || !TEMPORANEI.includes(e.codice) || i === max - 1) throw e;
      await attendi(base * 2 ** i);
    }
  }
  throw ultimo;
}

// Seconda fonte per il controllo incrociato: Stooq (CSV gratuito, senza chiave). Solo titoli USA senza suffisso.
export function simboloStooq(ticker: string): string | null {
  if (!/^[A-Z0-9-]{1,8}$/.test(ticker)) return null;
  return ticker.toLowerCase().replace(/-/g, "-") + ".us";
}
export function leggiCsvStooq(csv: string): Barra[] | null {
  const righe = csv.trim().split(/\r?\n/);
  if (righe.length < 3 || !/^date,open,high,low,close/i.test(righe[0])) return null;
  const out: Barra[] = [];
  for (const r of righe.slice(1)) {
    const [d, o, h, l, c, v] = r.split(",");
    const cc = Number(c), hh = Number(h), ll = Number(l);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !(cc > 0)) continue;
    out.push({ d, h: hh > 0 ? hh : cc, l: ll > 0 ? ll : cc, c: cc, v: Number(v) || 0 });
  }
  return out.length ? out.reverse() : null; // piu' recente per prima
}
export function stooq(fetchFn: typeof fetch = fetch): FornitoreDati {
  return {
    nome: "stooq",
    serie: async (ticker) => {
      const s = simboloStooq(ticker);
      if (!s) return null;
      try {
        const r = await fetchFn("https://stooq.com/q/d/l/?s=" + encodeURIComponent(s) + "&i=d", { signal: AbortSignal.timeout(15000) });
        if (!r.ok) return null;
        return leggiCsvStooq(await r.text());
      } catch (_e) { return null; }
    },
  };
}

export type EsitoIncrocio = "ok" | "incerto" | "non_disponibile";
// Confronta le ultime chiusure comuni (fino a 3 date) delle due fonti. Differenza > tolleranza (2%) su una
// qualsiasi di esse = "incerto". Se le date in comune sono meno di 1, il controllo non e' possibile.
export function confrontaFonti(principale: Barra[], seconda: Barra[] | null, tolleranza = 0.02): EsitoIncrocio {
  if (!seconda || !seconda.length) return "non_disponibile";
  const mappa = new Map(seconda.map((b) => [b.d, b.c]));
  let confrontate = 0;
  for (const b of principale.slice(0, 8)) {
    const c2 = mappa.get(b.d);
    if (c2 === undefined) continue;
    confrontate++;
    if (Math.abs(b.c / c2 - 1) > tolleranza) return "incerto";
    if (confrontate >= 3) break;
  }
  return confrontate ? "ok" : "non_disponibile";
}

// Mercato "debole": l'indice di riferimento (SPY) chiude sotto la sua media a 200 giorni.
export function mercatoDebole(spyRecenti: Barra[] | null): boolean {
  if (!spyRecenti || spyRecenti.length < 200) return false;
  const m = spyRecenti.slice(0, 200).reduce((a, b) => a + b.c, 0) / 200;
  return spyRecenti[0].c < m;
}
