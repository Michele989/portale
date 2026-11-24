import assert from "node:assert/strict";
import { classificaEvidenza, probCalibrata } from "../supabase/functions/_shared/evidenza.ts";
const r = (o) => ({ regola: "forte", orizzonte: 63, pHolm: 1, ci95: [-1, 1], recente: { ci95: [-1, 1] }, ...o });
assert.equal(classificaEvidenza(null).livello, "insufficiente");
assert.equal(classificaEvidenza({ regole: [r({})], realityCheck: { pValore: 0.4 } }).livello, "non_dimostrata");
assert.equal(classificaEvidenza({ regole: [r({ pHolm: 0.01, ci95: [1, 3], recente: { ci95: [0.5, 3] } })], realityCheck: { pValore: 0.01 } }).livello, "dimostrata");
// senza Reality Check superato non e' dimostrata
assert.equal(classificaEvidenza({ regole: [r({ pHolm: 0.01, ci95: [1, 3], recente: { ci95: [0.5, 3] } })], realityCheck: { pValore: 0.5 } }).livello, "non_dimostrata");
assert.equal(classificaEvidenza({ regole: [r({ ci95: [-3, -1], recente: { ci95: [-3, -0.5] } })], realityCheck: null }).livello, "sfavorevole");
assert.equal(probCalibrata({ ricalibrazione: { base_21: { attiva: false } } }, "base", 21, 0.5), null);
assert.ok(Math.abs(probCalibrata({ ricalibrazione: { base_21: { attiva: true, a: 0, b: 0.5 } } }, "base", 21, 0.9) - 0.75) < 0.01);
console.log("test_evidenza OK");
