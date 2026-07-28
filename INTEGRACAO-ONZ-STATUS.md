# Integração Pix ONZ/Planner — estado e como continuar

> Documento de passagem de bastão. Escrito ao fim de uma sessão em que a
> integração foi construída e **validada contra o sandbox real** da ONZ.
> Leia inteiro antes de mexer: tem três armadilhas da API que já custaram
> tempo e estão resolvidas — se você refizer sem saber, vai cair nelas de novo.
>
> Branch: **`migracao-mysql`** · último commit desta frente: **`60ec79f`**

---

## 1. O que é isso

A ONZ é um BaaS (banco como serviço) revendido pela **Planner SCD**. Foram
contratadas **duas APIs distintas**, com **certificados e credenciais separados**:

| Lado | O que faz | API | URL (sandbox/HMG) |
|---|---|---|---|
| **Cash-in** | *Receber* Pix (gera QR Code / cobrança) | QRCodes — padrão Bacen | `https://api.pix-h.plannerscd.com.br` |
| **Cash-out** | *Pagar* Pix (repasse a lojista, reembolso) | Accounts (proprietária ONZ) | `https://accounts-h.plannerscd.com.br/api/v2` |

Documentação oficial: <https://developers.onz.software/docs/intro> ·
Portal Finance (HMG): <https://finance.hmg.plannerscd.com.br/>

**Decisão de produto tomada:** a ONZ **conviva** com o Mercado Pago, escolhível
**por loja**. Nada do fluxo atual muda para quem não trocar de gateway.

---

## 2. ⚠️ As três armadilhas da API (já resolvidas — não regrida)

Nenhuma das três está na documentação. Cada uma gerou um commit próprio.

### 2.1 Os servidores usam CA privada e servem cadeia incompleta
Os hosts da ONZ apresentam **só o certificado folha**, assinado por uma **CA
privada deles** (`CN=ONZ-SECURE-AREA-PLANNER` no accounts, `CN=onz.software` no
qrcodes). O Node recusa com:

```
unable to verify the first certificate
```

**Solução (commit `401bbab`):** a CA vem **dentro do próprio `.pfx`** que eles
entregaram. `extrairCasDoPfx()` em `src/backend/onz.ts` extrai e passa em `ca:`.
A verificação TLS do servidor **continua ligada** — não use
`rejectUnauthorized: false` aqui.

### 2.2 As duas APIs usam formatos de auth DIFERENTES
Mandar o formato errado devolve `401 {"detail":"Credenciais inválidas APC-001"}`,
que parece credencial errada mas é só o formato:

| API | Corpo do `POST /oauth/token` |
|---|---|
| Accounts (cash-out) | `{ clientId, clientSecret, grantType }` — **camelCase** |
| QRCodes (cash-in) | `{ client_id, client_secret, grant_type }` — **snake_case** (Bacen) |

**Solução (commit `70f8056`):** `ConfigApi.estiloAuth: 'camel' | 'snake'`.

### 2.3 Path do cash-out
É `/pix/payments/dict` (não `/pix/dict`). Outros paths úteis da Accounts:
`/accounts/balances/`, `/accounts/transactions/`, `/pix/payments/qrc`,
`/pix/payments/manu`, `/pix/payments/{endToEndId}`, `/webhooks/cashout`.
Corrigido no commit `3651f79`.

---

## 3. O que JÁ FUNCIONA (validado contra o sandbox, não é teoria)

| Operação | Função | Resultado real obtido |
|---|---|---|
| Consultar saldo | `consultarSaldo()` | ✅ R$ 5.000,00 na conta HMG |
| Criar cobrança Pix | `criarCobranca()` | ✅ `status: ATIVA`, EMV copia-e-cola + QR PNG |
| Consultar cobrança | `consultarCobranca()` | ✅ status/pago/valorPago/e2eIds |
| Enviar Pix (cash-out) | `pixCashoutViaChave()` | ⚠️ **path corrigido, mas NUNCA executado** (ver §6) |

O EMV gerado traz o titular real da conta de homologação
(`UNIMAXX_SOLUCOES_EM_TECNO`), então é cobrança legítima — dá para pagar num app
de banco em homologação e ver virar `CONCLUIDA`.

### Arquitetura implementada

```
Checkout (rotas/cliente.ts)
   └─ criarCobrancaPix()            ← rotas/pagamentos.ts: PONTO ÚNICO de despacho
        ├─ gateway 'mercadopago' → criarPagamentoMercadoPago()   (fluxo antigo, intacto)
        └─ gateway 'onz'         → onz.criarCobranca()           (backend/onz.ts)

Confirmação:
   POST /api/pagamentos/webhook/mercadopago?t=<banco>            (já existia)
   POST /api/pagamentos/webhook/onz?tk=<token>&t=<banco>         (NOVO)
```

**Arquivos-chave:**
- `src/backend/onz.ts` — cliente das duas APIs (auth, mTLS, cash-in, cash-out)
- `src/backend/rotas/pagamentos.ts` — despacho por gateway + webhook ONZ
- `src/backend/schema-mysql.ts` — coluna `lojas.pagamento_gateway`
- `frontend/src/pages/lojista/loja-config.tsx` — UI de escolha do gateway

### Cuidados que já estão no código (não remova)
- **Idempotência:** o webhook usa `UPDATE ... WHERE pagamento_status <> 'aprovado'`.
  A ONZ re-tenta o webhook; sem isso o lojista seria notificado várias vezes.
- **Pagamento parcial não aprova:** se o Pix vier menor que o total, o pedido
  fica `aguardando` e loga — não libera pedido pago pela metade.
- **Tenant no webhook:** `?t=<banco>` resolve o tenant (modelo SILO, um banco por
  tenant). Sem isso a confirmação cairia no banco errado.
- **Token do webhook** comparado com `crypto.timingSafeEqual`.

---

## 4. 🔑 O que NÃO está no git (você precisa recriar na sua máquina)

Isto é o principal ponto de atenção da passagem de bastão. **Nada disso é
versionado** (`.env` e `dados/` são gitignored, corretamente):

### 4.1 Certificados
Extraia os dois `.pfx` dos zips recebidos por e-mail para
`dados/certificados/onz/`:

```bash
mkdir -p dados/certificados/onz
unzip -o -j "PLANNER_1_HMG_CASH_IN (1).zip" \
  "Certificados/PLANNER/HMG/QRCODES-MTLS/PLANNER_1.pfx" -d dados/certificados/onz/
mv dados/certificados/onz/PLANNER_1.pfx dados/certificados/onz/qrcodes.pfx

unzip -o -j "PLANNER_1_HMG_CASH_OUT.zip" \
  "Certificados/PLANNER/HMG/ACCOUNTS/PLANNER_1.pfx" -d dados/certificados/onz/
mv dados/certificados/onz/PLANNER_1.pfx dados/certificados/onz/accounts.pfx
```

Senha do `.pfx`: a que veio no e-mail (uma palavra, minúscula, nome da empresa
revendedora). Vai em `ONZ_CERT_SENHA`.

### 4.2 Variáveis de ambiente
Copie o bloco `ONZ_*` do `.env.example` para o seu `.env` e preencha. As
credenciais **estão no `.env` da máquina original** — copie de lá por um canal
seguro, ou gere novas (§4.3). Campos:

```
ONZ_CERT_SENHA=            # senha dos .pfx
ONZ_QRCODES_CLIENT_ID=     # cash-in  (23 dígitos)
ONZ_QRCODES_CLIENT_SECRET= # cash-in  (32 caracteres)
ONZ_PIX_KEY=               # chave Pix recebedora (UUID, veio junto da credencial)
ONZ_ACCOUNTS_CLIENT_ID=    # cash-out (UUID)
ONZ_ACCOUNTS_CLIENT_SECRET=# cash-out (UUID)
ONZ_WEBHOOK_TOKEN=         # você inventa: node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

As URLs já vêm preenchidas no `.env.example`.

### 4.3 Como gerar credenciais novas (se precisar)
No portal Finance → **Configurações**:

- **Aba "API CONTAS"** (cash-out) → *Nova credencial*. Marque **6 permissões**:
  Pix-Leitura, Pix-Escrita, Contas-Leitura, Transações-Leitura,
  Webhooks-Leitura, Webhooks-Escrita. Deixe **desligado**: Pix-Criação (é o
  fluxo `APPROVAL_REQUIRED`, não usamos), Boletos, Infrações, TED, Transf. internas.
- **Aba "API QRCODES"** (cash-in) → bloco **"Credenciais API Pix"** → botão
  **"Gerar Credenciais"** (ícone de cadeado). Não tem tela de permissões.
  ⚠️ **NÃO** clique em "Gerar QR Code de login" (segundo bloco) — aquilo é login
  do app QR Pago e devolve só um `{"code": ...}` inútil para a API.

⚠️ **Restrição de IP:** a credencial de cash-out foi criada travada em IPs.
Estão liberados o VPS (`179.197.76.76`) e — temporariamente, para os testes —
o IP residencial `187.87.101.41`. **Remova esse segundo** quando não precisar
mais, e **adicione o IP da sua máquina** se for testar de outro lugar (o erro é
claro: `IP x.x.x.x is not authorized`). A API QRCodes não pediu IP.

> Segurança: as credenciais e a senha do portal circularam por chat durante a
> integração. Como é ambiente de **homologação**, o risco é baixo, mas vale
> rotacionar a senha do portal Finance antes de ir para produção.

---

## 5. Como testar rápido (script pronto)

Crie na raiz do projeto, rode e apague (não commite):

```js
// _teste-onz.js
require('dotenv/config');
const onz = require('./dist/backend/onz');
(async () => {
  console.log('cash-in?', onz.cashInDisponivel(), '| cash-out?', onz.cashOutDisponivel());
  console.log('saldo:', (await onz.consultarSaldo()).disponivel);
  const c = await onz.criarCobranca({ pedidoId: 1, valorCentavos: 1990, descricao: 'Teste' });
  console.log('txid:', c.txid, '| status:', c.status);
  console.log('EMV:', c.copiaECola);
  console.log('consulta:', await onz.consultarCobranca(c.txid));
})();
```

```bash
npx tsc -p tsconfig.backend.json && node _teste-onz.js && rm _teste-onz.js
```

---

## 6. O QUE FALTA (em ordem de prioridade)

### 6.1 ✅ Consertar o build — RESOLVIDO (commit `881363e`)
Era um refactor pela metade em `frontend/src/pages/lojista/visual/index.tsx`:
`GRUPOS_VISUAL` já existia, mas a barra ainda iterava o antigo `ABAS_VISUAL`,
e o `tsc -b` falhava com `Cannot find name 'ABAS_VISUAL'`.

Fechado: a barra agora itera os grupos com um divisor entre eles. `npm run
build` na raiz (backend `tsc` + frontend `tsc -b` + `vite build`) passa com
exit 0.

O alerta do relatório continua válido como regra geral: **`vite build` isolado
não faz typecheck**. Quem valida é o `tsc -b` que roda antes dele em
`frontend/package.json`; rodar o vite direto esconde erro de tipo.

### 6.2 🟠 Registrar a URL do webhook na ONZ (sem isso a confirmação nunca chega)
É feito **uma vez por ambiente**, via `PUT /webhook/{chave}` na API QRCodes,
onde `{chave}` é a chave Pix (`ONZ_PIX_KEY`). Corpo: `{"webhookUrl": "..."}`.
A URL a registrar:

```
https://SEU_DOMINIO/api/pagamentos/webhook/onz?tk=<ONZ_WEBHOOK_TOKEN>&t=<BANCO_DO_TENANT>
```

Sugestão: criar `src/backend/registrar-webhook-onz.ts` (script de linha de
comando, no padrão dos `testar-*.ts` que já existem) para não fazer isso na mão.
Endpoints relacionados: `GET /webhook/{chave}` (conferir) e `DELETE` (remover).

Para o **cash-out** o webhook é outro: `POST /webhooks/cashout` na API Accounts
(formato proprietário, corpo `{uri, email, method, enabled, ...}`).

### 6.3 🟡 Testar o cash-out de verdade
`pixCashoutViaChave()` tem o path certo mas **nunca foi executado** — não quis
disparar transferência sem autorização explícita, mesmo em sandbox. Teste com
**R$ 0,01** para a chave Pix de teste. Confira depois em
`GET /pix/payments/{endToEndId}`. Há R$ 5.000 fictícios na conta.

### 6.4 🟡 Fluxo de repasse ao lojista
O cash-out está pronto como *função*, mas **não há tela nem regra de negócio**
que decida *quando* e *quanto* repassar. Hoje existe a tela Admin → Repasses,
que só **calcula** (faturamento − comissão). Falta ligar: botão "pagar repasse"
→ `pixCashoutViaChave()` → registrar a transação. Isso mexe com dinheiro real:
faça com trava de idempotência e confirmação dupla.

### 6.5 ⚪ Ir para produção
Trocar as URLs `-h`/`hmg` pelas de produção, gerar credenciais e certificados de
produção (outros `.pfx`), e revisar a restrição de IP. As URLs de produção não
estão nos YAMLs de homologação — pedir à Planner.

---

## 7. Pendência não relacionada (mas no mesmo diretório)

`public/mascote/entregador.mp4` (7 MB) está **untracked**. É o vídeo do CTA da
landing; a versão versionada está em `frontend/public/mascote/`. O de `public/`
é saída de build — pode apagar.

**RESOLVIDO — e o diagnóstico acima estava certo, era eu que tinha errado.**
O CTA da landing trocou o vídeo com chroma-key por foto estática (`d973598`),
mas naquele commit eu apaguei só a CÓPIA (`public/mascote/entregador.mp4`) e
deixei a ORIGEM (`frontend/public/mascote/entregador.mp4`) no repositório. Como
o `publicDir` do Vite é `frontend/public/` e ele copia tudo para `outDir:
'../public'`, o build seguinte regenerou o arquivo — daí ele "reaparecer"
untracked sozinho. Os 7 MB nunca tinham saído do git.

Agora a origem foi removida de verdade. Regra pra não repetir: asset da landing
mora em `frontend/public/`; o que está em `public/` é cópia gerada e volta a
cada build.

---

## 8. Contexto de segurança que foi respeitado (mantenha)

- Credenciais **só** em `.env` (gitignored). Certificados **só** em `dados/`
  (gitignored). Cada commit desta frente foi auditado com grep contra os
  valores reais antes do push — **zero segredo versionado**.
- O `.gitignore` foi reforçado antes disso para barrar `*.pfx`, `*.p12`, `*.key`
  e `certs/*.pem` em qualquer lugar do repo.
- Segredos de gateway ficam **criptografados no banco** quando por loja (veja
  `criptografar`/`descriptografar` em `src/backend/cripto.ts`, AES-256-GCM com
  chave derivada de `APP_SECRET`). As credenciais da ONZ são da *plataforma*, por
  isso vivem no ambiente e não no banco.
