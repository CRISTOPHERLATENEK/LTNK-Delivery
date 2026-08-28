# Integração iFood — mapeamento

Levantamento contra `developer.ifood.com.br` (lido em 28/08/2026) e o código em
produção. Nada foi escrito ainda.

**Este projeto é de outra natureza do TEF.** O Smart TEF é uma chamada que a
gente faz quando quer. O iFood é um serviço que **precisa da gente de pé o tempo
todo** — e isso muda tudo, inclusive se vale a pena.

---

## 1. Antes de qualquer coisa: a loja fica offline se o nosso servidor cair

Da documentação de polling, em uma frase:

> O merchant fica online enquanto sua integração realiza polling a cada 30
> segundos. Se o polling parar, o merchant perde o status online.

Ou seja: **quem mantém a loja aberta no iFood passa a ser o nosso servidor.**
Deploy demorado, PM2 reiniciando, rede da VPS oscilando — qualquer um desses
tira a loja do ar no iFood, e o lojista perde venda sem entender por quê.

Hoje o nosso deploy **não é atômico** e derruba o site enquanto o build roda.
Isso é aceitável para o cardápio próprio, onde o cliente recarrega a página. Não
é aceitável para uma responsabilidade que a gente estaria assumindo em nome do
lojista.

**Isto não é motivo para desistir — é a primeira coisa a resolver.** Mas precisa
ser resolvido *antes* de a primeira loja real ser ligada, não depois.

---

## 2. O que a API é

Base: `https://merchant-api.ifood.com.br`

Não recebemos um "pedido novo" pronto. Recebemos **eventos** e vamos buscar o
resto:

```
  a cada 30s
  ┌──────────────────────────────────────────────────────┐
  │  GET /events/v1.0/events:polling                     │
  │       ↓ 200 (lista) ou 204 (nada)                    │
  │  persistir localmente                                │
  │       ↓                                              │
  │  POST /events/v1.0/events/acknowledgment             │
  │       ↓                                              │
  │  GET /orders/{id}  ← itens, valores, endereço        │
  └──────────────────────────────────────────────────────┘
```

Autenticação OAuth 2.0, `client_credentials`:

```
POST /authentication/v1.0/oauth/token
grantType=client_credentials&clientId=...&clientSecret=...
→ accessToken (JWT), expiresIn 21600  (6 horas)
```

Aplicativo **centralizado** não recebe refresh token — vence, pede outro. É o
fluxo certo para nós: servidor próprio, segredo guardado no servidor.

Módulos além de Order: Catalog (cardápio), Merchant (loja e horários), Financial
(conciliação), Shipping, Review, Logistics, Analytics.

---

## 3. As regras que quebram integração ingênua

Todas estão escritas na documentação. Cada uma corresponde a um jeito de perder
pedido, e nenhuma delas dá erro na hora.

| Regra | O que acontece se ignorar |
| --- | --- |
| **Eventos vêm fora de ordem** — ordenar por `createdAt` | Processa "cancelado" antes de "criado" e o pedido nasce cancelado |
| **Eventos vêm duplicados**, inclusive `PLACED` antigo | Pedido criado duas vezes. A doc é explícita: *"Se receber PLACED repetido, não crie novo pedido"* |
| **ACK depois de persistir**, nunca antes | ACK e queda no mesmo segundo = pedido perdido para sempre, e o cliente esperando |
| **ACK em TODO evento**, inclusive nos que não usamos | Vira *strike*; 100 strikes = polling bloqueado por 5 min |
| **Retenção de 8 horas** | Nosso servidor fora do ar por 8h+ perde os pedidos definitivamente |
| **Outros apps na mesma loja** | O lojista pode usar o Gestor de Pedidos do iFood junto. Recebemos eventos que **outro device** gerou — e não podemos tratá-los como nossos |

Sobre o throttling: a documentação diz *"será implementada a partir de
02/04/2026"*. **Essa data já passou** — hoje é 28/08/2026. Então está valendo,
não é futuro.

**Achei uma contradição na própria documentação:** a seção de acknowledgment diz
*"Limite: até 2000 IDs por requisição"* e a referência da API do mesmo endpoint
diz *"Máximo 10000 eventos"* (com 413 acima disso). Vou implementar com o menor
dos dois — 2000 — e deixar registrado o porquê, porque parece erro de quem
escreveu e não quero descobrir qual é o certo em produção.

---

## 4. Onde encaixa no nosso sistema

### 4.1 O que já serve

`pedidos.origem` é `VARCHAR(10) DEFAULT 'app'`. `'ifood'` cabe. Não precisa de
tabela nova para o pedido em si.

### 4.2 O que falta

Credenciais **no nível da plataforma**, não da loja — o `clientId`/`clientSecret`
são do nosso aplicativo, não do lojista. Isso é diferente do Mercado Pago e do
Smart TEF, onde cada loja tem a própria conta.

Por loja, o que muda é o `merchantId` do iFood e o consentimento:

```sql
-- em `lojas`
ifood_merchant_id   VARCHAR(60)  -- UUID da loja no iFood
ifood_ativo         TINYINT      -- o lojista autorizou e quer receber

-- tabela nova: eventos já processados, para deduplicar
ifood_eventos_vistos (id VARCHAR(60) PRIMARY KEY, criado_em VARCHAR(32))
```

A tabela de eventos vistos é a única estrutura realmente nova, e existe por causa
da regra dos duplicados. Precisa de limpeza periódica — 8h de retenção do lado
deles significa que guardar mais que uns dias aqui é lixo acumulando.

### 4.3 O laço de polling

*Eu havia escrito aqui que este seria o primeiro processo contínuo do sistema e
que o cluster PM2 faria as 3 instâncias pollarem juntas. **As duas coisas estão
erradas** — conferi o código depois de escrever.*

Já existem 8 laços contínuos (`sincronizarHorarios` a cada 60s, reconciliação de
Pix e de cartão a cada 5 min, vencimento de assinatura a cada 6h), e o problema
do cluster **já está resolvido** em `server.ts`:

```ts
const instancia = process.env.NODE_APP_INSTANCE;
const rodarTarefas = instancia === undefined || instancia === '0';
```

Os jobs rodam só na instância 0; as outras duas só atendem HTTP. O laço do iFood
entra no mesmo bloco e herda isso de graça.

O que **continua sendo problema** é outra coisa, e é específica do iFood: esses
laços existentes são redes de segurança — se um ciclo falhar, o próximo
conserta. O polling do iFood não é rede de segurança, é o **único** caminho de
entrada do pedido, e falhar em silêncio significa pedido não recebido com o
cliente esperando. Precisa de alarme, não só de `console.error`.

Multi-tenant continua valendo: são N bancos, cada um com M lojas, e o header
`x-polling-merchants` aceita **100 merchants por requisição** — a doc manda
agrupar sequencialmente dentro do mesmo ciclo de 30s.

---

## 5. O caminho até produção não é técnico

| Fase | O que é |
| --- | --- |
| 1. Setup | Criar conta no portal, pegar `clientId`/`clientSecret`. Vem com loja e app de teste |
| 2. Sandbox | Pedido de teste, receber eventos, consultar pedido. **Aqui dá para ir longe sem falar com ninguém** |
| 3. Produção | Criar app de produção → **homologação** → solicitar acesso **loja por loja** → operar |

Duas coisas que travam e não dependem de código:

- **Conta CPF não é aceita para homologação.** Só CNPJ. Está escrito na página de
  critérios.
- **Cada loja precisa de aprovação individual.** Não é ligar uma vez e valer para
  todos os lojistas da plataforma.

E a homologação testa **o aplicativo inteiro**, não chamadas soltas: confirmação
de pedido dentro do SLA, tratamento de cancelamento, resposta em tempo hábil.

---

## 6. Recomendação

Fazer a **fase 2 inteira** (sandbox) antes de qualquer conversa comercial. Ela
não custa nada, não depende de aprovação, e responde a pergunta que importa: o
laço de polling se comporta bem em cluster e multi-tenant?

Antes de ligar a primeira loja **real**, resolver o deploy não-atômico. Não é
scope creep: enquanto o deploy derrubar o servidor, ligar o iFood significa
fechar a loja do lojista a cada atualização nossa.

O que eu **não** faria agora: Catalog (sincronizar cardápio nos dois sentidos é
um projeto do tamanho deste) e Financial. Order + Events primeiro, e só.

---

## 7. Comparação honesta com o TEF

| | Smart TEF | iFood |
| --- | --- | --- |
| Quem chama | Nós, quando queremos | Nós, a cada 30s, para sempre |
| Se nosso servidor cair | PDV volta a digitar o valor na mão | **A loja fica offline no iFood** |
| Credencial | Por loja | Da plataforma + consentimento por loja |
| Barreira para produção | Credenciamento comercial | Homologação do app inteiro + CNPJ + aprovação loja a loja |
| Processo contínuo | Não | Sim — e o único que, falhando, perde pedido |

O TEF era um recurso. O iFood é uma responsabilidade operacional.
