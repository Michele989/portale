import assert from "node:assert/strict";
import { stimaGarch, varianzaAttesaMedia, simulaGarch, rendimentiGiornalieri } from "../supabase/functions/_shared/garch.ts";
import { mulberry32 } from "../supabase/functions/_shared/previsioni.ts";

function genera(n, omega, alpha, beta, seed) {
  const rnd = mulberry32(seed); const g = () => { const u = Math.max(rnd(), 1e-12), v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  let s2 = omega / (1 - alpha - beta); const r = [];
  for (let i = 0; i < n; i++) { const e = Math.sqrt(s2) * g(); r.push(0.0004 + e); s2 = omega + alpha * e * e + beta * s2; }
  return r;
}
const vero = { omega: 2e-6, alpha: 0.09, beta: 0.89 };
const r = genera(3000, vero.omega, vero.alpha, vero.beta, 5);
const t0 = Date.now(); const p = stimaGarch(r); const ms = Date.now() - t0;
assert.ok(p, "stima riuscita");
assert.ok(Math.abs(p.alpha - 0.09) < 0.04, "alpha " + p.alpha); assert.ok(Math.abs(p.beta - 0.89) < 0.04, "beta " + p.beta);
assert.ok(p.persistenza < 0.999 && p.persistenza > 0.9);
assert.ok(ms < 1500, "veloce: " + ms + " ms");
console.log("ok stima", p.alpha.toFixed(3), p.beta.toFixed(3), "in", ms, "ms");

// dopo un periodo agitato la varianza attesa e' sopra quella di lungo periodo, poi torna verso la media
const calmo = genera(1500, 2e-6, 0.09, 0.89, 7), agitato = calmo.concat(Array.from({ length: 10 }, (_, i) => (i % 2 ? 0.05 : -0.05)));
const pa = stimaGarch(agitato), pc = stimaGarch(calmo);
assert.ok(pa.sigma2Prossima > pc.sigma2Prossima * 3, "volatilita' alta dopo shock");
assert.ok(varianzaAttesaMedia(pa, 5) > varianzaAttesaMedia(pa, 252), "torna verso la media col tempo");
assert.ok(Math.abs(varianzaAttesaMedia(pa, 100000) - pa.varLungo) / pa.varLungo < 0.05);

// simulazione: dispersione coerente con la volatilita' e riproducibile
const sA = simulaGarch(pa, 21, 2000, mulberry32(1)), sC = simulaGarch(pc, 21, 2000, mulberry32(1));
const sd = (v) => { const m = v.reduce((a, b) => a + b, 0) / v.length; return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length); };
assert.ok(sd(sA) > sd(sC) * 1.5, "piu' agitato = piu' disperso: " + sd(sA) + " vs " + sd(sC));
assert.deepEqual(simulaGarch(pc, 21, 100, mulberry32(3)), simulaGarch(pc, 21, 100, mulberry32(3)));
assert.equal(stimaGarch(r.slice(0, 100)), null, "troppo pochi dati");
assert.equal(stimaGarch(new Array(500).fill(0)), null, "serie piatta");
assert.equal(rendimentiGiornalieri([100, 110, 99]).length, 2);
// la volatilita' simulata a 21 giorni e' vicina a quella teorica sqrt(21)*sigma
const teo = Math.sqrt(21 * pc.varLungo) * 100; assert.ok(sd(sC) > teo * 0.5 && sd(sC) < teo * 2, "scala ragionevole " + sd(sC) + " vs " + teo);
console.log("test_garch OK");
