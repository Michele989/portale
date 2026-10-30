// Sorveglianza del servizio: avvisa l'amministratore se il job notturno non gira o se un modello e' mal calibrato.
export function jobInRitardo(ultimaRunIso: string | null, adesso: Date, sogliaOre = 30): boolean {
  const g = adesso.getUTCDay(); // 0 = domenica, 6 = sabato: il weekend i mercati sono chiusi
  if (g === 0 || g === 6 || g === 1) return false; // il lunedi' mattina l'ultima run utile e' di venerdi'
  if (!ultimaRunIso) return true;
  return (adesso.getTime() - new Date(ultimaRunIso).getTime()) / 3.6e6 > sogliaOre;
}

export interface RigaReport {
  modello: string; orizzonte: string; versione: string | null; n: number; fav_n: number;
  fav_dichiarato: number | null; fav_osservato: number | null; base: number | null; vantaggio: number | null; brier: number | null;
}
export function testoReport(righe: RigaReport[], mese: string, declassati: { modello: string; orizzonte: string }[]): { oggetto: string; testo: string } {
  const f = (x: number | null, dec = 1) => (x === null || x === undefined ? "n.d." : Number(x).toFixed(dec));
  const l = [
    "Report mensile Tickly - " + mese, "",
    righe.length ? "Modello / orizzonte: casi chiusi, favorevoli, dichiarato -> osservato, solito, vantaggio, Brier" : "Nessun esito chiuso nel mese.",
    ...righe.map((r) => "- " + r.modello + " " + r.orizzonte + (r.versione ? " (v" + r.versione + ")" : "") + ": " + r.n + " casi, " + r.fav_n + " favorevoli, " +
      f(r.fav_dichiarato) + "% -> " + f(r.fav_osservato) + "%, solito " + f(r.base) + "%, vantaggio " + f(r.vantaggio) + " punti, Brier " + f(r.brier, 3)),
    "", declassati.length ? "Modelli declassati: " + declassati.map((d) => d.modello + "/" + d.orizzonte).join(", ") : "Nessun modello declassato.",
    "", "Nota: i dati sono limitati; un mese non basta per giudicare. Guarda l'andamento su 3-6 mesi.",
  ];
  return { oggetto: "Tickly - report mensile " + mese, testo: l.join("\n") };
}
