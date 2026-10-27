/* Tema chiaro / scuro / automatico (si ricorda la scelta su questo dispositivo) */
(function () {
  var K = "ma_tema", root = document.documentElement;
  function leggi() { try { return localStorage.getItem(K) || "auto"; } catch (e) { return "auto"; } }
  function scrivi(v) { try { localStorage.setItem(K, v); } catch (e) {} }
  function applica(v) {
    if (v === "light" || v === "dark") root.setAttribute("data-theme", v); else root.removeAttribute("data-theme");
    var scuro = v === "dark" || (v === "auto" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute("content", scuro ? "#0a0d14" : "#f5f6fa");
  }
  var NOMI = { auto: "Auto", light: "Chiaro", dark: "Scuro" }, ORDINE = ["auto", "light", "dark"];
  var corrente = leggi();
  applica(corrente);
  document.addEventListener("DOMContentLoaded", function () {
    var h = document.querySelector("header.top");
    if (!h) return;
    var b = document.createElement("button");
    b.type = "button"; b.id = "btnTema"; b.className = "sec piccolo tema";
    function testo() { b.textContent = "Tema: " + NOMI[corrente]; b.setAttribute("aria-label", "Cambia tema. Attuale: " + NOMI[corrente]); }
    testo();
    b.onclick = function () { corrente = ORDINE[(ORDINE.indexOf(corrente) + 1) % 3]; scrivi(corrente); applica(corrente); testo(); };
    h.appendChild(b);
  });
})();
