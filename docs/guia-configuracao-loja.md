# Guia de configuração da loja

Para o lojista montar a loja certa da primeira vez.

Este guia não lista funções — lista **as decisões que, tomadas erradas, só
aparecem depois**, com o cliente esperando. A ordem é a de quem está começando:
cada passo depende do anterior.

O caminho de cada tela aparece assim: **Mais → Configurações → Horário**.

---

## Antes de tudo: o endereço da loja

**Mais → Configurações → Dados**

O campo **slug** é o endereço público: `suadominio.com.br/pizzaria-do-ze`.

Alguns nomes são recusados — `pedidos`, `carrinho`, `conta`, `admin`, `api`,
entre outros. Não é frescura: esses endereços já pertencem ao aplicativo, e uma
loja chamada `pedidos` **desapareceria** — o link abriria a tela de pedidos do
cliente. O sistema recusa e diz qual escolher.

> **Trocar o slug depois quebra links já distribuídos.** QR code impresso,
> perfil do Instagram, mensagem fixada no grupo. Escolha antes de divulgar.

---

## 1. Horário

**Mais → Configurações → Horário**

### Intervalo entre almoço e janta

Cada dia aceita **mais de um turno**. Quem fecha das 15h às 18h clica em
**+ fechar no intervalo** e declara `11:00–15:00` e `18:00–23:00`.

Com um turno só, seria preciso declarar `11:00–23:00` — e a loja ficaria
**aberta às 16h**, recebendo pedido com a cozinha vazia.

### Turno que vira a madrugada

`18:00` às `02:00` funciona. Não declare `18:00–23:59` mais `00:00–02:00`: o
sistema entende a virada sozinho.

### Horário automático: o que "Fechar agora" faz

Com o automático ligado, os dois botões são diferentes:

| botão | efeito |
|---|---|
| **Fechar agora** | pausa de **2 horas** — depois a loja reabre sozinha |
| **Encerrar o dia** | fecha até a **próxima abertura da agenda** |

"Fechar agora" existe para a pausa curta: fila cheia, faltou insumo. Numa noite
fraca, use **Encerrar o dia** — senão você vai embora e a loja reabre sozinha
duas horas depois, aceitando pedido que ninguém vai preparar.

A mensagem diz a hora exata em que ela reabre. Leia antes de sair.

---

## 2. Categorias e a ordem do cardápio

**Produtos** (a própria lista) e **Mais → Categorias**

A ordem do cardápio se ajusta **na lista de produtos**, arrastando — não no
cadastro do item. Cada categoria e cada faixa de subcategoria tem uma alça `⠿` e
setas `↑↓` (as setas existem porque arrastar não funciona em tela de toque).

Vale para os três níveis: **categoria**, **subcategoria** e **produto** dentro da
faixa.

> **As alças somem quando há busca ou filtro ativo.** É proposital: com meia
> lista na tela, "põe na 2ª" mandaria uma posição que não é a real, e o cardápio
> se embaralharia. Clique em **Todas** para ordenar.

A primeira fileira é a primeira que o cliente vê ao abrir o cardápio. Ponha ali o
que sustenta a casa, não o que o alfabeto escolheu.

---

## 3. Produtos

**Produtos → + Novo produto**

O cadastro tem cinco abas, na ordem do trabalho:

| aba | o que é |
|---|---|
| **Item** | o que o cliente vê: nome, foto, preço, categoria |
| **Complementos** | o que ele escolhe: tamanho, sabores, borda, adicionais |
| **Composição** | de que este produto é feito (só combos usam) |
| **Configurações** | como o item se comporta: estoque, canais, destaque |
| **Fiscal** | NCM, CFOP, CSOSN — a maioria nunca abre |

Todo campo obrigatório vive na aba **Item**. Se o salvar reclamar, é lá.

### Fotos

Suba a foto que você tem. O sistema **reduz sozinho** no envio — acima de 600 KB
ele recomprime.

A foto aparece **inteira**, sem corte. Isso significa que foto em pé numa moldura
quadrada mostra faixa branca dos lados. Se a maioria das suas fotos for em pé,
mude o formato da moldura em **Mais → Configurações → Visual** em vez de refazer
as fotos.

> Foto muito pesada é o maior peso do cardápio. Um logo de 1,5 MB sozinho pode
> ser metade do que o cliente baixa.

---

## 4. Complementos: a parte que economiza (ou custa) mais trabalho

**Produto → aba Complementos**

### Grupo compartilhado é o ponto

Um grupo de complementos — "Sabores", "Borda", "Tamanho" — **pode servir vários
produtos ao mesmo tempo**.

É o que separa uma pizzaria organizada de uma bagunça:

| | 30 pizzas com grupo próprio | 30 pizzas ligadas ao mesmo grupo |
|---|---|---|
| subir o Catupiry R$ 1 | 30 edições | **1 edição** |
| sabor novo | 30 vezes | **1 vez** |
| um sabor esgotou | 30 vezes | **1 vez** |

**Duplicar um produto LIGA ao mesmo grupo**, não copia. É de propósito: as 30
pizzas de uma pizzaria nascem de duplicação, e copiar recriaria a dor inteira.

Quando **uma** delas precisar ser diferente — só ela tem borda recheada —, use
**soltar deste produto**. Isso clona o grupo só para ela, e as outras 29
continuam juntas.

> Antes de editar um grupo, olhe quantos produtos usam. O painel mostra. Mudar
> preço ali muda em todos.

### Obrigatório significa obrigatório em todo canal

Grupo marcado como obrigatório **impede fechar o pedido** — no aplicativo, no
balcão e na mesa. Não é possível lançar uma pizza sem sabor por nenhum caminho.

### Tamanho que libera sabores

Um grupo com papel **Tamanho** pode dizer quantos sabores cada opção libera:
"Grande" libera 2, "Família" libera 4. O limite de sabores passa a depender do
tamanho escolhido, sem você configurar duas vezes.

O **modo de preço** do grupo de sabores decide a conta:

| modo | como cobra |
|---|---|
| **somar** | soma o adicional de cada sabor escolhido |
| **maior** | cobra só o adicional do sabor mais caro |
| **proporcional** | divide pelo número de pedaços |

Pizzaria costuma usar **maior** ou **proporcional**. Com **somar**, uma pizza de
4 sabores caros fica impagável.

---

## 5. Combos

**Produto → aba Composição**

Um combo é um produto normal com **itens dentro**. Cada item vira um bloco
próprio na tela do cliente, com os complementos dele.

### O componente não aparece no cardápio

Ao criar a "Pizza Broto 25cm" que existe só dentro do combo, desligue
**vender avulso** na aba Configurações. Ela continua existindo para o combo e
some do cardápio.

> Não use "pausado" para isso. Pausado quer dizer *temporariamente fora*, e o
> painel vai mostrar assim — mentindo sobre o motivo.

### O que o sistema recusa

- **Combo dentro de combo** — bloqueado ao montar a composição.
- **Excluir um produto que é componente** — recusado, dizendo de quais combos
  ele faz parte. Remova da composição antes.

Isso vale também para a exclusão em massa: os componentes são **pulados** e a
tela diz quais foram.

### Estoque

Vender um combo **baixa o estoque dos componentes**. Dois slots da mesma pizza
consomem duas unidades. Se um componente esgotar, o combo para de vender.

---

## 6. Entrega

**Mais → Configurações → Entrega**

Taxa por bairro, mais uma taxa padrão para o que não estiver na lista. Digite o
bairro e o sistema sugere a distância — o número que ninguém tem de cabeça.

O bairro digitado e **ainda não adicionado** se perde ao sair da tela. O sistema
avisa antes.

---

## 7. Pagamentos

**Mais → Configurações → Pagamentos**

Cada loja usa a **própria conta** — não há token compartilhado.

Há dois modos, **teste** e **produção**, com um token cada. Comece pelo teste:
ele exercita o fluxo inteiro (QR, confirmação, pedido entrando, cupom) **sem
mover dinheiro**. Só depois troque para produção.

> As credenciais são gravadas mascaradas e o painel nunca mostra o token
> completo de volta. Guarde o original onde você o gerou.

Um caminho que quase nunca é testado e vale testar uma vez: **recusar um pedido
já pago estorna o dinheiro automaticamente**. Se você nunca recusou um pedido
pago, esse caminho nunca rodou na sua loja.

---

## 8. Fiscal

**Mais → Configurações → Fiscal**

O certificado digital vale **um ano**. Vencido, a emissão de NFC-e para no mesmo
dia.

O painel avisa no **Início** a partir de 30 dias antes, e muda de tom na última
semana. Não espere o aviso virar vermelho: certificado se renova com
antecedência, e a fila do balcão não espera.

---

## 9. Impressão

**Mais → Configurações → Impressão**

Escolha a largura da bobina (80 ou 58 mm) e o rodapé do cupom.

A impressão passa por um **agente instalado no computador da loja**. Se a
impressora parar, verifique primeiro se o agente está rodando e se o computador
e a impressora estão na **mesma rede** — é a causa mais comum, e não aparece
como erro no painel.

---

## 10. Quem entra no painel

**Mais → Configurações → Usuários**

Crie um login por pessoa, não uma senha para todos. Cada usuário recebe só as
áreas que precisa — quem opera o caixa não precisa ver relatório de faturamento.

> Usuário criado **antes** deste recurso tem acesso total até você definir as
> áreas dele. Vale revisar a lista uma vez.

Em **Segurança**, ative a verificação em duas etapas do dono. Ela é o que segura
o painel quando uma senha vaza.

---

## Ordem sugerida para uma loja nova

1. **Dados** — nome, slug, endereço
2. **Horário** — turnos e automático
3. **Categorias** — criar e ordenar
4. **Produtos** — os mais vendidos primeiro
5. **Complementos** — montar o grupo compartilhado UMA vez, depois duplicar
6. **Entrega** — bairros
7. **Pagamentos** — modo teste, depois produção
8. **Usuários** — um login por pessoa
9. **Fiscal e Impressão** — quando for emitir nota

Os passos 1 a 5 já deixam a loja vendendo. Do 6 em diante dá para fazer com a
loja no ar.
