# Xtech Store: pôr a loja online a funcionar

Este guia explica como pôr o site da Xtech Store online com pagamentos a sério. Quando terminares, o site faz isto:

- **Os clientes compram e pagam no site** com MB WAY, Multibanco, cartão, Apple Pay ou Google Pay. Também podem reservar e pagar quando levantam na loja.
- **As encomendas aparecem logo no painel de admin**, com um som e um aviso no ecrã.
- **O cliente tem uma área só dele**, chamada "A minha conta", com estas abas:
  - Encomendas, com o estado de cada uma e o código de seguimento;
  - Devoluções;
  - Reparações;
  - Moradas;
  - Dados pessoais.
- **Admin e clientes veem a mesma informação em qualquer dispositivo.** Antes, cada browser guardava os dados à parte.

Leva cerca de 1 hora na primeira vez. Os serviços usados têm todos plano gratuito para começar. O Stripe só cobra uma comissão por cada venda paga.

---

## O que está nesta pasta

| Pasta ou ficheiro | Para que serve |
|---|---|
| `public/` | O site em si. |
| `public/emails.js` | Os textos e as regras dos emails automáticos para os clientes e para a loja. |
| `public/agenda.js`, `public/agenda.css` | As marcações de reparação (página do cliente e separador Marcações no painel). |
| `public/config.js` | O único ficheiro que tens de editar: aqui colas os dados do Supabase. |
| `netlify/` | A parte do servidor: cria as encomendas, liga ao Stripe e confirma os pagamentos. |
| `supabase/schema.sql` | O código que cria a base de dados. |
| `netlify.toml`, `package.json` | Configuração do alojamento. Não precisas de mexer. |

---

## Passo 0: experimentar já, sem configurar nada

Abre `public/index.html` no Chrome com duplo clique. Enquanto o `config.js` estiver vazio, o site funciona em **modo demonstração**:

- tudo fica guardado só nesse browser;
- os pagamentos são simulados.

Podes testar tudo:

1. Adiciona um produto ao carrinho.
2. Cria uma conta e finaliza a compra.
3. Vai a "A minha conta".
4. Entra na **Área reservada**, no fundo da página, com `admin@xtechstore.pt` e a palavra-passe `xtech2026`.
5. Abre **Encomendas → Loja online**.

---

## Passo 1: criar a base de dados (Supabase)

1. Cria conta em **supabase.com** e carrega em **New project**.
   - **Name:** `xtech-store`.
   - **Region:** escolhe uma da Europa, por exemplo *West EU (Ireland)* ou *Central EU (Frankfurt)*.
   - Guarda a palavra-passe da base de dados num sítio seguro.
2. Quando o projeto estiver pronto, vai a **SQL Editor → New query**.
3. Abre o ficheiro `supabase/schema.sql`, copia tudo, cola e carrega em **Run**. Deve aparecer "Success".
4. Carrega outra vez em **New query**, abre o ficheiro `supabase/stock-inicial.sql`, copia tudo, cola e carrega em **Run**. Isto põe na loja os teus equipamentos e os acessórios. Só precisas de o fazer uma vez.
5. Vai a **Project Settings → API**. Vais precisar de três valores:
   - **Project URL**, por exemplo `https://abcdxyz.supabase.co`;
   - a chave **anon public**;
   - a chave **service_role**. Esta é **secreta**: nunca a ponhas no site nem a partilhes.
6. Abre `public/config.js` num editor de texto (por exemplo o Bloco de Notas). Preenche assim:
   ```js
   supabaseUrl: 'https://abcdxyz.supabase.co',
   supabaseAnonKey: 'eyJhbGciOi...a-chave-anon...',
   ```
   No mesmo ficheiro, preenche também os dados da empresa. São obrigatórios por lei numa loja online e aparecem nos Termos e Condições:
   ```js
   empresa: {
     nomeLegal: 'O teu nome completo ou o nome da sociedade',
     nif: '123456789',
   },
   ```

> No plano gratuito, o Supabase põe o projeto em pausa se passar 1 semana sem nenhuma visita. Com a loja aberta ao público isso não costuma acontecer. Se acontecer, basta ir ao painel do Supabase e carregar em "Restore".

---

## Passo 2: criar a conta de pagamentos (Stripe)

1. Cria conta em **stripe.com** e ativa-a com os dados da empresa: NIF, morada, IBAN e documento de identificação.
2. Vai a **Definições → Métodos de pagamento** e ativa estes métodos:
   - Cartões;
   - Apple Pay;
   - Google Pay;
   - **MB WAY**;
   - **Multibanco**.
3. Vai a **Programadores → Chaves de API** e copia a **Secret key**.
   - Para testar primeiro, usa o **modo de teste** (a chave começa por `sk_test_`).
   - Quando estiver tudo a funcionar, trocas pela chave real (começa por `sk_live_`).

As comissões dependem do método de pagamento. Consulta-as em stripe.com/pt/pricing.

---

## Passo 3: publicar o site (GitHub + Netlify)

O Netlify aloja o site gratuitamente e corre a parte do servidor. Para essa parte funcionar, o site tem de ser publicado a partir do GitHub. Arrastar a pasta para o Netlify não chega.

1. Cria conta em **github.com**.
2. Carrega em **New repository**. Dá-lhe o nome `xtech-loja` e escolhe **Private**.
3. Carrega em **uploading an existing file** e arrasta para lá **todo o conteúdo** desta pasta:
   - `public`;
   - `netlify`;
   - `supabase`;
   - `netlify.toml`;
   - `package.json`;
   - este guia.

   Depois carrega em **Commit changes**.
4. Cria conta em **netlify.com** (podes entrar com a conta do GitHub).
5. Vai a **Add new site → Import an existing project → GitHub** e escolhe o repositório `xtech-loja`. Carrega em **Deploy**.
6. Abre **Site configuration → Environment variables** e adiciona estas variáveis:

   | Nome | Valor |
   |---|---|
   | `SUPABASE_URL` | O Project URL do Supabase. |
   | `SUPABASE_SERVICE_ROLE_KEY` | A chave **service_role** do Supabase. |
   | `STRIPE_SECRET_KEY` | A Secret key do Stripe. |
   | `STRIPE_WEBHOOK_SECRET` | Fica para o passo 4. |
   | `SITE_URL` | O endereço do site, por exemplo `https://xtechstore.netlify.app` ou o teu domínio. |

7. Vai a **Deploys → Trigger deploy → Deploy site** para o site arrancar com as variáveis.
8. No **Supabase**, vai a **Authentication → URL Configuration**:
   - em **Site URL**, põe o endereço do site;
   - em **Redirect URLs**, adiciona o mesmo endereço.

   Sem isto, os links de confirmação de email não funcionam.

---

## Passo 4: avisar o site quando um pagamento é feito (webhook do Stripe)

1. No Stripe, vai a **Programadores → Webhooks** e carrega em **Adicionar destino** (ou "Add endpoint").
2. Em **URL**, escreve `https://O-TEU-SITE/.netlify/functions/stripe-webhook`.
3. Escolhe estes 4 eventos:
   - `checkout.session.completed`;
   - `checkout.session.async_payment_succeeded`;
   - `checkout.session.async_payment_failed`;
   - `checkout.session.expired`.
4. Copia o **Signing secret** (começa por `whsec_`).
5. No Netlify, cria a variável `STRIPE_WEBHOOK_SECRET` com esse valor e faz **Trigger deploy** outra vez.

> O webhook é o que marca a encomenda como **Paga**. O browser do cliente nunca o pode fazer, por isso ninguém consegue fingir um pagamento.
> Os pagamentos por Multibanco ficam "A aguardar pagamento" até o cliente pagar a referência. Depois disso, passam a "Paga" sozinhos.

---

## Passo 4B: emails automáticos (com o teu Gmail)

O site envia sozinho emails aos clientes. Cada email só é enviado uma vez.

| Quando | Email para o cliente | Aviso para ti |
|---|---|---|
| Compra paga online | Obrigado pela compra, com os artigos e o total | Nova encomenda |
| Reserva para pagar na loja | Reserva confirmada | Nova encomenda |
| Multibanco por pagar | Entidade, referência e valor | — |
| Encomenda **Pronta a levantar** | Está pronta, com a morada e o horário | — |
| Encomenda **Enviada** | Transportadora e código de seguimento | — |
| **Entregue** ou **Levantada** | Obrigado, com os 18 meses de garantia | — |
| Encomenda cancelada ou reembolsada | Aviso do cancelamento ou do reembolso | — |
| Pedido de devolução | Recebemos o pedido; depois Aprovada, Recusada ou Reembolsada | Novo pedido |
| Marcação nova | Confirmação com dia, hora e botão para o calendário | Nova marcação |
| Mudas o dia ou a hora no painel | Novo horário | — |
| Marcação cancelada | Aviso do cancelamento | Se foi o cliente a desmarcar |
| Véspera da marcação (por volta das 17h–18h) | Lembrete para amanhã | — |

Os emails saem do teu Gmail (**xtechstorept@gmail.com**). Ficam na pasta **Enviados** e, se o cliente responder, a resposta chega à tua caixa.

**Como ligar (5 minutos):**

1. Entra no Gmail da loja e abre **myaccount.google.com → Segurança**.
2. Liga a **Verificação em 2 passos**, se ainda não estiver ligada. Sem isto, o passo seguinte não aparece.
3. Na pesquisa da página, escreve **Palavras-passe de aplicações** e abre.
4. Dá-lhe o nome `Site Xtech` e carrega em **Criar**. O Google mostra 16 letras: copia-as.

   **Atenção:** esta palavra-passe é secreta. Só a pões no Netlify, nunca no site nem em mensagens.
5. No Netlify, vai a **Site configuration → Environment variables** e adiciona:

   | Nome | Valor |
   |---|---|
   | `GMAIL_USER` | `xtechstorept@gmail.com` |
   | `GMAIL_APP_PASSWORD` | As 16 letras do passo 4. |
   | `SHOP_EMAIL` | (opcional) Onde recebes os avisos de encomendas e marcações. Por defeito é o mesmo Gmail. |

6. **Deploys → Trigger deploy → Deploy site**.
7. Testa: faz uma marcação no site com o teu email pessoal. Devem chegar dois emails, a confirmação e o aviso para a loja.

**Notas:**
- O Gmail deixa enviar até cerca de 500 emails por dia. Chega bem para a loja.
- Mais tarde, com domínio próprio (por exemplo `loja@xtechstore.pt`), podes trocar para o **Resend** (resend.com), que é gratuito até 3000 emails por mês:
  1. Verifica o domínio no Resend.
  2. Põe `RESEND_API_KEY` e `EMAIL_FROM` (por exemplo `Xtech Store <loja@xtechstore.pt>`) no Netlify.
  3. Apaga as duas variáveis do Gmail.
- Sem email configurado, o site funciona igual, só não envia emails. Nesse caso os emails desse período ficam marcados como tratados e não são enviados mais tarde, quando ligares o email.
- Encomendas, devoluções e marcações que já existiam antes desta atualização não recebem emails atrasados.
- Se um envio falhar (por exemplo, palavra-passe errada), o site tenta outra vez da próxima vez que essa encomenda ou marcação mudar. O erro aparece em **Netlify → Logs → Functions**.
- Os emails de conta (confirmar o email e recuperar a palavra-passe) são enviados pelo Supabase. O envio de origem do Supabase só deixa mandar poucos emails por hora, por isso usa lá o mesmo Gmail:
  1. No Supabase, abre **Authentication → Emails → SMTP Settings** e liga **Enable custom SMTP**.
  2. Preenche assim:
     - Host: `smtp.gmail.com`
     - Port: `465`
     - Username: o teu Gmail
     - Password: as mesmas 16 letras
     - Sender email: o teu Gmail
     - Sender name: `Xtech Store`
- No **modo demonstração** nada é enviado. Em vez disso, aparece no canto do ecrã um cartão com o email que seria enviado e o botão **Ver**.

---

## Se alguma coisa não funcionar

**1. Diagnóstico.** Abre no browser:
`https://xtechstore.netlify.app/.netlify/functions/notify?diagnostico=1`

Mostra se o Supabase, o Gmail, o Stripe e a IA estão bem configurados. Não mostra nenhuma palavra-passe. Tudo o que diz **FALTA** ou **ERRO** é o que tens de corrigir nas variáveis do Netlify. Depois de corrigires, faz **Deploys → Trigger deploy**.

**2. Acesso ao painel perdido.** Abre:
`https://xtechstore.netlify.app/.netlify/functions/setup-admin`
- Cria ou confirma a conta do email da loja e põe-na como administradora.
- Manda para esse Gmail um link para escolheres a palavra-passe.
- Na Área reservada, o botão "Esqueci-me da password" faz o mesmo.

**3. Contas de clientes.**
- Quem cria conta no site entra logo, sem email de confirmação. A conta é criada pelo servidor do site.
- O "Esqueci-me da palavra-passe" manda o link pelo teu Gmail, em português.
- Também podem entrar com a conta Google, depois de configurares o Google no Supabase.

**4. Assistente e orçamentos.**
- Sem a variável `ANTHROPIC_API_KEY`, o chat responde sozinho com a informação real do site: preços de reparação, stock, horário, morada e marcações. Tem botões rápidos e ligação ao WhatsApp.
- O pedido de orçamento na página Reparações é um formulário simples. Cada pedido aparece no painel (Orçamentos) e manda um email para ti e para o cliente.
- Se um dia quiseres o assistente com IA, cria conta em console.anthropic.com, põe a chave em `ANTHROPIC_API_KEY` no Netlify e faz Trigger deploy. O chat passa a usar IA sozinho, e cada conversa custa poucos cêntimos.

**5. Stock das publicações do Instagram.**
- O ficheiro `supabase/stock-instagram.sql` tem os produtos publicados até 30 de outubro.
- Correr esse ficheiro **substitui** a lista de equipamentos. Depois disso, gere o stock pelo painel (Stock).

---

## Passo 5: criar a tua conta de administrador

1. Abre o site, carrega em **Entrar → Criar conta** e regista-te com o teu email, por exemplo `xtechstorept@gmail.com`.
2. Abre o email do Supabase e confirma a conta.
3. No Supabase, vai a **SQL Editor** e corre esta linha, com o teu email:
   ```sql
   insert into public.staff (email, name, role) values ('xtechstorept@gmail.com', 'Dinis', 'Admin');
   ```
4. No site, vai a **Área reservada** (no fundo da página) e entra com esse email e essa palavra-passe.
5. O stock já lá está (do `stock-inicial.sql`). Só se tiveres reparações ou registos financeiros antigos no painel de outro computador é que precisas de os trazer: vai a **Equipa → Dados da loja → Importar dados deste browser** nesse computador.
   - Atenção: importar **substitui tudo**, incluindo o stock. Se o fizeres, confirma depois em **Stock** que os produtos e preços estão certos.

Para adicionar outra pessoa da equipa:

1. Vai a **Equipa → + Novo** e indica o nome e o email dela.
2. A pessoa cria conta no site com esse email e confirma o email.
3. A partir daí, entra na Área reservada com essa conta.

---

## Passo 6: testar antes de abrir ao público

Com as chaves de **teste** do Stripe:

1. Faz uma encomenda no site e paga com o cartão de teste:
   - número: `4242 4242 4242 4242`;
   - validade: qualquer data futura;
   - CVC: qualquer código.
2. Confirma que a encomenda aparece no painel como **Paga**.
3. Muda o estado da encomenda e confirma que o cliente vê a mudança em "A minha conta".
4. Experimenta também **Pagar na loja ao levantar** e um pedido de **devolução**.
5. Quando estiver tudo bem:
   - troca `STRIPE_SECRET_KEY` pela chave real (`sk_live_`);
   - cria o webhook também no modo real (passo 4) e atualiza `STRIPE_WEBHOOK_SECRET`;
   - faz **Trigger deploy**.

---

## No dia a dia

- **Encomenda nova:** ouves um som e aparece um aviso no painel. A encomenda fica em **Encomendas → Loja online → Por tratar**.
- **Levantamento na loja:** muda o estado assim: Em preparação → Pronta a levantar → Levantada. O botão "Abrir email" prepara a mensagem para o cliente.
- **Envio:** escolhe a transportadora, escreve o código de seguimento e muda o estado para **Enviada**. O cliente vê o código na conta dele.
- **Devoluções:** os pedidos aparecem em **Encomendas → Devoluções**.
  1. Aprova o pedido ou recusa-o. A resposta que escreveres aparece ao cliente.
  2. Quando receberes o artigo, marca **Artigo recebido**. O painel pergunta se queres repor o stock.
  3. Faz o reembolso no Stripe (**Pagamentos →** escolhe o pagamento **→ Reembolsar**).
  4. Marca a devolução como **Reembolsada**.
- **Stock:**
  - baixa sozinho quando uma encomenda é paga;
  - nas reservas para pagar na loja, baixa logo no momento da reserva;
  - volta a subir se cancelares a encomenda.
- **Portes de envio:** muda-os em **Loja online → Definições da loja**. Lá defines o custo do envio, o valor a partir do qual o envio é grátis, ou desligas os envios.

## Marcações de reparação (agendamento)

Os clientes marcam dia e hora no site. Entram pelo botão **Marcar reparação** (página Reparações, cartões dos serviços, banner do início e rodapé) ou pelo link direto **o-teu-site/#marcar**. Este link é bom para pôr na bio do Instagram.

**Se já tinhas corrido o `schema.sql` antes:** corre-o outra vez (Supabase → SQL Editor → cola tudo → Run). Isto cria a tabela das marcações e não estraga nada do que já existe.

**Como funciona para o cliente:**
1. Escolhe o serviço.
2. Indica o equipamento.
3. Escolhe o dia e a hora. Só aparecem os horários livres.
4. Escreve o nome e o telemóvel.

No fim pode adicionar a marcação ao calendário do telemóvel, abrir o caminho no Google Maps e enviar-te o resumo por WhatsApp. Não paga nada no site. Se tiver conta, vê e desmarca em **A minha conta → Reparações**.

**No painel (separador Marcações):**
- As marcações novas aparecem como **Nova**, com um número vermelho no menu. Se o painel estiver aberto, também aparece um aviso.
- Ao abrir uma marcação tens:
  - **Confirmar por WhatsApp:** a mensagem já vai escrita;
  - **Ligar**;
  - **Avisar que está pronto**;
  - mudar o estado: Confirmada, Concluída, Faltou ou Cancelada;
  - mudar o dia ou a hora;
  - uma nota interna, que o cliente não vê.
- Quando o cliente chega, carrega em **O cliente chegou — criar ficha de reparação**. A ficha é criada com os dados preenchidos.
- **+ Nova** serve para registar marcações feitas por telefone ou ao balcão.
- As marcações também aparecem no **Calendário** (ponto branco) e no **Início**, onde vês quantas há hoje e a próxima.

**Definições** (botão no separador Marcações):
- ligar e desligar as marcações online;
- quantos clientes podem marcar à mesma hora;
- o intervalo entre horários (30 min por defeito);
- a antecedência mínima;
- até quantos dias à frente se pode marcar;
- o horário de cada dia, com pausa para almoço opcional;
- os dias fechados, como feriados e férias.

O horário de origem é o da loja: segunda a sexta 9h30–19h, sábado 10h–13h, domingo fechado.

**Segurança:** as marcações são validadas no servidor, pela função `book_service` da base de dados.
- Ninguém consegue marcar fora do horário, num dia fechado ou numa hora já ocupada.
- Ninguém de fora consegue ver as marcações de outras pessoas.
- O mesmo número de telemóvel só pode ter 3 marcações ativas ao mesmo tempo.

---

## Domínio próprio (opcional, recomendado)

O site fica logo disponível num endereço do tipo `xtechstore.netlify.app`. Se quiseres um endereço teu (por exemplo `xtechstore.pt`):

1. No Netlify, vai a **Domain management → Add a domain** e segue os passos. Podes comprar o domínio lá mesmo ou num registador .pt.
2. Atualiza a variável `SITE_URL` com o endereço novo e faz **Trigger deploy**.
3. Atualiza também o endereço no Supabase (**Authentication → URL Configuration**) e no webhook do Stripe.

O site põe sozinho o endereço certo nas imagens de partilha (WhatsApp, Instagram, Facebook), no Google e no mapa do site.

## Atualizar o stock no dia a dia

- **Vendeste uma peça na loja física?** Entra na Área reservada → **Stock**, abre o equipamento e põe o stock a 0. Desaparece logo do site e da vitrine.
- **Venda online:** o stock baixa sozinho.
- **Equipamento novo:** **Stock → + Novo**. Escolhe a categoria (Telemóveis, Computadores, Consolas, Relógios…), preenche marca, modelo, preço, cor e saúde da bateria, e carrega a foto. Aparece na loja, na vitrine "Escolhe o teu." e no assistente do chat.

## Assistente com IA (opcional)

O chat do site e as sugestões automáticas do admin usam IA. Para funcionarem no site publicado:

1. Cria uma chave em **console.anthropic.com**.
2. Adiciona-a no Netlify como `ANTHROPIC_API_KEY`.

O servidor usa o modelo Claude Haiku 4.5, que é rápido e barato. Se quiseres outro modelo, cria a variável `ANTHROPIC_MODEL` com o nome dele. Só o próprio site pode usar esta ligação: pedidos vindos de outros sites são recusados.

Sem esta chave, o resto do site funciona normalmente.

## Antes de abrir: o que tens de tratar fora do site

- **Faturas:** o site e o Stripe **não emitem faturas certificadas pela AT**. Continua a emitir a fatura de cada venda no teu programa de faturação certificado. O NIF do cliente aparece em cada encomenda.
- **Textos legais:** a página de Termos, Devoluções e Privacidade é um **modelo**.
  - Completa o nome legal da empresa e o NIF.
  - Confirma a entidade de resolução de litígios.
  - Pede ao teu contabilista ou jurista para rever.
- **Livro de Reclamações Eletrónico:** confirma que a loja está registada em livroreclamacoes.pt. O link já está no rodapé do site.
- **Garantia:** o site indica 18 meses nos equipamentos usados e 3 anos nos artigos novos, os prazos mínimos do Decreto-Lei n.º 84/2021 para vendas a consumidores. Não indiques prazos mais curtos.
- **Morada e horário:** confirma que a morada (Largo Dom Gualdim Pais 21, Amares) e o horário que o assistente do chat indica (segunda a sexta 9h30–19h, sábado 10h–13h) estão certos.

## Lista final antes de abrir

- [ ] `schema.sql` e `stock-inicial.sql` corridos no Supabase
- [ ] `config.js` com o URL e a chave anon do Supabase, nome legal e NIF
- [ ] Site publicado no Netlify com as variáveis `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` e `SITE_URL`
- [ ] Webhook do Stripe criado
- [ ] A tua conta registada como Admin (passo 5)
- [ ] Encomenda de teste paga com o cartão 4242… e uma reserva para pagar na loja
- [ ] Chaves do Stripe trocadas para o modo real (`sk_live_`)
- [ ] Acessórios atualizados com os teus preços e stock reais

---

## Ferramentas do painel admin: Peças e Negócios Vinted

Há dois separadores novos na barra de baixo do painel admin. Só funcionam com o site publicado no Netlify, porque as pesquisas são feitas pelo servidor do site. No ficheiro aberto no PC não funcionam.

### 📱 Peças: comparador de fornecedores
1. Escreve a peça e o modelo, por exemplo `lcd iphone 13`, `bateria iphone 12 pro` ou `conector galaxy s22`, e carrega em **Comparar**.
2. O site pesquisa em todos os fornecedores ao mesmo tempo e mostra:
   - o **mais barato** de todos;
   - **quanto poupas** em relação à loja mais cara;
   - um cartão por loja, com todas as opções dessa loja, o preço e o stock.
3. Carregar num produto abre-o no site do fornecedor.

**Gerir as lojas:** botão **Fornecedores**. Os que vêm por omissão são a Microwire, a Alrossio e a Celuinfo.
- O site reconhece sozinho o tipo de loja: WooCommerce, Shopify, PrestaShop ou página normal.
- Se uma loja aparecer como «não consegui ler»:
  1. Faz uma pesquisa no site dessa loja e copia o link da página de resultados.
  2. Troca o que pesquisaste por `{q}`, por exemplo `https://www.loja.pt/pesquisa?s={q}`.
  3. Cola esse link no campo «link de pesquisa» do fornecedor.
- Enquanto isso não estiver resolvido, o cartão dessa loja tem sempre o botão «Abrir pesquisa no site».

### 📈 Negócios Vinted
1. Escreve o modelo, por exemplo `iphone 13 128gb`, e se quiseres um preço máximo, e carrega em **Procurar**.
2. Aparecem:
   - o **preço normal** desse modelo (mediana dos anúncios a funcionar);
   - a lista do **mais barato para o mais caro**. Cada anúncio tem a % abaixo ou acima do preço normal, o defeito que está no título e há quanto tempo foi publicado. Os anúncios suspeitos aparecem riscados.
3. **Se a Vinted bloquear o servidor:** a Vinted às vezes bloqueia pedidos de servidores. Nesse caso o painel avisa e mostra os botões **«Ver os mais baratos na Vinted»** e **«Ver os mais recentes»**, que abrem a Vinted já filtrada e ordenada.

### Segurança
- Com o Supabase ligado, só quem está na tabela `staff` (a equipa) pode usar estas pesquisas.
- A lista de fornecedores fica guardada na base de dados e só a equipa a vê.
