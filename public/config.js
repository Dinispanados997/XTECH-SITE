/* =====================================================================
   XTECH STORE — CONFIGURAÇÃO
   live: true  → o site usa a base de dados Neon (através das funções /api/data e /api/auth).
   live: false → "modo demonstração": tudo fica guardado só neste browser e os
                 pagamentos são simulados (útil para testar sem servidor).
   ===================================================================== */
window.XTECH_CONFIG = {
  live: true,

  // false: o cliente paga por MB WAY ou transferência (dados em Definições da loja) e a loja confirma no painel
  // true:  pagamento online pelo Stripe (precisa da conta Stripe ativada e das chaves reais no Vercel)
  pagamentoOnline: false,

  // Dados da empresa para os Termos e Condições (obrigatórios por lei numa loja online)
  empresa: {
    nomeLegal: '',      // o teu nome completo (empresário em nome individual) ou o nome da sociedade, ex: 'Xtech Store, Lda.'
    nif: '',            // NIF da empresa / atividade
  },
};
