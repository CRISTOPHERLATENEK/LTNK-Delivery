# Cardápio iFood ↔ nosso — mapeamento

Levantado contra a documentação e contra a **API de verdade**, com a loja de
sandbox. Nada foi escrito ainda.

Decisão de produto já tomada: **dois módulos distintos**, e o lojista escolhe.
Quem já mantém o cardápio no iFood quer **importar**; quem mantém aqui quer
**publicar**. Forçar um só obrigaria metade dos lojistas a trabalhar em dobro.

---

## 1. Duas coisas que só apareceram chamando a API

### 1.1 O caminho da documentação está errado

A página de Endpoints manda:

```
GET /catalog/v2.0/merchants/{merchantId}/categories?include_items=true
```

Isso responde **404 `no Route matched with those values`** — 404 de gateway, nem
chega na aplicação. O caminho que funciona passa pelo catálogo:

```
GET /catalog/v2.0/merchants/{merchantId}/catalogs                      → 200
GET /catalog/v2.0/merchants/{merchantId}/catalogs/{catalogId}/categories → 200
```

É a segunda divergência que encontro na documentação deles (a primeira foi o
limite de ACK, 2000 numa página e 10000 na outra). Vale a regra: **o que a doc
diz é hipótese até uma chamada confirmar.**

### 1.2 O catálogo do sandbox está VAZIO

`catalogs` devolve um catálogo (`ade4dd8e-…`, contexto `DEFAULT`), e
`categories` devolve `[]`. Mesmo assim os pedidos de teste vêm com
`PRODUTO 1` e `PRODUTO 2 (COMBO)` — eles existem para gerar pedido, mas não
aparecem no catálogo pela API.

**Consequência prática:** não dá para escrever o importador contra um payload
real agora, e escrever contra o exemplo da documentação é exatamente o que
produziu os três defeitos da etapa 3 (preço sem complemento, taxa de serviço,
quantidade NaN) — todos pegos só porque havia um pedido de verdade.

---

## 2. Por que isto importa agora, e não "algum dia"

Os dois itens do pedido de teste entraram com `produto_id` **nulo**: o
`externalCode` do iFood (`7838`, `4707`) não bate com nenhum `codigo_barras`
nosso. Sem casar produto:

- não há baixa de estoque;
- o item não tem ficha, categoria, nem dados fiscais nossos;
- o relatório por produto ignora tudo que veio do iFood.

Qualquer um dos dois módulos resolve isso, porque os dois criam a
correspondência. É o argumento mais forte para fazer, e não é "seria bom ter".

---

## 3. Módulo A — Importar (iFood → nós)

Para o lojista que já tem o cardápio montado lá.

```
GET  /catalogs                          → qual catálogo e contexto
GET  /catalogs/{id}/categories          → categorias
GET  /items/{id}/flat                   → item com produto, grupos e opções
GET  /catalogs/{id}/sellableItems       → só o que está à venda
```

**Leitura pura.** Não altera nada no iFood, então o pior caso é criar produto
errado aqui — reversível, ao contrário do módulo B.

O que precisa ser decidido antes de escrever:

| Questão | Por que não é óbvia |
| --- | --- |
| Item que **já existe** aqui | Casar por `externalCode`↔`codigo_barras`, por nome, ou criar duplicado? Duplicar cardápio é pior que não importar |
| Preço | O do iFood costuma ser maior (embute a comissão). Importar o preço de lá para o cardápio próprio faz o cliente direto pagar a comissão que não existe |
| Foto | O iFood devolve URL do CDN deles. Copiar para o nosso disco ou apontar para lá? Apontar economiza espaço e quebra se eles mudarem |
| Contexto | `DEFAULT` (entrega), `WHITELABEL` (cardápio digital), `INDOOR`. Preço e disponibilidade diferem por contexto; o nosso cardápio não tem esse conceito |

**Recomendação:** importar **nome, descrição, categoria e complementos**, e
deixar o **preço em branco** para o lojista definir. É a diferença entre uma
ferramenta que poupa digitação e uma que sabota a margem do cardápio próprio.

---

> **A documentação desta API erra em nove pontos.** Cada um está registrado em
> [ifood-api-divergencias.md](./ifood-api-divergencias.md), com o que a doc diz,
> o que a API faz e como falha. Leia antes de escrever qualquer chamada — em
> oito dos nove casos a mensagem de erro não diz o que está errado, e quatro
> deles produzem a mesma mensagem.

## 4. Módulo B — Publicar (nós → iFood)

Para o lojista que mantém o cardápio aqui.

```
POST  /categories          → cria categoria
PUT   /items               → item + produtos + grupos + opções, numa chamada
PATCH /items/price         → só preço, em lote
PATCH /items/status        → pausar/reativar
GET   /batch/{batchId}     → lote roda ASSÍNCRONO; consultar até COMPLETED
```

**Aqui erro apaga cardápio de produção.** A documentação é explícita: *"PUT
/items substitui o item completo — campos omitidos são removidos."* Um item
publicado sem o bloco de complementos apaga os complementos daquele item no
iFood.

O `PUT` é idempotente, o que ajuda no retry. Mas idempotente com payload
errado significa "erra igual todas as vezes".

Duas coisas que mudam o desenho:

**O lote é assíncrono.** `PATCH /items/price` devolve `batchId` e a doc avisa
para consultar `GET /batch/{batchId}` até `COMPLETED` **antes de assumir que
aplicou**. Uma resposta com `failureCount: 5` é sucesso parcial — e sucesso
parcial em preço é item vendendo pelo valor errado.

**Contextos, de novo.** Publicar sem declarar contexto atinge o `DEFAULT`. Se a
loja usa Cardápio Digital com preço diferente, `contextModifiers` precisa ser
preservado — e o `PUT` que omite apaga.

---

## 5. Estruturas que não mapeiam um-para-um

Pizza e combo têm modelagem própria no iFood, com páginas separadas na
documentação. O nosso já tem combo (`combo_itens`) e sabores fracionados
(`fracoes`), mas os conceitos não coincidem.

**Não tentar cobrir os dois no primeiro corte.** Item simples com complementos
já resolve a maioria do cardápio, e pizza mal mapeada é pedido com sabor errado
saindo da cozinha.

---

## 6. O que falta para eu escrever

Um **produto de verdade no catálogo do sandbox**, com pelo menos um grupo de
complementos. Hoje ele está vazio.

Sem isso eu estaria escrevendo contra o exemplo da documentação — que é
exatamente o que produziu os três defeitos da etapa 3, todos pegos só porque
havia um pedido real para conferir. O padrão que funcionou nas cinco etapas
anteriores foi: ler o payload verdadeiro, escrever o teste contra ele, e deixar
a sabotagem provar que o teste vale.

Ordem sugerida, quando houver dado:

1. Cliente HTTP de leitura + mapeamento do payload real (testável sem rede)
2. Módulo A (importar), com preço em branco
3. Casar os pedidos que já entraram sem `produto_id`
4. Módulo B (publicar), só depois de A rodando — é o que escreve em produção
