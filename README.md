# 🛵 Delivery Já — Sistema de Delivery Multi-lojas

Sistema completo de delivery estilo iFood, com 4 perfis (cliente, lojista,
entregador e admin), pronto para operação real.

- **Linguagem:** **TypeScript** em todo o projeto (strict no backend)
- **Backend:** Node.js + Express, API REST em JSON com mensagens em português
- **Banco:** SQLite (schema compatível para migrar a PostgreSQL)
- **Frontend (cliente):** **React + Vite + Tailwind CSS + shadcn-style + Lucide
  + Framer Motion + TanStack Query**, modo claro/escuro automático, mobile-first
- **Frontend (lojista/entregador/admin):** HTML + TS compilado para JS plano
  (estilo "sem framework"), serviço pelo mesmo Express
- **Tempo real:** polling curto (4–5 s) nas telas de pedidos
- **Segurança:** bcrypt, JWT com expiração, autorização por perfil no backend,
  queries parametrizadas (anti SQL injection), escape de HTML (anti XSS),
  rate limiting no login

---

## Pré-requisitos

- **Node.js 20 ou superior** (testado com Node 24) — https://nodejs.org
- npm (vem com o Node)

## Passo a passo para rodar

```bash
# 1. Instalar as dependências
npm install

# 2. Criar o arquivo de configuração
#    (Windows: copy .env.example .env | Linux/Mac: cp .env.example .env)
copy .env.example .env

# 3. Popular o banco com os dados de demonstração
npm run seed

# 4. Subir o servidor (compila o TS automaticamente)
npm start
```

> Scripts disponíveis:
> - `npm run build` — compila backend (`tsc`) + frontend React (`vite build`)
> - `npm start` — compila tudo e sobe o servidor
> - `npm run start:rapido` — sobe sem recompilar (`dist/` e `public/index.html` já existem)
> - `npm run dev:react` — Vite em modo dev (HMR em `localhost:5173` com proxy para a API)
> - `npm run seed` — popula o banco com dados de demonstração
> - `npm run teste:e2e` — executa o teste de ponta a ponta (32 cenários)

### Estrutura React do cliente

A vitrine, cardápio, carrinho, checkout, acompanhamento e conta vivem em
`frontend/src/`:
- `pages/cliente/` — vitrine, loja, carrinho, pedidos, conta, modal de produto
- `components/ui/` — Button, Card, Badge, Input, Sheet, Toast, Skeleton…
  (componentes shadcn-style escritos do zero)
- `components/banner-carousel.tsx` — carrossel de banners com Framer Motion
- `components/theme-toggle.tsx` — alternância claro/escuro persistida
- `lib/api.ts` — cliente HTTP + sessão; `lib/carrinho.ts` — estado persistente
- `index.css` — tokens de design Tailwind (light + dark)

Pronto! Acesse:

| Tela | URL |
|---|---|
| 🛒 Cliente (vitrine) | http://localhost:3000/ |
| 🏪 Painel do lojista | http://localhost:3000/lojista.html |
| 🛵 Entregador | http://localhost:3000/entregador.html |
| 🛠️ Admin | http://localhost:3000/admin.html |

## Contas de teste (criadas pelo seed)

| Perfil | E-mail | Senha |
|---|---|---|
| Admin | `admin@demo.com` | `admin123` |
| Cliente | `cliente@demo.com` | `cliente123` |
| Lojista (Pizzaria da Paula) | `lojista@demo.com` | `lojista123` |
| Lojista (Burger do Bruno) | `lojista2@demo.com` | `lojista123` |
| Entregador | `entregador@demo.com` | `entrega123` |

> ⚠️ **Estas senhas são de demonstração. Troque TODAS antes de colocar em
> produção** (ou apague os usuários demo e crie os seus).

### Testando o fluxo completo (4 abas/janelas)

1. **Cliente** (`/`): escolha uma loja, monte o carrinho e finalize o pedido.
2. **Lojista** (`/lojista.html`): o pedido chega com alerta sonoro →
   *Aceitar* → *Iniciar preparo* → *Marcar como pronto*.
3. **Entregador** (`/entregador.html`): a corrida aparece → *Aceitar* →
   *Confirmar entrega*.
4. **Admin** (`/admin.html`): veja o pedido no dashboard, a comissão e o
   repasse da loja.

## Teste automatizado de ponta a ponta

```bash
npm run teste:e2e
```

Sobe o servidor em uma porta separada com banco descartável e valida 27
cenários: fluxo feliz completo **e** os casos de erro (transição de status
inválida, corrida aceita por dois entregadores ao mesmo tempo, acesso sem
permissão, preço forjado no navegador, loja fechada, rate limiting etc.).

## Estrutura de pastas

```
delivery-multilojas/
├── package.json
├── tsconfig.backend.json     # config TS do backend (strict, CommonJS)
├── tsconfig.frontend.json    # config TS do frontend (scripts globais)
├── .env.example              # modelo de configuração (copie para .env)
├── dados/                    # banco SQLite (criado automaticamente)
├── dist/                     # backend TS compilado (gerado por `npm run build`)
├── src/
│   ├── tipos/
│   │   └── modelos.ts        # tipos do domínio (Usuario, Loja, Pedido…)
│   ├── backend/
│   │   ├── server.ts         # servidor Express (rotas + tratador de erros)
│   │   ├── db.ts             # conexão e schema do banco
│   │   ├── auth.ts           # JWT + middleware de autorização por perfil
│   │   ├── fluxoPedido.ts    # máquina de estados do pedido
│   │   ├── notificacoes.ts   # fila de eventos + esqueleto WhatsApp
│   │   ├── util.ts           # datas UTC, validação e saneamento
│   │   ├── seed.ts           # dados de demonstração
│   │   └── rotas/
│   │       ├── autenticacao.ts, publico.ts, cliente.ts,
│   │       └── lojista.ts, entregador.ts, admin.ts, pagamentos.ts
│   ├── frontend/             # frontend TS (compilado para public/js/)
│   │   ├── tipos-frontend.ts # tipos enxutos do domínio para o navegador
│   │   ├── comum.ts          # api(), sessão, formatação BRL/datas, escape XSS
│   │   └── cliente.ts, lojista.ts, entregador.ts, admin.ts
│   └── testes/
│       └── e2e.ts            # teste de ponta a ponta (32 cenários)
└── public/                   # arquivos estáticos servidos pelo Express
    ├── index.html, lojista.html, entregador.html, admin.html
    ├── estilo.css
    └── js/                   # JS gerado pelo `tsc` (não comitar)
```

## Cardápio com opções (estilo Pizza Prime)

Cada produto pode ter **grupos de opções** gerenciados pelo lojista:

- **Escolha única** (radio): tamanho da pizza (Broto/Média/Big), borda
  recheada, combo de acompanhamento — pode ser obrigatória ou opcional.
- **Múltipla escolha** (checkbox): adicionais com limite máximo (ex.: até 5).
- Cada opção tem **preço adicional** próprio; o preço final do item =
  preço do produto (ou promocional) + soma dos adicionais escolhidos.
- Produto também suporta: **preço promocional** ("de/por"), **destaque** ⭐,
  **serve N pessoas**, foto e pausa individual de opção.
- O cliente monta o item em um **modal** com cálculo em tempo real — e o
  servidor revalida e reprecifica TUDO no checkout (grupo obrigatório sem
  escolha, opção de outro produto, limite estourado → erro 400).

## Regras de negócio implementadas

- **Preços recalculados no servidor**: o navegador envia apenas
  `produto_id` + `quantidade` + ids das opções; subtotal, taxa e total saem do banco.
- **Fluxo oficial do pedido** (validado no backend, sem pular/voltar etapa):
  `pendente → aceito → preparando → pronto → em_entrega → entregue`
  - Cliente cancela **apenas** enquanto `pendente`; lojista pode recusar.
- **Aceite atômico de corrida**: `UPDATE ... WHERE status='pronto' AND
  entregador_id IS NULL` garante que dois entregadores nunca peguem a mesma.
- **Loja só vende se aprovada pelo admin E aberta**; produto excluído é
  exclusão lógica (histórico preservado).
- **Comissão da plataforma**: percentual configurável pelo admin, congelado
  (snapshot) em cada pedido; relatório de repasse por loja.
- **Dinheiro em centavos (inteiros)**, exibido em BRL no formato brasileiro;
  **datas em UTC** no banco, exibidas no fuso do usuário.

## Fase 2 — pagamentos e notificações (estrutura pronta)

- **Mercado Pago** (`src/rotas/pagamentos.js`): preencha
  `MERCADOPAGO_ACCESS_TOKEN` no `.env`, use `criarPagamentoMercadoPago()` na
  criação do pedido e cadastre o webhook
  `POST /api/pagamentos/webhook/mercadopago` no painel do MP — ele já
  atualiza `pagamento_status` do pedido. Enquanto isso, o pagamento é
  combinado na entrega (Pix, dinheiro com troco ou cartão) e fica registrado
  no pedido.
- **WhatsApp/push** (`src/notificacoes.js`): os eventos *pedido aceito*,
  *saiu para entrega* e *entregue* já são gravados em `eventos_notificacao`.
  Preencha `WHATSAPP_TOKEN`/`WHATSAPP_PHONE_ID` e crie um worker que percorra
  os eventos pendentes chamando `enviarWhatsApp()`.

## Guia de deploy

> ### ⚠️ Antes de QUALQUER deploy
> 1. **Troque o `JWT_SECRET`** por uma string longa e aleatória:
>    `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
> 2. **Troque (ou apague) as contas demo** — em especial `admin@demo.com`.
> 3. Defina `CONFIA_PROXY=1` se estiver atrás de proxy (Railway/Render/Nginx),
>    para o rate limiting enxergar o IP real do visitante.

### Railway / Render

1. Suba o projeto em um repositório Git (o `.gitignore` já exclui `.env` e `dados/`).
2. Crie o serviço apontando para o repositório:
   - **Build:** `npm install`
   - **Start:** `npm start`
3. Configure as variáveis de ambiente no painel: `JWT_SECRET` (novo!),
   `JWT_EXPIRACAO`, `CONFIA_PROXY=1` e `DB_ARQUIVO` apontando para um
   **disco persistente** (Railway: Volume; Render: Persistent Disk —
   ex.: `/dados/delivery.db`). Sem disco persistente o SQLite zera a cada deploy.
4. Rode o seed uma única vez pelo shell do serviço: `npm run seed`.

### VPS (Ubuntu + Nginx)

```bash
# Node 20+, clone do projeto e dependências
sudo apt update && sudo apt install -y nginx
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs
git clone <seu-repositorio> /opt/delivery && cd /opt/delivery
npm install && cp .env.example .env
nano .env        # JWT_SECRET novo, CONFIA_PROXY=1
npm run seed

# Processo gerenciado (reinicia sozinho)
sudo npm install -g pm2
pm2 start server.js --name delivery && pm2 save && pm2 startup
```

Nginx como proxy reverso (com HTTPS via certbot):

```nginx
server {
  server_name seudominio.com.br;
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header Host $host;
  }
}
```

### Migração futura para PostgreSQL

O schema já evita recursos exclusivos do SQLite: dinheiro como `INTEGER`
(centavos), datas `TEXT` ISO-8601 UTC, booleans 0/1 e chaves estrangeiras.
A migração se resume a trocar `better-sqlite3` por `pg`, adaptar
`INTEGER PRIMARY KEY` para `BIGSERIAL` e converter as colunas de data para
`TIMESTAMPTZ`.
