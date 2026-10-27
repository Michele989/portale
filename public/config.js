// =========================================================================
// CONFIGURAZIONE - compila SOLO questo file prima di pubblicare il sito.
// (La anon key di Supabase e' pensata per essere pubblica: va bene qui.
//  NON inserire MAI la service_role key ne' la chiave Twelve Data.)
// =========================================================================
window.CONFIG = {
  // Supabase > Project Settings > API
  SUPABASE_URL: "INSERISCI_URL_PROGETTO_SUPABASE",
  SUPABASE_ANON_KEY: "INSERISCI_ANON_KEY_SUPABASE",

  // Dati mostrati nel sito e nelle pagine legali
  NOME_SERVIZIO: "Tickly",
  TITOLARE: "INSERISCI NOME E COGNOME (titolare del trattamento)",
  EMAIL_CONTATTO: "INSERISCI_EMAIL_DI_CONTATTO",
  CONTATTO_ADMIN: "INSERISCI il tuo contatto (es. WhatsApp o email) per richiedere le chiavi",
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
