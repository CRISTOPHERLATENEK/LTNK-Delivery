# Integração Pix ONZ/Planner — estado e como continuar

> Documento de passagem de bastão. Escrito ao fim de uma sessão em que a
> integração foi construída e **validada contra o sandbox real** da ONZ.
> Leia inteiro antes de mexer: tem três armadilhas da API que já custaram
> tempo e estão resolvidas — se você refizer sem saber, vai cair nelas de novo.
>
> Branch: **`migracao-mysql`** · último commit desta frente: **`3d6053f`**

---

## 1. O que é isso

A ONZ é um BaaS (banco como serviço) revendido pela **Planner SCD**. Foram
contratadas **duas APIs distintas**, com **certificados e credenciais separados**:

| Lado | O que faz | API | URL (sandbox/HMG) |
|---|---|---|---|
| **Cash-in** | *Receber* Pix (gera QR Code / cobrança) | QRCodes — padrão Bacen | `https://api.pix-h.plannerscd.com.br` |
| **Cash-out** | *Pagar* Pix (estorno, pagamentos) | Accounts (proprietária ONZ) | `https://accounts-h.plannerscd.com.br/api/v2` |

Documentação oficial: <https://developers.onz.software/docs/intro> ·
Portal Finance (HMG): <https://finance.hmg.plannerscd.com.br/>

### 1.1 ⭐ Modelo de negócio: UMA CONTA POR CLIENTE

Decisão tomada (e já implementada — commit `3d6053f`): **cada restaurante abre a
própria conta na Planner** (um CNPJ, uma conta, uma chave Pix) e **recebe
direto**. A plataforma **não intermedeia o dinheiro** — o que evita a
obrigação de repasse e a exposição regulatória de virar intermediário de
pagamento.

Consequências desse desenho, todas já refletidas no código:

| O que | Onde fica |
|---|---|
| `client_id` / `client_secret` / chave Pix | **Por loja**, em `lojas.onz_*` (secret criptografado, AES-256-GCM) |
| **Certificado mTLS** | **ÚNICO da integração** (confirmado com a Planner) — segue no ambiente, `dados/certificados/onz/` |
| Registro do webhook | **Por chave Pix**, logo por loja — feito **automaticamente** ao salvar as credenciais no painel |
| Repasse (cash-out) | **Deixou de fazer sentido**: cada lojista já recebe o seu. Cash-out sobra para estorno e pagamentos próprios |

Se a loja **não** tiver conta própria, tudo cai na conta da plataforma (`.env`) —
fallback que mantém funcionando quem já estava rodando antes disso existir.

**Decisão de produto:** a ONZ **convive** com o Mercado Pago, escolhível por
loja. Isso não é só flexibilidade: abrir conta na Planner leva **dias** (KYC),
enquanto o Mercado Pago é imediato. Então o MP é a porta de entrada (o lojista
vende no primeiro dia) e a ONZ é a opção para quem quiser migrar depois.

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
| Consultar webhook | `consultarWebhookCashIn()` | ✅ responde (nenhum registrado ainda) |

O EMV gerado traz o titular real da conta de homologação
(`UNIMAXX_SOLUCOES_EM_TECNO`), então é cobrança legítima — dá para pagar num app
de banco em homologação e ver virar `CONCLUIDA`.

### Arquitetura implementada

```
Checkout (rotas/cliente.ts)
   └─ criarCobrancaPix()            ← rotas/pagamentos.ts: PONTO ÚNICO de despacho
        ├─ gateway 'mercadopago' → criarPagamentoMercadoPago()   (fluxo antigo, intacto)
        └─ gateway 'onz'         → onz.criarCobranca({ cred })   ← cred = conta DA LOJA
                                     (sem cred → conta da plataforma, fallback)

Estorno (lojista.ts → estornarPagamentoPix)
        ├─ 'mercadopago' → estornarPagamentoMercadoPago()
        └─ 'onz'         → onz.devolverCobranca(txid, cred)  ← MESMA conta que recebeu

Confirmação:
   POST /api/pagamentos/webhook/mercadopago?t=<banco>            (já existia)
   POST /api/pagamentos/webhook/onz?tk=<token>&t=<banco>         (NOVO)
        ?t= é só uma DICA: se o txid não estiver nesse tenant, varre os demais
```

**Arquivos-chave:**
- `src/backend/onz.ts` — cliente das duas APIs (auth, mTLS, cash-in, cash-out).
  Toda operação de cash-in aceita `CredenciaisLoja` opcional.
- `src/backend/rotas/pagamentos.ts` — despacho por gateway, `credenciaisOnzDaLoja()`,
  webhook ONZ com resolução automática de tenant
- `src/backend/schema-mysql.ts` — `lojas.pagamento_gateway` + `lojas.onz_*`
- `src/backend/rotas/lojista.ts` — GET/PUT `/pagamentos` (credenciais + registro
  automático do webhook)
- `src/backend/registrar-webhook-onz.ts` — CLI (só para a conta da plataforma;
  as contas das lojas se registram sozinhas pelo painel)
- `frontend/src/pages/lojista/loja-config.tsx` — UI: escolha do gateway e
  formulário "Sua conta Planner"
- `src/backend/rotas/pagamentos.test.ts` — testes de roteamento de estorno

### Cuidados que já estão no código (não remova)
- **Idempotência:** o webhook usa `UPDATE ... WHERE pagamento_status <> 'aprovado'`.
  A ONZ re-tenta o webhook; sem isso o lojista seria notificado várias vezes.
- **Pagamento parcial não aprova:** se o Pix vier menor que o total, o pedido
  fica `aguardando` e loga — não libera pedido pago pela metade.
- **Tenant resolvido sozinho:** `?t=` é só uma dica; se o txid não estiver lá, os
  outros tenants são varridos. É isso que permite registrar a URL **uma vez** e
  atender todo cliente novo sem mexer no servidor. Um tenant com banco fora do ar
  não impede os outros de confirmar.
- **Estorno na conta certa:** a devolução usa as credenciais **da loja** que
  recebeu. Sem isso, tentaria devolver da conta da plataforma (onde o txid não
  existe) e o cliente ficaria sem o dinheiro — bug real, já corrigido e coberto
  por teste. **Não** troque `devolverCobranca(txid, cred)` por `devolverCobranca(txid)`.
- **Credencial ilegível não derruba o checkout:** se o `APP_SECRET` for trocado,
  `credenciaisOnzDaLoja()` devolve null (cai no fallback) em vez de estourar.
- **Ativar 'onz' sem credencial é revertido** para `mercadopago`, para a loja não
  ficar com Pix "ligado" e quebrado.
- **Token do webhook** comparado com `crypto.timingSafeEqual`, e mascarado em
  todo output (a URL registrada *contém* o token).

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
seguro, ou gere novas (§4.3).

> ℹ️ Estas são as credenciais da **conta da plataforma** — o *fallback*. No
> modelo atual (§1.1) cada loja cadastra a própria conta pelo painel, e essas
> credenciais ficam no banco (`lojas.onz_*`), não aqui. O `ONZ_CERT_SENHA` e os
> `ONZ_*_CERT` valem para **todas** as contas (certificado único da integração).

Campos:

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
  **"Gerar Credenciais"** (ícone de cadeado). Não tem tela de permissões. Devolve
  `CLIENT ID` (23 dígitos), `CLIENT SECRET` (32 caracteres) e a `CHAVE PIX`.
  ⚠️ **NÃO** clique em "Gerar QR Code de login" (segundo bloco) — aquilo é login
  do app QR Pago e devolve só um `{"code": ...}` inútil para a API.
  ⚠️ O secret aparece **uma única vez**: copie pelo botão de copiar (o campo é um
  `<input>` e o texto transborda — selecionar com o mouse pega valor incompleto).

> **É esse o caminho que cada CLIENTE vai seguir** para conectar a conta dele:
> ele gera na aba QRCODES do portal *dele* e cola no nosso painel
> (Pix → "Sua conta Planner"). O registro do webhook acontece sozinho no save.

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

### 6.2 ✅ Webhook — automatizado por loja; a conta da plataforma usa o CLI

**Por loja (o caso normal):** nada a fazer. Quando o lojista conecta a conta dele
no painel (Pix → "Sua conta Planner"), o sistema **registra o webhook dele
automaticamente** com as credenciais dele (`rotas/lojista.ts`, PUT `/pagamentos`).
Foi assim justamente para não precisar rodar script no servidor a cada cliente.

**Para a conta da plataforma (fallback)**, o CLI existe:

```bash
npm run build
node dist/backend/registrar-webhook-onz.js --conferir              # inspeciona, não altera
node dist/backend/registrar-webhook-onz.js https://maxxtalk.com.br # registra
```

O CLI mascara o token no output, recusa URL não-HTTPS e **recusa domínio
placeholder** (aprendido na prática: a ONZ aceita registrar um domínio que não
existe, então colar `https://SEU_DOMINIO` "funcionava" e o pagamento nunca
confirmava — falha silenciosa).

Estado no ambiente de homologação: o webhook da plataforma chegou a ser
registrado com o placeholder; **conferir e re-registrar** com o domínio real
(`https://maxxtalk.com.br`, validado: HTTPS ok e o endpoint responde 200).

⚠️ O webhook de **cash-out** é registrado apontando para
`/api/pagamentos/webhook/onz-cashout`, mas **essa rota ainda não existe** no app
(o cash-out não está ligado a nenhum fluxo). Criar junto com o §6.4.

### 6.3 🟠 Perguntas em aberto com a Planner (podem exigir ajuste)

Duas respostas ainda não chegaram e afetam o desenho:

**a) Limite de URLs por chave Pix.** O `PUT /webhook/{chave}` **sobrescreve** o
registro anterior. Se um cliente já usa a ONZ com outro sistema, nosso registro
automático **apagaria a integração dele** sem avisar. Perguntar se uma chave
aceita mais de uma URL. Se aceitar só uma, considerar avisar o lojista na tela
antes de conectar.

**b) Onboarding.** Pelas duas specs recebidas, **não existe API de abertura de
conta** (só `GET` de saldo/extrato) e a doc diz *"Request a account create on
Finance platform"* — ou seja, é manual, com KYC. Confirmar se existe uma API de
onboarding fora desses arquivos. Se não existir, o cadastro do cliente na ONZ
**nunca será self-service** — e é por isso que o Mercado Pago continua sendo a
porta de entrada.

### 6.4 🟡 Testar o cash-out de verdade
`pixCashoutViaChave()` tem o path certo mas **nunca foi executado** — não quis
disparar transferência sem autorização explícita, mesmo em sandbox. Teste com
**R$ 0,01** para a chave Pix de teste. Confira depois em
`GET /pix/payments/{endToEndId}`. Há R$ 5.000 fictícios na conta.

⚠️ O webhook de cash-out aponta para `/api/pagamentos/webhook/onz-cashout`, mas
**essa rota ainda não existe**. Criar junto com o primeiro uso real do cash-out.

### 6.5 ⚪ Repasse ao lojista — FORA DE ESCOPO no modelo atual
Com **conta por cliente**, cada lojista recebe direto: **não há repasse a fazer**,
e a plataforma não intermedeia o dinheiro. A tela Admin → Repasses continua
servindo como *relatório* (faturamento − comissão), para você cobrar a
mensalidade/comissão por fora.

O cash-out sobra para: **estorno** (já implementado via `devolverCobranca`) e
pagamentos seus a partir da conta da plataforma.

Isto só volta a ser necessário se o modelo mudar para conta única da plataforma.

### 6.6 ⚪ Ir para produção
Trocar as URLs `-h`/`hmg` pelas de produção, gerar credenciais e certificado de
produção (outro `.pfx` — **um só**, é da integração), e revisar a restrição de IP
(remover o IP residencial `187.87.101.41`, deixar só o do VPS). As URLs de
produção não estão nos YAMLs de homologação — pedir à Planner.

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
