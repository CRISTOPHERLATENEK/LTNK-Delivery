# Maxx Gestão (Meu ERP Online) — API Pública

Terceiro emissor possível da NFC-e, junto do nosso servidor e da maquininha.
Aqui o ERP tem o certificado e a numeração: o pedido do delivery vira documento
lá e a nota sai de lá.

**O que só este caminho oferece:** o documento aceita `tefLista` (NSU, bandeira,
tipo de cartão) e `pagamentoLista`. É o único dos três em que a NFC-e pode sair
com a forma de pagamento REAL, em vez do "todo cartão é crédito" que
`tipo-pagamento-nfce.ts` declara por palpite.

## Acesso

- **Servidor único:** `https://api.meuerponline.com.br/publica`. Homologação x
  produção é configuração da empresa DENTRO do ERP, não host separado.
- **Header:** `Authorization: Authentication {token}` — **não é `Bearer`**. Com
  Bearer a resposta é 401 e a mensagem não diz o motivo.
- **Token não expira.** Nasce no painel do ERP; não existe endpoint que o
  emita. `POST /api/usuario/validar/v1` só valida e-mail/senha, não devolve
  credencial. Guardamos cifrado em `lojas.maxxgestao_token`.
- **Limite: 20 requisições por minuto POR TOKEN**, fila de 10, HTTP 429 ao
  estourar. Implementado em `maxxgestao-cliente.ts` (balde de fichas + fila por
  token).
- **A documentação (swagger) exige login próprio**, diferente do token: o spec
  fica em `/publica/swagger/publica/swagger.json` e só abre com a sessão da doc.
  Por isso este arquivo existe — para não depender daquele login.

## A empresa (Unimaxx, conferido em 02/09/2026)

`GET /api/empresa/v1` — é o nosso teste de conexão, porque devolve algo que a
pessoa RECONHECE (razão social e CNPJ). Token da conta errada só apareceria na
primeira nota emitida no CNPJ de outra empresa.

- UNIMAXX SOLUCOES EM TECNOLOGIA LTDA · CNPJ 48.935.328/0001-26 · Joinville/SC
- **CRT 1 = Simples Nacional** → CSOSN, não CST.

`GET /api/empresa/configuracoes/v1`:

| campo | valor | serve para |
|---|---|---|
| `idPessoaPadrao` | 5 | consumidor final padrão — **não precisamos espelhar clientes** |
| `idTabelaPrecoPadrao` | 1 | Preço Varejo |
| `idPagamentoTroco` | 1 | — |

## Tabelas auxiliares (estado real da conta)

| tabela | endpoint | conteúdo |
|---|---|---|
| Natureza de operação | `/api/natureza-operacao/v1` | 79; a **1** é "VENDA DE MERCADORIA DENTRO DO ESTADO", CFOP 5102 |
| Seção | `/api/mercadoria-secao/v1` | 1 = Geral |
| Grupo | `/api/mercadoria-grupo/v1` | **6 = Restaurantes**, 7 SERRARIA, 8 Insumos, 9/10 Produtos |
| Subgrupo | `/api/mercadoria-subgrupo/v1` | 35; 1 = Geral |
| Marca | `/api/mercadoria-marca/v1` | 1 MOBIL, 2 FIAT |
| Perfil tributário | `/api/perfil-tributario/v1` | **4.323**; 1 TRIBUTADA, 2 ISENTA, 3 SUBSTITUIDA, 4 OUTRAS OPERAÇÕES |
| Tabela de preço | `/api/tabela-preco/v1` | 1 Preço Varejo, 2 e 3 promocionais |

`/api/natureza-operacao/1/pagamentos/v1` volta **lista vazia** — as formas de
pagamento ainda não estão ligadas nessa natureza. Isso trava a emissão e é
configuração no portal deles.

Não existe `/api/mercadoria-tipo/v1` (foi chute meu; 404). De onde vem o
`idTipo` da mercadoria segue desconhecido.

## Emitir a nota: três passos

1. `POST /api/documento/v1` — cria. `modelo` aceita só **PA, PV, OC, CN** (não
   fiscais); usamos `PV` (pedido de venda).
2. `POST /api/documento/{id}/transformar/v1` — "Transforma um documento para
   modelo fiscal".
3. `POST /api/documento/{id}/emitir/v1` — emite. Sem corpo, só o id na rota.

Depois: `GET /api/documento/{id}/xml/v1` e `/pdf/v1`;
`POST /api/documento/{id}/contingencia/v1`, `/regerar/v1`, `/status/v1`.

### O corpo do documento

Blocos: `documento`, `pessoa`, `transporte`, `intermediador`, `pedido`,
`mercadoriaLista`, `servicoLista`, `pagamentoLista`, **`tefLista`**,
`parcelaLista`, `boletoLista`, `chequeLista`.

- `documento`: `idNaturezaOperacao`, `modelo`, `serie`, `numero`, `dataHora`,
  `status` (R, E, C, V, I, O, X, Z — assume R), **`idExterno`**.
- `pedido`: `idExterno`, `status`, `tipoEntrega`, `dtEntrega`,
  `idPessoaEntregador`, `tipoConsumo` — o bloco é feito para delivery.
- `mercadoriaLista[]`: exige **`idMercadoriaVariacao`** (não aceita descrição
  livre), `qtd`, `valUnitarioBruto/Liquido`, `valTotalBruto/Liquido`.
- `pagamentoLista[]`: `idPagamento`, `valor`, `valAcrescimo`, `valDesconto`.
- `tefLista[]`: `nsu`, `tipoCartao`, `idBandeira`, `tBand`, `numParcelas`,
  `valorTransacao`, `idAdquirente`, `cnpjAdministradora`, `taxa`…

**`idExterno` é a nossa idempotência**: gravamos o id do nosso pedido e
consultamos antes de criar de novo. Sem isso, uma retentativa gera dois
documentos fiscais para a mesma venda.

## Puxar o cardápio do ERP (Fase 2) — implementado

A direção é do ERP **para** o delivery, decisão do dono do projeto: assim o
perfil tributário já vem vinculado ao produto e o `codigoMercadoriaVariacao` que
o documento exige vem de graça — sem nenhum palpite fiscal nosso.

**O endpoint é `GET /api/mercadoria/v1?page=N&limit=50`**, que devolve o produto
INTEIRO (52 campos). Mil produtos = 20 requisições = um minuto.

> **Registro de um caminho errado que parece razoável.** A primeira versão usou
> `mercadoria-catalogo → categorias → /{id}/mercadorias`. Aquele último devolve
> só INTEIROS (`PublicaPagedResponseInt32`), obrigando um GET por produto: 137
> produtos, 137 requisições, sete minutos — e uma importação em lotes puxada
> pela tela só para caber no limite. A diferença entre os dois endpoints não
> está na documentação.

**A categoria vem do subgrupo da mercadoria** (`/api/mercadoria-subgrupo/v1`),
com o grupo como reserva. Não existe endpoint que ligue item a categoria de
catálogo — só listar as categorias e, separadamente, os ids do catálogo inteiro.
Nesta conta o grupo é "Restaurantes" para tudo, enquanto o subgrupo separa
SALGADINHOS, DOCES, CONSERVAS, que é o que serve de categoria num cardápio.

`POST /api/lojista/erp/importar` faz tudo numa requisição. Três regras no
planejador (`maxxgestao-importar.ts`), as mesmas da sincronização do iFood:

1. **Nunca mexe no preço.** Mora no delivery, e o ERP nem devolve preço de
   venda. Reimportar não pode desfazer quem precificou o cardápio.
2. **Nunca apaga.** Produto que saiu do catálogo é pausado — excluir levaria
   embora o histórico de pedidos que aponta para ele.
3. **Nunca publica sozinho.** Produto novo entra pausado a R$ 0,01,
   visivelmente errado de propósito; qualquer valor plausível passaria batido e
   seria vendido por esse valor.

E uma específica daqui: **produto que nasceu no delivery
(`maxxgestao_variacao_id = 0`) não é tocado.** Sem essa condição, a primeira
importação pausaria o cardápio inteiro que o lojista montou à mão.

### O buraco: PREÇO DE VENDA

**Nenhum endpoint de leitura devolve preço de venda.** `PublicaMercadoriaResponse`
(52 campos) não tem; `mercadoria-custo` só tem `valCusto` e `valCustoMedio`; e
`/api/mercadoria-tabela-preco/v1` é **PUT apenas** — dá para gravar preço, não
para ler.

**Decidido: o preço mora no delivery.** O ERP manda descrição, NCM e perfil
tributário; quem define quanto custa no app é o lojista — o que combina com o
delivery ser o canal de venda, já que preço de delivery costuma ser diferente do
balcão. Produto importado nasce a R$ 0,01 e pausado até alguém precificar.

Se algum dia fizer diferença, cabe pedir ao suporte um endpoint de LEITURA da
tabela de preço; hoje só existe o PUT.

## O que falta (Fase 3)

Criar o documento do pedido: `POST /documento` como `PV` com
`idExterno` = id do nosso pedido → `transformar` → `emitir` → guardar chave e
XML. Depende de duas coisas fora do código:

- as formas de pagamento ligadas na natureza de operação (hoje
  `/natureza-operacao/1/pagamentos` volta vazio);
- produtos importados e precificados, para o `idMercadoriaVariacao` existir.
