# API de Catálogo do iFood — onde a documentação não bate com a API

Nove pontos em que o que **funciona** não é o que está **escrito**. Cada um foi
descoberto chamando a API de verdade e lendo o que ela recusou — não há atalho,
porque em oito dos nove casos a mensagem de erro não diz o que está errado.

Isto existe porque esse conhecimento estava espalhado em comentários de código.
Quem voltar aqui em três meses — inclusive eu — vai consultar a documentação
deles primeiro, encontrar o caminho errado, e perder o dia que este arquivo
economiza.

**Ambiente:** loja de sandbox, Catalog API v2.0, agosto de 2026. Se alguma
divergência for corrigida por eles, o teste correspondente falha — é assim que a
gente descobre.

---

## Resumo

| # | O que a doc diz | O que a API faz | Como falha |
|---|---|---|---|
| 1 | `GET /merchants/{id}/categories?include_items=true` | 404 de gateway | `no Route matched with those values` |
| 2 | `item.productId` é opcional | é obrigatório | `PostProductDto is not valid` |
| 3 | grupos dentro de `item` | grupos na **raiz** do payload | `FullItemDto is not valid` |
| 4 | (não mostra) | produto referencia grupo em `products[].optionGroups` | `FullItemDto is not valid` |
| 5 | (nenhum exemplo mostra) | grupo exige `optionGroupType` | grupo recusado |
| 6 | categorias vêm com os itens | `items: []` sempre | tela diz "não encontrei produtos" |
| 7 | (não menciona) | ids (UUID) são gerados por **quem chama** | `FullItemDto is not valid` |
| 8 | `PATCH /items/status` em lote | só `PATCH /items/{id}/status` | `PatchItemStatusDto is not valid` |
| 9 | `products[].optionGroups` = lista de ids | lista de **objetos** `{id,min,max,index}` | `FullItemDto is not valid` |

Repare na coluna da direita: **quatro erros diferentes produzem a mesma
mensagem** (`FullItemDto is not valid`). É por isso que cada um custou uma
rodada de tentativa e leitura, e por isso que o contraste entre casos foi o que
resolveu — item sem complemento passava, item com complemento falhava, e isso
apontou o lugar.

---

## 1. O caminho de categorias da documentação não existe

A página de Endpoints manda:

```
GET /catalog/v2.0/merchants/{merchantId}/categories?include_items=true
```

Responde **404 `no Route matched with those values`** — 404 de *gateway*, nem
chega na aplicação deles. O caminho real passa pelo catálogo, e é preciso listar
os catálogos antes para ter o id:

```
GET /catalog/v2.0/merchants/{merchantId}/catalogs
GET /catalog/v2.0/merchants/{merchantId}/catalogs/{catalogId}/categories
```

Uma loja tem mais de um catálogo, um por canal (`DEFAULT` = entrega,
`WHITELABEL` = cardápio digital, `INDOOR` = salão). Importar do canal errado
traz preço de salão para o cardápio de entrega.

**No código:** `ifood-catalogo.ts`, cabeçalho do arquivo e `catalogoDeEntrega`.

## 2. `productId` é obrigatório e não está documentado

O `POST` responde `PostProductDto is not valid`, sem dizer o que falta. O que
falta é o `productId` no item.

Vale entender o modelo, porque nada disso é óbvio: **item ≠ produto**. O item
carrega preço, status e categoria; o produto carrega nome e descrição; a opção
de complemento aponta para **outro produto**. Nada é aninhado — é tudo ligado
por id.

**No código:** `ifood-publicar.ts`, `montarPayloadItem`.

## 3. Os grupos ficam na raiz, não dentro do item

A documentação sugere `item.optionGroups`, e o **assistente de IA oficial deles
também** — foi a resposta que ele me deu, e estava errada. Os grupos vão na raiz
do payload, ao lado de `item`, `products` e `options`.

## 4. O produto referencia o grupo, e não o contrário

Quem liga o grupo ao item é o **produto**, via `products[].optionGroups`. Sem
essa referência o grupo é enviado e ignorado — o item nasce sem complemento e
sem erro.

## 5. `optionGroupType` é obrigatório e nenhum exemplo mostra

Valor `DEFAULT` para grupo comum. Sem ele o grupo é recusado.

## 6. A listagem de categorias devolve `items: []` — sempre

```
GET /catalogs/{catalogId}/categories   → categorias com items: []
GET /categories/{categoryId}/items     → os itens de verdade
```

Este foi o mais traiçoeiro dos nove: **não dá erro nenhum**. A resposta é 200 com
uma lista vazia, indistinguível de "esta categoria está vazia". Custou uma tela
dizendo *"não encontrei produtos no cardápio do iFood"* com um item cadastrado.

**No código:** `listarItensDaCategoria`, em `ifood-catalogo.ts`.

## 7. Os ids são gerados por quem chama

Item novo sem `id` responde `FullItemDto is not valid`. A API **não gera** os
ids: quem chama gera. Precisam de UUID o item, o produto principal, cada grupo,
cada opção e o produto de cada complemento.

Corolário que economiza um estrago: item que **já existe** tem que manter os ids
de lá. Id novo a cada publicação cria item duplicado no cardápio da loja e deixa
o antigo órfão.

## 8. Pausar item é por item, não em lote

O `PATCH /items/status` da documentação responde `PatchItemStatusDto is not
valid`. Testei quatro formatos de corpo — lista crua, envelopado em `items`,
`itemId` no lugar de `id`, e com `externalCode` — e os quatro foram recusados.

O que funciona:

```
PATCH /catalog/v2.0/merchants/{merchantId}/items/{itemId}/status
{ "status": "UNAVAILABLE" }
```

## 9. A referência do grupo é objeto, não id

`products[].optionGroups` não é `["uuid"]`, é:

```json
[{ "id": "uuid", "min": 0, "max": 2, "index": 0 }]
```

E `min`/`max` aparecem **duas vezes** no payload — na referência e no grupo. Os
dois têm que dizer a mesma coisa: divergir é mandar duas instruções conflitantes
na mesma requisição, e a API aceita uma delas sem avisar qual.

Junto deste: o produto de cada complemento precisa de `optionGroups: []`
explícito. Ausente, o item é recusado.

---

## A regra que nasceu disso

**Escrever contra payload real, nunca contra exemplo de documentação.**

`fixtures/ifood-item-flat.json` é um item de verdade, criado no sandbox e lido
de volta pelo `/flat`. Foi ele que resolveu as divergências 7 e 9 — a resposta
estava ali, em como a API descreve o que ela mesma aceitou.

E a outra, que valeu para as duas integrações:

**Assistente de IA oficial não é fonte.** O do iFood errou a posição dos grupos
e omitiu o `productId`. O que resolveu foi a coleção Postman oficial e, depois,
chamar e ler a recusa.

---

## Cuidado que continua valendo

`PUT /items` **substitui o item completo — campo omitido é campo removido.**
Isso não é divergência: está documentado, e é a coisa mais perigosa desta API.
Um item publicado sem o bloco de complementos apaga os complementos daquele item
no cardápio de verdade da loja, com o cliente comprando do outro lado.

É por isso que `montarPayloadItem` nunca monta payload do zero: lê o item como
está lá e sobrepõe só os campos que são nossos. Tudo que existe no iFood e não
existe no nosso modelo — `contextModifiers` com preço de outro canal, campos que
eles adicionarem amanhã — sobrevive por ser **copiado**, não por ser previsto.
Tem teste com um campo inventado que o arquivo não conhece, justamente para
provar que a proteção não é uma lista de campos conhecidos.
