# Deploy — Hostinger (Web app Node.js)

Guia pra subir o Delivery Multi-lojas na Hostinger usando a opção **"Web app Node.js"**
(implanta do GitHub). Também serve pra VPS.

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
- `APP_SECRET` — segredo forte e único (criptografia de dados sensíveis, ex.: senha do certificado)
- `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` — Web Push (gere com `npx web-push generate-vapid-keys`)
- `MP_ACCESS_TOKEN` — token do Mercado Pago (Pix), se for usar pagamento online

> **Nunca** coloque esses valores no código nem no GitHub — só nas variáveis de ambiente do painel.

## 4. HTTPS (obrigatório)

Ative o **SSL** no domínio (Let's Encrypt, grátis). É obrigatório porque:
- Rastreio por GPS do entregador e Web Push só funcionam em HTTPS;
- O webhook do Mercado Pago exige URL pública HTTPS;
- NFC-e.

## 5. Persistência dos dados (IMPORTANTE)

O banco é **arquivo** (SQLite na pasta `dados/`), junto com o certificado A1 da NFC-e.
Em deploys gerenciados, o disco às vezes **reseta a cada novo deploy** — o que apagaria tudo.

- Confirme no painel da Hostinger se há **armazenamento persistente** (volume que não some no redeploy)
  e garanta que a pasta `dados/` fique nele.
- Faça **backup periódico** da pasta `dados/`.
- Se não houver disco persistente confiável, use um **VPS** (controle total do disco).

O servidor cria a pasta `dados/` e o schema do banco automaticamente no primeiro start
(tabelas via `CREATE TABLE IF NOT EXISTS`). Para popular dados de demonstração, rode uma vez:
`npm run seed` (opcional).

## 6. Multi-loja por domínio

O sistema resolve o tenant (a loja) pelo **domínio** de acesso. Aponte o domínio (e, se for
usar subdomínios por loja, um `*.seudominio`) para o app na Hostinger. Cada tenant tem seu
próprio banco em `dados/tenants/`.

## 7. O que NÃO vai pro servidor

O **Agente de Impressão (LTNK)** roda no **PC de cada loja** (Windows), não no servidor.
O navegador do lojista fala com o agente em `localhost:9110`. Nada a fazer no deploy quanto a isso.
