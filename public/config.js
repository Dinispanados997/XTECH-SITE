/* =====================================================================
   XTECH STORE — CONFIGURAÇÃO
   Preenche estes 2 valores com os dados do teu projeto Supabase
   (Supabase → Project Settings → API).  Ver GUIA-INSTALACAO.md, passo 2.

   Enquanto estiverem vazios, o site funciona em "modo demonstração":
   tudo fica guardado só neste browser e os pagamentos são simulados.
   ===================================================================== */
window.XTECH_CONFIG = {
  supabaseUrl: 'https://nzpbrifskoiidfnttziy.supabase.co',
  supabaseAnonKey: 'sb_publishable_JHZ1cYfRigma7N2JdvAm1A_v6uri9He',  // chave "publishable" / "anon public" (é pública, pode estar aqui)

  // Dados da empresa para os Termos e Condições (obrigatórios por lei numa loja online)
  empresa: {
    nomeLegal: '',      // o teu nome completo (empresário em nome individual) ou o nome da sociedade, ex: 'Xtech Store, Lda.'
    nif: '',            // NIF da empresa / atividade
  },
};
