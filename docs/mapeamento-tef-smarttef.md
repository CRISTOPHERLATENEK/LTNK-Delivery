# Integração TEF (Smart TEF) — mapeamento

Levantamento feito contra o código em produção e a documentação pública em
`docs.smarttef.com.br`. Nada aqui foi escrito ainda: é o desenho e as decisões
que precisam ser tomadas **antes** de escrever, mais o que já sei que vai doer.

Ainda faltam duas coisas que não dependem de mim: a **base URL da API** (não
está na doc pública, vem no credenciamento) e os **dois tokens** por loja.

> **Correção, 31/08/2026.** As duas frases acima estavam erradas, e o custo foi
> um dia inteiro.
>
> A base URL **está** na documentação pública — na página de cada endpoint,
> dentro do exemplo cURL. Eu li quatro páginas de visão geral, não encontrei, e
> concluí pela ausência.
>
> E a cobrança na maquininha **não precisa** dos tokens do portal Smart TEF:
> passa por `POST /v3/smart-tef/newItem` em `api.poscontrole.com.br`, com a
> MESMA autenticação do PDV MOBI (JWT + chave OCP) que a loja já tem. Informado
> pelo suporte da POS Controle.
>
> Antes disso eu havia sondado `POST /v2/sales`, `/v2/sale` e `/v2/orders`,
> recebido 404 nos três, e concluído que a API não recebia venda. A conclusão
> valia para o `/v2`; generalizar para a API inteira foi apressado — o grupo
> `smart-tef` vive em `/v3` e não aparece na coleção Postman.
>
> A lição, que vale para a próxima API: **404 em três caminhos que eu inventei
> não é prova de ausência.** É prova de que os três caminhos que eu inventei não
> existem.

---

## 1. O que muda de verdade

O ganho óbvio é o operador não digitar o valor na maquininha. Não é o principal.

O principal está em [`tipo-pagamento-nfce.ts`](../src/backend/tipo-pagamento-nfce.ts),
num comentário que já admite a dívida:

> `cartao_entrega`: maquininha do entregador. O sistema não conversa com ela,
> então não há como saber se foi crédito ou débito sem alguém informar.

Hoje **todo cartão de PDV sai na NFC-e declarado como crédito por palpite**, sem
bandeira e sem NSU. O código marca isso honestamente (`ehPalpite: true`) e existe
até um teste chamado *"maquininha na entrega é palpite"*. A SEFAZ autoriza
normalmente, porque 03 é código válido — o erro só aparece em fiscalização.

A API devolve exatamente o que falta: `card_brand`, `nsu_host`,
`autorization_code`, `acquirer`, `acquirer_cnpj`.

**Ou seja: o entregável não é conveniência de digitação, é documento fiscal
correto.** Isso muda a prioridade e muda o que precisa ser testado.

---

## 2. Como a API funciona

Não é pinpad nem cabo serial. É HTTP, e a maquininha faz *polling* do lado dela:

```
  nosso PDV                     API Smart TEF                  Smart POS
     │                                │                            │
     │ POST .../erp/order/create      │                            │
     │───────────────────────────────>│  registra o card           │
     │<─ payment_identifier ──────────│───────────────────────────>│ card aparece
     │                                │                            │ na tela
     │                                │                     operador confirma
     │                                │                     cliente passa cartão
     │                                │<───────────────────────────│
     │<── webhook: status + NSU ──────│                            │
```

Endpoints que interessam:

| O quê | Endpoint |
| --- | --- |
| Criar cobrança | `POST /smarttef/commands/erp/order/create` |
| Consultar | `POST /smarttef/pooling/erp/order/get` |
| Cancelar pendente | `POST /smarttef/commands/erp/order/status/cancelar` |
| Estornar concluída | `POST /smarttef/commands/erp/order/status/estornar` |
| Configurar webhook | `POST /smarttef/manager/erp/store/update` |

Autenticação em dois headers: `Authorization: Bearer <token da loja>` e
`ocp-apim-subscription-key: <gateway token>`.

Estados: `PDT` → `PROC_PAG` → `CNC` (ok) · `REJ_PAG` (recusado) · `CAN_ERP`
(cancelado por nós). Estorno: `SOL_EST` → `PROC_EST` → `EST` · `REJ_EST`.

---

## 3. O ponto que decide o projeto: a venda passa a ser assíncrona

Hoje `POST /balcao` ([lojista.ts:2273](../src/backend/rotas/lojista.ts)) é
**síncrona**: recebe os itens, grava o pedido, devolve. O operador escolhe
"Cartão" no [balcao.tsx:560](../frontend/src/pages/lojista/balcao.tsx) e pronto —
o sistema nunca soube se o cartão passou.

Com TEF existe uma espera de 10 a 60 segundos **com o cliente na frente**, e ela
pode terminar em recusa. Isso não é detalhe de implementação, é uma mudança de
natureza da tela.

E aqui está o risco que eu não quero que passe despercebido:

> **Se a venda só for gravada depois do "aprovado", uma queda de rede entre o
> cartão passar e a resposta chegar produz cliente cobrado e venda inexistente.**

É o pior desfecho possível — pior que venda duplicada, porque some do sistema e
ninguém procura o que não sabe que existe.

### Decisão proposta: gravar antes, confirmar depois

1. `POST /balcao` grava o pedido com `pagamento_status = 'aguardando'`
   (valor que **já existe** no CHECK da tabela `pedidos`).
2. Cria a ordem TEF e guarda o `payment_identifier`.
3. A tela entra em "aguardando maquininha", com o pedido **já existente**.
4. Webhook (ou polling) resolve para `aprovado` ou `recusado`.
5. Recusado → a venda fica visível e cancelável, nunca desaparece.

O `pagamento_status` de `pedidos` já tem os quatro estados de que precisamos.
Não é preciso inventar máquina de estado nova — só passar a usar a existente no
PDV, que hoje nasce sempre em `na_entrega`.

---

## 4. Banco

### 4.1 Reaproveitar em vez de criar

`pedidos` já tem, do Mercado Pago:

```
pagamento_status      -- 'na_entrega','aguardando','aprovado','recusado'
pagamento_gateway     -- passa a aceitar 'smarttef'
pagamento_gateway_id  -- recebe o payment_identifier
```

Serve. Não vou criar tabela paralela para o mesmo conceito.

### 4.2 O que falta: os campos fiscais

Estes não têm onde morar hoje, e são a razão de ser do projeto:

```sql
tef_nsu           VARCHAR(40) NOT NULL DEFAULT ''
tef_autorizacao   VARCHAR(40) NOT NULL DEFAULT ''
tef_bandeira      VARCHAR(30) NOT NULL DEFAULT ''
tef_adquirente    VARCHAR(60) NOT NULL DEFAULT ''
tef_adquirente_cnpj VARCHAR(20) NOT NULL DEFAULT ''
tef_tipo          VARCHAR(10) NOT NULL DEFAULT ''  -- CREDIT | DEBIT | PIX | VOUCHER
```

Via `garantirColuna`, como as outras.

*Correção do que eu havia escrito aqui antes:* eu disse que estas colunas
precisavam de `${SUFIXO_TABELA}` e `COLLATE` explícito. Não precisam — aquilo
vale para `CREATE TABLE`, e `ALTER TABLE ... ADD COLUMN` herda a colação da
tabela. O tombo do `subcategorias` foi em CREATE TABLE, onde declarar `CHARSET`
sem `COLLATE` **resseta** para o padrão do charset; aqui não se declara nenhum
dos dois, então não há o que ressetar.

### 4.3 Credenciais por loja

Segue o padrão de `mercadopago_token` / `onz_client_secret` em `lojas`:

```sql
smarttef_token          TEXT     -- Bearer da loja
smarttef_gateway_token  TEXT     -- ocp-apim-subscription-key
smarttef_base_url       TEXT     -- host, ainda desconhecido
smarttef_serial_pos     VARCHAR(40)  -- terminal padrão, quando houver
```

**Eu não preencho esses campos.** Entrego o comando; você executa.

---

## 5. Multi-tenant: onde o webhook quase dá errado

É SILO — um banco por tenant. O webhook do Smart TEF chega num host só e precisa
saber **em qual banco** gravar. O padrão já resolvido está no webhook do Mercado
Pago ([pagamentos.ts:1104](../src/backend/rotas/pagamentos.ts)): a URL registrada
carrega `?t=<banco>`, validado contra o registro de tenants antes de trocar de
contexto — *nunca abrir banco arbitrário a mando de quem chamou o webhook*.

O Smart TEF permite URL de webhook por loja (`webhookUrl.url` +
`authorization_token`) no `store/update`. Então dá para registrar já com o
`?t=<banco>&loja=<id>`, e o mesmo cuidado se aplica.

**Diferença importante do MP:** lá, o conteúdo da notificação é ignorado e o
status é **reconsultado** na API antes de valer. Aqui deve ser igual — receber o
webhook, e confirmar por `pooling/erp/order/get` antes de marcar aprovado. Um
POST forjado não pode aprovar venda.

---

## 6. Caixa e conciliação

[`caixa.ts`](../src/backend/caixa.ts) já separa `dinheiro_centavos`,
`cartao_centavos` e `pix_centavos`, e o fechamento só cobra conferência do
dinheiro — cartão fecha pelo extrato da adquirente, como diz a tela hoje:

> Confira estes valores pelo extrato da maquininha e do banco, não pela gaveta.

Com NSU e adquirente gravados, essa conferência deixa de ser "confie no extrato"
e passa a ser conciliável linha a linha. **Não vou fazer isso agora** — é um
segundo projeto, e misturar os dois atrasa o que importa (a nota).

Fica registrado que passa a ser possível.

---

## 7. Ordem de execução

| # | Etapa | Depende de |
| --- | --- | --- |
| 1 | Colunas + credenciais por loja + tela de configuração | nada — **feita** |
| 2 | Cliente HTTP do Smart TEF, isolado e testável sem rede | ~~base URL~~ nada — **feita** |
| 3 | `POST /balcao` cria ordem e grava `aguardando` | 1, 2 |
| 4 | Webhook + reconsulta + resolução de status | 3 |
| 5 | Tela de espera no Balcão (recusa, cancelamento, timeout) | 3 |
| 6 | Mesma coisa em `comandas/:id/fechar` | 3–5 |
| 7 | **NFC-e passa a usar o dado real** e o palpite morre | 4 |
| 8 | Estorno via `order/status/estornar` | 4 |

A etapa 7 é o objetivo. As seis primeiras existem para viabilizá-la.

*Correção:* eu havia posto a etapa 2 como dependente da base URL. Não é — o
cliente é **parametrizado** pela base URL, que vem da linha da loja em tempo de
chamada. Ele foi escrito e testado inteiro sem ela. O que depende do valor real
é testar contra a API de verdade, que é outra coisa.

---

## 8. O que precisa ser testado, e que hoje não é

Anotando porque é onde eu erraria se não anotasse:

- **Recusa.** É o caminho comum (cartão sem limite), não a exceção. Tem que
  deixar a venda utilizável, não travada nem sumida.
- **Timeout.** Operador desiste, cliente vai embora. Precisa de
  `order/status/cancelar` e de um estado final, senão a venda fica pendurada.
- **Webhook duplicado.** Todo webhook chega duas vezes um dia. Aprovar duas
  vezes não pode baixar estoque duas vezes — a idempotência do `POST /balcao`
  protege a criação, não a confirmação.
- **Webhook forjado.** Só reconsulta na API decide.
- **Estorno.** Caminho **nunca testado** no sistema, com ou sem TEF. Já estava
  na minha lista de pendências antes disto.
- **`tipoPagamentoNfce`.** O teste "maquininha na entrega é palpite" vai mudar de
  sentido: com TEF, `cartao_entrega` deixa de ser palpite quando há `tef_tipo`.
  Continua palpite quando não há — lojista sem TEF não pode regredir.

---

## 9. Antes de prometer ao lojista

A tabela de homologação lista, por adquirente **e por modelo de terminal**, qual
versão está liberada em cada produto (PDV.MOBI, Smart TEF V2, POS Controle).
REDE, Cielo, Getnet, Stone, PagBank, SafraPay, Vero e Sipag aparecem; várias
linhas estão como "sob consulta" ou "em certificação".

**Confirmar a dupla adquirente + modelo do lojista antes de vender a
integração.** Não é toda maquininha que aceita.

---

## Quem emite a NFC-e: o servidor ou a maquininha

Coluna `lojas.nfce_emissor` — `'sistema'` (padrão) ou `'maquininha'`. É **por
loja**: isto é uma plataforma, e as outras lojas continuam emitindo pelo
servidor sem ninguém tocar em nada.

### `sistema` (padrão)
A maquininha só **cobra**. Sobe para o aparelho o que precisa de cartão na
porta (`cartao_entrega`) e nada mais — um pedido já pago que subisse viraria
cobrança na mão do entregador, e o cliente pagaria duas vezes. A NFC-e é
emitida automaticamente na entrega, por `emitirNfcePedido`.

### `maquininha`
A maquininha **cobra e emite**. `emitirNfcePedido` desiste antes de reservar
número (emitir nos dois lugares daria duas notas para a mesma venda), e:

- **Todo** pedido sobe como preconta, inclusive Pix e cartão online — uma venda
  que não chega lá é uma venda **sem nota fiscal**.
- Pedido já pago sobe no status **`pronto`**, não na saída: a nota tem que ir
  dentro da sacola.
- A descrição desses chega no aparelho marcada **`· PAGO`**. É uma trava, não
  um enfeite: na tela do aparelho uma preconta paga é idêntica a uma cobrança
  de verdade, e o operador precisa ver antes de escolher a forma que este é
  Faturado, não crédito.
- `PUT /api/lojista/tef` **recusa** ligar o modo sem TEF ligado e configurado.
  Sem credencial nada chega no aparelho, e o resultado não é uma tela de erro:
  é uma sequência de vendas sem nota que ninguém percebe até o contador
  perguntar.
- `POST /nfce/emitir/:pedidoId` (o botão do lojista) continua funcionando **de
  propósito**: é a saída para o dia em que o aparelho estiver fora do ar.

### `IDPagamento` do `newItem`: manda LIVRE

**A tabela** (suporte POS Controle, Anderson Duarte, 02/09/2026):

| valor | forma |
|---|---|
| `1` | Débito |
| `2` | Crédito |
| `3` | Voucher |
| `6` | Pix |

**Faturado NÃO pode ser pré-definido no card** — palavras dele: *"Não é
possível criar um card com forma de pagamento Faturado."* Formas como Dinheiro
e Faturado precisam estar habilitadas no portal, e aí o card enviado **sem
forma ("LIVRE")** permite selecioná-las na própria máquina.

**Por isso não mandamos o campo.** Antes ia `'1'` fixo, do exemplo oficial — e
`1` é Débito. Resultado: todo pedido subia declarado como débito (dinheiro, Pix,
cartão online), e a maquininha abria pedindo o cartão porque nós mandávamos ela
pedir.

Valores fora da tabela são recusados DENTRO de um HTTP 200:
`{"responseCode":"401.03","msg":"Erro na insercao."}`. Foi assim que os pedidos
97 (com `'99'`) e 98 (com um GUID de `/v2/paymenttypes`) gravaram "lançado na
maquininha" no log e nunca chegaram. `'99'` foi testado como texto, como número,
sem `QTParcelas` e sem `Extras` — recusado em todos.

`/v2/paymenttypes` é outra numeração (GUIDs, e nem tem "Débito" na lista): é o
domínio do relatório de vendas, não deste campo.

### O `tPag` do "Faturado"
Confirmado por escrito pelo suporte da POS Controle (Gabriela Bahia,
31/08/2026), com o trecho do XML:

```xml
<tPag>99</tPag>
```

99 = "Outros". É o código correto para uma venda cujo dinheiro entrou por fora
do PDV — que é exatamente o caso do pedido pago no app. A forma pode ser
renomeada para "Externo" em `unimaxx.pdv.mobi → Configuração de Pagamento →
Faturado → Descrição Faturada`; o `tPag` **não** é configurável por lá, é fixo
do tipo Faturado.

**O que ainda não foi verificado contra uma nota real:** ninguém leu um XML
emitido de verdade por este caminho. Quando a primeira venda for finalizada
como Faturado no aparelho, vale ler a venda de volta em
`GET /v2/sales` e conferir o `XMLautURL`.
