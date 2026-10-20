// =========================================================================
// CONFIGURAZIONE - compila SOLO questo file prima di pubblicare il sito.
// (La anon key di Supabase e' pensata per essere pubblica: va bene qui.
//  NON inserire MAI la service_role key ne' la chiave Twelve Data.)
// =========================================================================
window.CONFIG = {
  // Supabase > Project Settings > API
  SUPABASE_URL: "https://bwrjriwjfzzvreiuwlni.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ3cmpyaXdqZnp6dnJlaXV3bG5pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA5NTk2ODEsImV4cCI6MjEwNjUzNTY4MX0.EWcNZRIlIUh6UXoWZ-vWfU-v2yqo73pwe9vwNJRDI54",

  // Dati mostrati nel sito e nelle pagine legali
  NOME_SERVIZIO: "Monitor Azioni & ETF",
  TITOLARE: "Michele De Rosa",
  EMAIL_CONTATTO: "michele1198@live.it",
  CONTATTO_ADMIN: "Email michele1198@live.it",
  ULTIMO_AGGIORNAMENTO_LEGALE: "09/10/2026",

  // Pausa (ms) dopo ogni titolo scaricato "fresco": il piano gratuito Twelve Data
  // consente 8 richieste al minuto. Con un piano a pagamento puoi mettere 0.
  PAUSA_MS: 7700,

  // Listini proposti (usati dal pannello admin come scorciatoie e dal foglio istruzioni)
  PIANI: [
    { nome: "Prova",  usi: 20,   giorni: 7,  prezzo: "gratis" },
    { nome: "Base",   usi: 150,  giorni: 30, prezzo: "5,90 €" },
    { nome: "Plus",   usi: 450,  giorni: 30, prezzo: "12,90 €" },
    { nome: "Pro",    usi: 1200, giorni: 30, prezzo: "24,90 €" }
  ],
  RICARICA: { usi: 100, prezzo: "3,90 €" }
};
