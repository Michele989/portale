import assert from "node:assert/strict";
import { estraiBilanci, indicatori, valoreA, spreadMensili, fineMesi, testFondamentali, leggiFamaFrench, leggiFred, alfaFattori } from "../supabase/functions/_shared/fondamentali.ts";
import { mulberry32 } from "../supabase/functions/_shared/previsioni.ts";

// 1) estrazione: solo 10-K annuali, prima pubblicazione
const f = (end, start, val, filed, form = "10-K") => ({ start, end, val, filed, form });
const cf = { facts: { "us-gaap": {
  NetIncomeLoss: { units: { USD: [f("2021-12-31", "2021-01-01", 100, "2022-02-20"), f("2021-12-31", "2021-01-01", 90, "2022-06-01"), f("2022-12-31", "2022-01-01", 150, "2023-02-18"), f("2022-03-31", "2022-01-01", 30, "2022-05-01", "10-Q")] } },
  Revenues: { units: { USD: [f("2021-12-31", "2021-01-01", 1000, "2022-02-20"), f("2022-12-31", "2022-01-01", 1200, "2023-02-18")] } },
  StockholdersEquity: { units: { USD: [{ end: "2021-12-31", val: 500, filed: "2022-02-20", form: "10-K" }, { end: "2022-12-31", val: 600, filed: "2023-02-18", form: "10-K" }] } },
  Assets: { units: { USD: [{ end: "2021-12-31", val: 1000, filed: "2022-02-20", form: "10-K" }, { end: "2022-12-31", val: 1000, filed: "2023-02-18", form: "10-K" }] } } } } };
const bil = estraiBilanci(cf);
assert.equal(bil.length, 2); assert.equal(bil[0].utile, 100, "prima pubblicazione, non la rettifica");
const ind = indicatori(bil);
assert.ok(Math.abs(ind[1].crescitaRicavi - 0.2) < 1e-9 && Math.abs(ind[1].roe - 0.25) < 1e-9 && ind[1].crescitaUtile === 0.5);
assert.equal(valoreA(ind, "2023-02-18", "roe"), 0.2, "il giorno stesso della pubblicazione non conta ancora");
assert.equal(valoreA(ind, "2023-02-19", "roe"), 0.25);
assert.equal(valoreA(ind, "2025-01-01", "roe"), null, "bilancio troppo vecchio");
assert.equal(fineMesi("2020-01-15", "2020-04-10").join(), "2020-01-31,2020-02-29,2020-03-31");

// 2) letture file
assert.equal(leggiFamaFrench("x\n202001,1.0,2,3,4,5,0.1\n202002,-1,2,3,4,5,0.1").get("2020-02")[0], -1);
assert.equal(leggiFred("DATE,X\n2020-01-02,1.5\n2020-01-03,.\n").length, 1);

// 3) alfa: dati costruiti con alfa 1 e un fattore
{ const r = mulberry32(3), X = [], y = []; for (let i = 0; i < 120; i++) { const x = (r() - 0.5) * 4; X.push([x]); y.push(1 + 0.5 * x + (r() - 0.5) * 0.5); }
  const a = alfaFattori(y, X); assert.ok(Math.abs(a.alfa - 1) < 0.15 && a.t > 5 && Math.abs(a.betaFattori[0] - 0.5) < 0.1); }

// 4) universo sintetico: indicatore "roe" con effetto piantato / senza effetto
function universo(effetto, seed) {
  const r = mulberry32(seed), g = () => { let s = 0; for (let i = 0; i < 6; i++) s += r(); return (s - 3) * 1.4; };
  const titoli = [];
  for (let k = 0; k < 120; k++) {
    const q = r(); const cron = []; let p = 100;
    const ind = []; for (let y = 2008; y <= 2023; y++) ind.push({ fine: y + "-12-31", pubblicato: (y + 1) + "-02-15", roe: q, roa: r(), margine: r(), margineLordo: r(), crescitaRicavi: r(), crescitaUtile: r(), solidita: r() });
    for (let a = 2008; a <= 2025; a++) for (let m = 1; m <= 12; m++) for (const gg of [1, 10, 20, 28]) {
      p *= 1 + (effetto * (q - 0.5) * 0.0025 + g() * 0.008) / 1; cron.push({ d: `${a}-${String(m).padStart(2, "0")}-${String(gg).padStart(2, "0")}`, c: p });
    }
    titoli.push({ ticker: "T" + k, cron, ind });
  }
  return titoli;
}
const nullo = testFondamentali(universo(0, 5), { B: 500 });
const roeN = nullo.indicatori.find((x) => x.indicatore === "roe");
assert.ok(roeN.mesi > 100, "mesi " + roeN.mesi);
assert.ok(!/Vantaggio dimostrato/.test(nullo.conclusione), "nessun effetto -> nessun vantaggio: " + nullo.conclusione + " " + JSON.stringify(roeN.ci95));
const vero = testFondamentali(universo(1, 6), { B: 500 });
const roeV = vero.indicatori.find((x) => x.indicatore === "roe");
assert.ok(roeV.media > 0 && roeV.ci95[0] > 0 && roeV.pHolm < 0.05, "effetto piantato visto: " + roeV.media + " " + roeV.pHolm);
console.log("test_fondamentali OK | spread nullo", roeN.media.toFixed(2), "| piantato", roeV.media.toFixed(2));
