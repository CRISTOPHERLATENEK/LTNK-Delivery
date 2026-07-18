# Deploy — VPS / Hostinger (Node.js + MySQL)

Guia pra subir o Delivery Multi-lojas. O app roda em **Node.js + MySQL** (a migração de
SQLite→MySQL está descrita em [`MIGRACAO-MYSQL-STATUS.md`](MIGRACAO-MYSQL-STATUS.md), que é
a referência do corte de produção). Recomendado um **VPS** (disco próprio); serve também
para a opção "Web app Node.js" da Hostinger, desde que você tenha um MySQL acessível.

## 1. Subir o código pro GitHub

Já está tudo preparado (`.gitignore`, `postinstall`). No terminal, dentro da pasta do projeto:

```bash
git init
git add .
git commit -m "Delivery multi-lojas"
git branch -M main
git remote add origin https://github.com/SEU_USUARIO/SEU_REPO.git
git push -u origin main
```

> Crie o repositório vazio no GitHub antes (site do GitHub → New repository).
> **Não** commite a pasta `dados/` nem o `.env` — o `.gitignore` já bloqueia os dois.

## 2. Configurar o app na Hostinger

Na tela **"Web app Node.js"**, conecte o repositório e configure:

| Campo | Valor |
|---|---|
| **Versão do Node** | 18 ou superior |
| **Comando de build** | `npm run build` |
| **Comando de start** | `node dist/backend/server.js` |
| **Porta** | deixe o padrão (o app lê `process.env.PORT` automaticamente) |

O `npm install` roda sozinho e, via `postinstall`, já instala também as dependências do
`frontend/`. O `npm run build` compila o backend (→ `dist/`) e o frontend (→ `public/`).

## 3. Variáveis de ambiente

No painel do app, adicione as variáveis (copie os nomes do `.env.example`). As essenciais:

- `NODE_ENV=production`
- `JWT_SECRET` — segredo forte e único
- `APP_SECRET` — segredo forte e único, **≥32 caracteres** (criptografia de dados sensíveis, ex.: senha do certificado). Em produção o app **não sobe** sem ele com ≥32 chars.
- `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` — Web Push (gere com `npx web-push generate-vapid-keys`)
- `MERCADOPAGO_ACCESS_TOKEN` — token do Mercado Pago (Pix), se for usar pagamento online (opcional; também pode ser configurado por loja no painel). `MERCADOPAGO_WEBHOOK_SECRET` — opcional.

**Banco de dados MySQL (obrigatório — o app roda em MySQL, não mais SQLite):**

- `MYSQL_HOST`, `MYSQL_PORT` (padrão 3306), `MYSQL_USER`, `MYSQL_PASSWORD`
- `MYSQL_DATABASE` — banco do tenant **padrão/master**
- `MYSQL_DATABASE_CENTRAL` — banco do **registro central de tenants** (pode ser o mesmo do master em setups de tenant único)
- `MYSQL_TENANT_PREFIX` — opcional (prefixo dos bancos criados por tenant)

> ⚠️ O usuário MySQL normalmente **não** tem privilégio `CREATE DATABASE` em hospedagem gerenciada — crie cada banco manualmente no painel/CLI do MySQL antes do primeiro start. Detalhes completos do corte de produção estão em [`MIGRACAO-MYSQL-STATUS.md`](MIGRACAO-MYSQL-STATUS.md).

> **Nunca** coloque esses valores no código nem no GitHub — só nas variáveis de ambiente do painel.

### E-mail (recuperação de senha)

Pra "Esqueci minha senha" enviar o e-mail de verdade, configure um SMTP (qualquer
provedor: Gmail, Hostinger, Brevo, SES...):

- `SMTP_HOST`, `SMTP_PORT` (padrão 587), `SMTP_USER`, `SMTP_PASS`
- `SMTP_FROM` (opcional) — ex.: `"Sua Loja" <naoresponda@seudominio.com.br>`
- `SMTP_SECURE=1` (opcional) — só se o provedor exigir TLS direto (geralmente porta 465)

Sem essas variáveis, o fluxo continua funcionando sem erro (nunca derruba o servidor),
mas o e-mail simplesmente não é enviado — fica registrado no log do servidor.

### Monitoramento de erro (Sentry, opcional mas recomendado)

Sem isso, um erro em produção só aparece se alguém reportar e você reproduzir manualmente
(foi assim que caçamos o bug do certificado A1 nesta sessão — deu trabalho). Com o Sentry,
o erro chega automaticamente com stack trace e contexto, sem precisar reproduzir nada.

1. Crie uma conta grátis em [sentry.io](https://sentry.io) (plano free cobre um app pequeno).
2. Crie um projeto **Node** — copie o DSN dele em `SENTRY_DSN`.
3. Crie um projeto **React** — copie o DSN dele em `VITE_SENTRY_DSN`.
4. Redeploy. Pronto — erros de backend e de tela branca no frontend caem automaticamente lá.

Sem essas variáveis, tudo continua funcionando normalmente, só sem o monitoramento.

### Primeiro login (servidor novo = banco vazio)

Um deploy novo sobe com o banco **vazio** — nenhuma loja, nenhum usuário. Não existe
cadastro público (por segurança), então em hospedagens gerenciadas (sem terminal/SSH
pra rodar `npm run seed` manualmente) adicione temporariamente:

- `SEED_ON_START=1`

Isso roda o seed de demonstração automaticamente no boot (é idempotente — seguro mesmo
que fique ligado por engano depois). Ele cria, entre outras, a conta:

- `admin@demo.com` / `admin123` — **super admin** (painel `/painel-admin`)
- `lojista@demo.com` / `lojista123` — loja de demonstração

**Depois do primeiro login**: troque a senha do super admin (ou crie o seu e apague o
de demo pelo próprio painel), e **remova a variável `SEED_ON_START`** — ela não precisa
ficar ligada permanentemente.

## 4. HTTPS (obrigatório)

Ative o **SSL** no domínio (Let's Encrypt, grátis). É obrigatório porque:
- Rastreio por GPS do entregador e Web Push só funcionam em HTTPS;
- O webhook do Mercado Pago exige URL pública HTTPS;
- NFC-e.

## 5. Persistência dos dados (IMPORTANTE)

Os dados de negócio ficam no **MySQL** (não mais em arquivo). O que ainda vive em disco,
na pasta `dados/`, são os **uploads** (fotos de produtos/banners/logos, em `dados/uploads/`)
e os **certificados A1** da NFC-e (`dados/certificados/`).

Em deploys gerenciados o disco às vezes **reseta a cada novo deploy** — o que apagaria os
uploads e os certificados (o MySQL, sendo externo ao processo, sobrevive):

- Prefira um **VPS** com disco próprio (foi a decisão deste projeto — ver
  [`MIGRACAO-MYSQL-STATUS.md`](MIGRACAO-MYSQL-STATUS.md)); ou garanta **armazenamento
  persistente** para a pasta `dados/`.
- Faça **backup periódico** do MySQL (`mysqldump`) e da pasta `dados/`.

**Schema do banco:** o registro central de tenants é criado no boot. O schema de negócio
(30 tabelas) é aplicado por banco com o script de verificação — rode uma vez por banco
recém-criado (com as env vars daquele banco):

```bash
node dist/backend/testar-schema-mysql.js
```

Para popular dados de demonstração, rode `npm run seed` (ou `SEED_ON_START=1` na primeira
subida — ver seção 3).

## 6. Multi-loja por domínio

O sistema resolve o tenant (a loja) pelo **domínio** de acesso. Aponte o domínio (e, se for
usar subdomínios por loja, um `*.seudominio` com `DOMINIO_BASE` configurado) para o app.
Cada tenant tem seu **próprio banco MySQL** (registrado na tabela central `tenants`), criado
manualmente e provisionado com o schema conforme a seção 5.

## 7. O que NÃO vai pro servidor

O **Agente de Impressão (LTNK)** roda no **PC de cada loja** (Windows), não no servidor.
O navegador do lojista fala com o agente em `localhost:9110`. Nada a fazer no deploy quanto a isso.
