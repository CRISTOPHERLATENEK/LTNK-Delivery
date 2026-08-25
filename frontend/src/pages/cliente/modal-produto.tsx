/**
 * Modal de montagem do produto: tamanho (radio), borda, adicionais (checkbox).
 * Recalcula o preço em tempo real conforme as escolhas.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { precoVigente, promocaoVigente } from '@/lib/preco-produto';
import { Minus, Plus, Check, AlertCircle, ChevronDown, X } from 'lucide-react';
import {
  Sheet, SheetContent, SheetFooter,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { brl } from '@/lib/format';
import { cn } from '@/lib/utils';
import { adicionarAoCarrinho, vooCarrinho } from '@/lib/carrinho';
import { useToast } from '@/components/ui/toast';
import type { GrupoOpcoes, Loja, OpcaoItem, Produto } from '@/types';
import { saboresLiberados, maxEscolhasEfetivo, precoDoGrupo, agruparPorSecao, contarFracoes } from '@/lib/opcoes-preco';
import { montarSlots, chaveEscolha, escolhasParaEnvio, faltandoPorSlot, ehCombo } from '@/lib/slots-produto';

interface Props {
  produto: Produto;
  loja: Loja;
  aberto: boolean;
  onFechar: () => void;
}

export function ModalProduto({ produto, loja, aberto, onFechar }: Props) {
  /*
   * OS SLOTS SÃO A ESTRUTURA DA TELA AGORA.
   *
   * Produto comum devolve UM slot sem rótulo, e a tela sai idêntica ao que
   * sempre foi. Combo devolve o slot 0 (grupos do próprio combo, tipo a bebida
   * inclusa) mais um por componente. Ver `lib/slots-produto.ts`, onde a promessa
   * de "produto comum não muda" está testada.
   */
  const slots = useMemo(() => montarSlots(produto), [produto]);
  const combo = ehCombo(produto);
  /** Todos os grupos de todos os slots, com o slot ao lado — pra varrer sem aninhar. */
  const paresSlotGrupo = useMemo(
    () => slots.flatMap(s => s.grupos.map(g => ({ slot: s.slot, rotulo: s.rotulo, grupo: g }))),
    [slots],
  );

  /*
   * A CHAVE É `slot:grupo`, não o id do grupo.
   *
   * Dois slots do mesmo produto — "2× Pizza Artesanal", o combo mais comum de
   * pizzaria — usam o MESMO grupo de sabores. Indexar por id fazia escolher
   * calabresa na pizza 1 aparecer marcado na 2.
   */
  const [escolhidas, setEscolhidas] = useState<Record<string, number[]>>({});
  const [qtd, setQtd] = useState(1);
  const [observacao, setObservacao] = useState('');
  const [descAberta, setDescAberta] = useState(false);
  /** Rolou o bastante pra foto sair de vista — ver a barra compacta, mais abaixo. */
  const [compacto, setCompacto] = useState(false);
  const { mostrar } = useToast();

  useEffect(() => {
    setEscolhidas({});
    setQtd(1);
    setObservacao('');
    setDescAberta(false);
    setCompacto(false);
  }, [produto.id]);

  /*
   * O CONTEÚDO ROLA DENTRO DE UM DIV, não na janela — então rolar até um grupo é
   * `scrollTo` neste container. `scrollIntoView` mexeria no scroll da página por
   * trás do sheet, e o modal não se moveria.
   */
  const areaRolagem = useRef<HTMLDivElement | null>(null);
  /* Indexada por `slot:grupo`: com dois slots do mesmo produto, o id do grupo
     sozinho guardaria uma ref só e o chip levaria sempre à primeira pizza. */
  const refsGrupo = useRef<Record<string, HTMLDivElement | null>>({});

  function irParaGrupo(chave: string) {
    const area = areaRolagem.current;
    const alvo = refsGrupo.current[chave];
    if (!area || !alvo) return;
    // -8px pra o cabeçalho sticky não cobrir a primeira linha do grupo.
    area.scrollTo({ top: alvo.offsetTop - 8, behavior: 'smooth' });
  }

  /*
   * CABEÇALHO COMPACTO AO ROLAR.
   *
   * A foto e o título saem de vista de propósito (rolam junto com o conteúdo,
   * pra lista de opções usar a altura inteira). O custo é que, no meio de uma
   * pizza de quatro grupos, o cliente perde a referência do que está montando —
   * e o rodapé mostra o total, não QUAL produto.
   *
   * Por que sobreposto e não em fluxo: a barra de progresso é `sticky top-0`
   * DENTRO da área que rola. Uma barra em fluxo que cresce no meio da rolagem
   * empurraria todo o conteúdo abaixo dela pra baixo — o texto pularia debaixo
   * do dedo. Sobreposta, só o `top` da barra de progresso muda, e ela desliza
   * pra baixo da compacta sem mexer em nada do conteúdo.
   *
   * SÓ NO CELULAR. No desktop o modal tem 480px centrados e altura de sobra: a
   * foto quase não sai de vista, e a barra cobriria o X. A checagem é em JS e
   * não em `sm:hidden` porque o `top` da barra de progresso também depende
   * disto — escondê-la por CSS deixaria a de progresso descolada 44px do topo,
   * com um vão vazio em cima.
   */
  useEffect(() => {
    const area = areaRolagem.current;
    if (!aberto || !area) return;
    if (window.matchMedia('(min-width: 640px)').matches) return;
    /* Histerese: aparece depois de 200px, só desaparece antes de 150. Com um
       limite só, uma rolagem parada exatamente nele ligaria e desligaria a
       barra a cada pixel de tremida do dedo. */
    const aoRolar = () => setCompacto(v => (v ? area.scrollTop > 150 : area.scrollTop > 200));
    area.addEventListener('scroll', aoRolar, { passive: true });
    return () => area.removeEventListener('scroll', aoRolar);
  }, [aberto, produto.id]);

  const precoBase = precoVigente(produto);

  // Estoque: quando controlado, limita a quantidade e bloqueia se zerado.
  const controlaEstoque = !!produto.controla_estoque;
  const estoqueDisp = controlaEstoque ? (produto.estoque ?? 0) : Infinity;
  const esgotado = controlaEstoque && estoqueDisp <= 0;
  const noLimite = qtd >= estoqueDisp;

  const { precoUnit, opcoesTexto, faltando } = useMemo(() => {
    let preco = precoBase;
    const partes: string[] = [];
    const faltandoLocal: string[] = [];

    /*
     * O PREÇO É POR SLOT, e é a mesma regra do servidor.
     *
     * Juntar as escolhas de dois slots e chamar `precoDoGrupo` uma vez — que é a
     * coisa natural, porque o grupo é o MESMO objeto — cobraria, com
     * `modo_preco = 'maior'`, o maior acréscimo de TODAS as pizzas em vez do
     * maior de CADA uma. A prévia mostraria menos do que o servidor cobra, que é
     * o pior jeito de errar preço. Ver `precoDosSlots` em opcoes-preco.ts.
     */
    for (const s of slots) {
      /* `saboresLiberados` é POR SLOT: num combo "1 Grande + 1 Broto" o Grande
         libera 2 sabores e o Broto 1 — mesma função, dois resultados. */
      const doSlot = s.grupos.map(g => ({
        grupo: g,
        escolhidas: (escolhidas[chaveEscolha(s.slot, g.id)] || [])
          .map(id => g.opcoes.find(o => o.id === id))
          .filter((o): o is OpcaoItem => !!o),
      }));

      for (const { grupo: g, escolhidas: opcoes } of doSlot) {
        if (g.obrigatorio && opcoes.length === 0 && (g.opcoes ?? []).length > 0) {
          faltandoLocal.push(s.rotulo ? `${s.rotulo} · ${g.nome}` : g.nome);
        }
        if (opcoes.length === 0) continue;

        preco += precoDoGrupo(g, opcoes);

        /*
         * O TEXTO GUARDA A FRAÇÃO E O RÓTULO DO SLOT. É ele que vai pro carrinho
         * e pro cupom: sem a fração a cozinha não sabe a divisão, e sem o rótulo
         * não sabe de qual pizza.
         */
        const total = opcoes.length;
        for (const p of contarFracoes(opcoes)) {
          const nome = (p.opcao as OpcaoItem).nome;
          /* ` | ` e não ` · `: o ponto é o que separa uma escolha da outra em
             `opcoes_texto`, e usar o mesmo símbolo pros dois níveis fazia o
             cupom ler o rótulo como se fosse mais uma escolha. */
          const onde = s.rotulo ? `${s.rotulo} | ` : '';
          partes.push(p.fracoes > 1 && total > 1
            ? `${onde}${g.nome}: ${p.fracoes}/${total} ${nome}`
            : `${onde}${g.nome}: ${nome}`);
        }
      }
    }
    return { precoUnit: preco, opcoesTexto: partes.join(' · '), faltando: faltandoLocal };
  }, [escolhidas, slots, precoBase]);

  /*
   * GRUPO OBRIGATÓRIO COM UMA OPÇÃO SÓ NÃO É ESCOLHA — É INFORMAÇÃO.
   *
   * Ele contava como pendente, então o botão ficava travado esperando o cliente
   * "escolher" numa lista sem alternativa. Marcar sozinho é o que destrava, e é o
   * que o cliente faria de qualquer forma.
   *
   * Roda quando os grupos chegam (e ao trocar de produto), não a cada mudança de
   * seleção: se rodasse sempre, desmarcar viraria impossível em grupo de
   * múltipla escolha com um item só.
   */
  useEffect(() => {
    const unicas = paresSlotGrupo.filter(p => p.grupo.obrigatorio && p.grupo.opcoes.length === 1);
    if (unicas.length === 0) return;
    setEscolhidas(antigo => {
      let mudou = false;
      const novo = { ...antigo };
      for (const { slot, grupo: g } of unicas) {
        const k = chaveEscolha(slot, g.id);
        if ((novo[k] || []).length === 0) { novo[k] = [g.opcoes[0].id]; mudou = true; }
      }
      return mudou ? novo : antigo;
    });
  }, [paresSlotGrupo]);

  /**
   * Sabores liberados pelo tamanho escolhido, POR SLOT.
   *
   * Num combo "1 Grande + 1 Broto" o Grande libera 2 sabores e o Broto libera 1.
   * Um número só pro item inteiro daria o limite de uma pizza à outra — e o
   * servidor, que calcula por slot, recusaria o pedido no fim.
   */
  const saboresPorSlot = useMemo(() => {
    const mapa = new Map<number, number>();
    for (const s of slots) {
      mapa.set(s.slot, saboresLiberados(s.grupos.map(g => ({
        grupo: g,
        escolhidas: (escolhidas[chaveEscolha(s.slot, g.id)] || [])
          .map(id => g.opcoes.find(o => o.id === id))
          .filter((o): o is OpcaoItem => !!o),
      }))));
    }
    return mapa;
  }, [escolhidas, slots]);

  function alternar(slot: number, grupo: GrupoOpcoes, opcao: OpcaoItem) {
    const k = chaveEscolha(slot, grupo.id);
    const saboresPermitidos = saboresPorSlot.get(slot) ?? 0;
    setEscolhidas(antigo => {
      const atual = antigo[k] || [];
      if (grupo.tipo === 'unico') {
        /*
         * Trocar de TAMANHO pode reduzir o limite de sabores (da G pra P, de 3
         * pra 1). Sem limpar, o cliente ficaria com 3 sabores numa pizza que só
         * aceita 1 — e o servidor recusaria o pedido no final, depois de ele já
         * ter montado tudo.
         *
         * A LIMPEZA É SÓ DO SLOT. Trocar o tamanho da Pizza 1 num combo não pode
         * apagar os sabores da Pizza 2 — seria o cliente perdendo trabalho num
         * lugar por causa de um clique em outro.
         */
        if (grupo.papel === 'tamanho') {
          const limpo = { ...antigo, [k]: [opcao.id] };
          const doSlot = slots.find(x => x.slot === slot);
          for (const g of doSlot?.grupos ?? []) {
            if (g.papel === 'sabores') limpo[chaveEscolha(slot, g.id)] = [];
          }
          return limpo;
        }
        return { ...antigo, [k]: [opcao.id] };
      }
      /*
       * GRUPO DE SABORES: repetir o mesmo sabor é ADICIONAR FRAÇÃO, não
       * desmarcar. É o que permite "2/4 calabresa + 1/4 bacon + 1/4 frango".
       * Nos outros grupos (adicionais, borda) clicar de novo continua
       * desmarcando, que é o que se espera de caixa de seleção.
       */
      const max = maxEscolhasEfetivo(grupo, saboresPermitidos);
      if (grupo.papel === 'sabores') {
        if (max > 0 && atual.length >= max) return antigo;
        return { ...antigo, [k]: [...atual, opcao.id] };
      }
      if (atual.includes(opcao.id)) return { ...antigo, [k]: atual.filter(i => i !== opcao.id) };
      if (max > 0 && atual.length >= max) return antigo;
      return { ...antigo, [k]: [...atual, opcao.id] };
    });
  }

  /**
   * Remove UMA fração do sabor (o "−" do stepper).
   *
   * Tira só a última ocorrência, não todas: quem tem 2/4 de calabresa e toca em
   * "−" quer 1/4, não perder o sabor inteiro.
   */
  function removerFracao(slot: number, grupo: GrupoOpcoes, opcao: OpcaoItem) {
    const k = chaveEscolha(slot, grupo.id);
    setEscolhidas(antigo => {
      const atual = antigo[k] || [];
      const i = atual.lastIndexOf(opcao.id);
      if (i < 0) return antigo;
      return { ...antigo, [k]: [...atual.slice(0, i), ...atual.slice(i + 1)] };
    });
  }

  /*
   * PROGRESSO DAS ESCOLHAS OBRIGATÓRIAS.
   *
   * Numa pizza com Tamanho, Borda, Sabores e Refrigerante o cliente rolava a
   * tela inteira sem saber quantas faltavam — e o botão só dizia a primeira.
   *
   * `faltando` já era calculado junto do preço; aqui ele vira contagem e lista
   * de chips, sem recalcular nada.
   */
  /*
   * Conta os obrigatórios de TODOS os slots. Num combo de duas pizzas são seis
   * escolhas (tamanho, sabores e borda de cada), e a barra dizer "2 de 3" faria
   * o cliente achar que terminou no meio.
   *
   * `faltandoPorSlot` é a mesma função que decide o rótulo — chave e texto saem
   * do mesmo lugar, senão o chip levaria a um grupo e a mensagem citaria outro.
   */
  const pendentes = faltandoPorSlot(slots, escolhidas);
  const obrigatorios = paresSlotGrupo.filter(p => p.grupo.obrigatorio && (p.grupo.opcoes ?? []).length > 0);
  const resolvidos = obrigatorios.filter(
    p => !pendentes.some(f => f.chave === chaveEscolha(p.slot, p.grupo.id)));

  function adicionar(e: React.MouseEvent<HTMLButtonElement>) {
    if (faltando.length) {
      mostrar({ tipo: 'erro', titulo: 'Faltam escolhas obrigatórias', descricao: faltando.join(', ') });
      /* Rola até o primeiro pendente: num combo, dizer "falta Sabores" sem levar
         lá deixa o cliente procurando entre duas pizzas iguais. */
      if (pendentes[0]) irParaGrupo(pendentes[0].chave);
      return;
    }
    const r = e.currentTarget.getBoundingClientRect();
    vooCarrinho({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
    const ok = adicionarAoCarrinho(loja, {
      produto_id: produto.id,
      nome: produto.nome,
      preco_centavos: precoUnit,
      quantidade: qtd,
      opcoes: escolhasParaEnvio(slots, escolhidas),
      opcoes_texto: opcoesTexto,
      observacao: observacao.trim(),
      foto_url: produto.foto_url,
    });
    if (ok) {
      mostrar({ tipo: 'sucesso', titulo: `${qtd}× ${produto.nome} adicionado` });
      onFechar();
    } else {
      mostrar({ tipo: 'info', titulo: 'Carrinho de outra loja', descricao: 'Esvazie o carrinho para pedir desta loja.' });
    }
  }

  const temPromo = promocaoVigente(produto);

  return (
    <Sheet open={aberto} onOpenChange={v => !v && onFechar()}>
      <SheetContent
        side="bottom"
        hideHandle
        hideClose
        className={cn(
          'p-0 flex flex-col overflow-hidden gap-0',
          // Mobile: bottom sheet ocupando a largura toda.
          'max-h-[92dvh] rounded-t-3xl',
          /*
           * Desktop: card CENTRADO na vertical também, não colado no rodapé.
           * Com o corpo rolando, um card ancorado embaixo cresce pra cima e a
           * foto "sobe" conforme se escolhe complemento — a página parece
           * pular. Centrado, ele cresce pros dois lados e fica parado.
           */
          'sm:inset-x-auto sm:inset-y-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2',
          'sm:w-[min(480px,100vw-48px)] sm:max-w-none sm:rounded-[22px] sm:max-h-[calc(100dvh-48px)]',
          'sm:shadow-[0_40px_90px_-30px_rgba(28,25,23,.5)]',
        )}
      >

        {/*
          X PRÓPRIO, não o do Sheet.
          O padrão fica em `top-4 right-4` — exatamente onde ficavam os selos, e
          um cobria o outro. E sobre foto escura ele desaparecia: aqui é um
          círculo branco, que se vê em qualquer imagem.
        */}
        <button
          type="button"
          onClick={onFechar}
          aria-label="Fechar"
          className="absolute right-3 top-3 z-40 flex size-9 items-center justify-center rounded-full bg-white/95 text-stone-800 shadow-md transition-transform active:scale-90"
        >
          <X className="size-[18px]" strokeWidth={2.5} />
        </button>

        {/*
          A FOTO E O CABEÇALHO ROLAM JUNTO COM O CONTEÚDO.

          Estavam FORA desta área, como irmãos `shrink-0`: ocupavam ~330px de
          forma PERMANENTE e o cliente rolava só uma janelinha no que sobrava.
          Diminuir a foto de 240 pra 190px devolveu 50px — e a barra de
          progresso que entrou consumiu 70. Ou seja: encolher não resolvia,
          porque o problema não era o tamanho da foto, era ela nunca sair do
          caminho.

          Aqui dentro, depois de um gesto de rolagem a lista de opções usa a
          altura inteira do sheet. Quem mantém o produto identificado é a barra
          de progresso (sticky) e o resumo no rodapé.
        */}
        {/*
          A barra compacta em si. `pr-14` reserva a faixa do X, que fica por
          cima (z-40) — sem a reserva, um nome longo passaria por baixo do botão
          de fechar e ficaria ilegível justamente na parte que trunca.

          O preço aqui é o DO PRODUTO, não o total com as opções: esta barra
          substitui o cabeçalho que saiu de vista, e é identidade. O total, que
          muda a cada escolha, é do rodapé — dois números diferentes no mesmo
          instante fariam o cliente conferir qual está certo.
        */}
        <div
          aria-hidden={!compacto}
          className={cn(
            'absolute inset-x-0 top-0 z-30 flex items-center gap-2.5 border-b border-border/60',
            'bg-background/95 px-4 pr-14 backdrop-blur transition-[opacity,transform] duration-150 sm:hidden',
            compacto
              ? 'h-11 opacity-100 translate-y-0'
              : 'pointer-events-none h-11 -translate-y-full opacity-0',
          )}
        >
          {produto.foto_url && (
            <img
              src={produto.foto_url}
              alt=""
              className="size-7 shrink-0 rounded-lg border border-border/60 object-cover"
            />
          )}
          <span className="min-w-0 flex-1 truncate text-[13px] font-bold">{produto.nome}</span>
          <span className={cn('shrink-0 text-[13px] font-bold tabular-nums',
            temPromo ? 'text-emerald-600 dark:text-emerald-400' : 'text-foreground')}>
            {brl(precoBase)}
          </span>
        </div>

        <div ref={areaRolagem} className="flex-1 overflow-y-auto min-h-0">
        {/* Foto: sangra na largura toda, sem moldura */}
        {produto.foto_url ? (
          /*
            190px NO CELULAR, 240 no desktop.
            Com 240px numa tela de telefone, a foto mais o nome mais a descrição
            comiam a primeira tela inteira: sobrava espaço pra UMA opção. A foto
            vende, mas quem decide a compra é a lista de escolhas — e ela tem que
            estar visível sem rolar.
          */
          <div className="relative h-[190px] shrink-0 overflow-hidden bg-white sm:h-60">
            {/* `contain` como na vitrine: o cliente abriu o card justamente pra
                ver o produto, e é aqui que o corte mais incomoda. O `bg-white`
                na moldura existe porque a faixa que sobra é transparente — sem
                fundo, o degradê de baixo apareceria por trás da foto. */}
            <img
              src={produto.foto_url}
              alt={produto.nome}
              className="size-full object-contain"
            />
            {/* Degradê até o fundo: sem ele a foto termina numa faixa dura e o
                nome parece colado numa borda. */}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-background to-transparent" />
            <div className="absolute top-3 left-1/2 -translate-x-1/2 h-1 w-10 rounded-full bg-white/60 sm:hidden" />
            <div className="absolute bottom-3 left-4 flex gap-1.5">
              {!!produto.destaque && (
                <span className="rounded-full bg-amber-400 px-2.5 py-1 text-[11px] font-bold text-amber-950 shadow-sm">
                  Destaque
                </span>
              )}
              {/*
                O DESCONTO EM NÚMERO, não "PROMO".
                "PROMO" não diz se vale a pena; "−11% hoje" diz. Verde é o único
                lugar em que a loja não usa a cor da marca, de propósito:
                desconto se lê como dinheiro, não como identidade visual.
              */}
              {temPromo && (
                <span className="rounded-full bg-emerald-600 px-2.5 py-1 text-[11px] font-bold text-white shadow-sm tabular-nums">
                  −{Math.round((1 - precoBase / produto.preco_centavos) * 100)}% hoje
                </span>
              )}
            </div>
          </div>
        ) : null}

        {/*
          PREÇO EM LINHA PRÓPRIA, ABAIXO DO NOME.
          Estava ao lado: com nome de duas linhas ("Pizza Gigante +1 Refrigerante
          2LT Grátis") o preço ficava no alto da direita e o nome quebrava por
          baixo dele — os dois disputando a mesma faixa. O motivo de estar ali
          era não empurrar o preço pra depois da descrição; resolvido pondo ele
          ANTES dela, não ao lado do título.
        */}
        <div className="shrink-0 px-5 pb-3 pt-3">
          <h2 className="text-[20px] font-extrabold leading-tight [text-wrap:pretty]">{produto.nome}</h2>
          <div className="mt-1 flex items-baseline gap-2">
            <span className={cn('text-[20px] font-extrabold tabular-nums',
              temPromo ? 'text-emerald-600 dark:text-emerald-400' : 'text-foreground')}>
              {brl(precoBase)}
            </span>
            {temPromo && (
              <span className="text-[13px] text-muted-foreground line-through tabular-nums">
                {brl(produto.preco_centavos)}
              </span>
            )}
          </div>
          {/*
            DESCRIÇÃO EM 2 LINHAS, com "ver mais".
            Ia inteira: quatro linhas de texto promocional empurravam a primeira
            escolha pra fora da tela. Quem quer ler, toca; quem quer pedir, vê as
            opções.
          */}
          {produto.descricao && (
            <div className="mt-1.5">
              <p className={cn('text-sm leading-relaxed text-muted-foreground',
                !descAberta && 'line-clamp-2')}>
                {produto.descricao}
              </p>
              {produto.descricao.length > 90 && (
                <button
                  type="button"
                  onClick={() => setDescAberta(v => !v)}
                  className="mt-0.5 text-[12.5px] font-semibold text-primary"
                >
                  {descAberta ? 'ver menos' : 'ver descrição completa'}
                </button>
              )}
            </div>
          )}
          {/* `!!` pelo mesmo motivo do `destaque`: numero 0 vira um "0" na tela. */}
          {!!produto.serve_pessoas && (
            <p className="mt-1.5 text-xs text-muted-foreground">
              Serve {produto.serve_pessoas} pessoa{produto.serve_pessoas > 1 ? 's' : ''}
            </p>
          )}
          {controlaEstoque && !esgotado && estoqueDisp <= 5 && (
            <p className="mt-2 text-xs font-semibold text-amber-600">
              Últimas {estoqueDisp} unidade{estoqueDisp > 1 ? 's' : ''} em estoque
            </p>
          )}
        </div>

        {/* Scroll area */}
          {/*
            BARRA DE PROGRESSO — quantas escolhas obrigatórias faltam, e onde.

            `sticky top-0` DENTRO da área que rola: fica visível durante toda a
            montagem, que é justamente quando a informação serve. Só aparece com
            2+ grupos obrigatórios — num produto com um grupo só, ela repetiria o
            que o cabeçalho do próprio grupo já diz.

            Verde e âmbar literais aqui são cor SEMÂNTICA (resolvido/pendente),
            não identidade visual — mesma exceção do semáforo do KDS. A cor da
            marca continua sendo `primary`, usada no botão.
          */}
          {obrigatorios.length > 1 && (
            <div
              style={{ top: compacto ? 44 : 0 }}
              className="sticky z-20 border-b border-border/60 bg-background/95 px-5 py-2.5 backdrop-blur transition-[top] duration-150"
            >
              <div className="flex items-center gap-2">
                <span className="text-[11.5px] font-bold">
                  {faltando.length === 0
                    ? 'Tudo escolhido'
                    : `${resolvidos.length} de ${obrigatorios.length} escolhas obrigatórias`}
                </span>
                {/* Trilha de filetes: um por grupo, verde quando resolvido. Diz
                    o tamanho do caminho, não só quanto falta. */}
                <span className="flex flex-1 gap-1">
                  {obrigatorios.map(({ slot, grupo: g }) => (
                    <span
                      key={chaveEscolha(slot, g.id)}
                      className={cn(
                        'h-[3px] flex-1 rounded-full transition-colors',
                        pendentes.some(p => p.chave === chaveEscolha(slot, g.id))
                          ? 'bg-border' : 'bg-emerald-500',
                      )}
                    />
                  ))}
                </span>
              </div>

              {/* Chips de atalho. Rolam na horizontal porque 4 grupos não cabem
                  em tela de 360px, e quebrar em duas linhas empurraria o
                  conteúdo pra baixo a cada render. */}
              <div className="scrollbar-hide -mx-1 mt-2 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
                {obrigatorios.map(({ slot, rotulo, grupo: g }) => {
                  const chave = chaveEscolha(slot, g.id);
                  const ok = !pendentes.some(p => p.chave === chave);
                  return (
                    <button
                      key={chave}
                      type="button"
                      onClick={() => irParaGrupo(chave)}
                      className={cn(
                        'flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors',
                        ok
                          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                          : 'border-border bg-card text-muted-foreground',
                      )}
                    >
                      {ok && <Check className="size-3" strokeWidth={3} />}
                      {/* No combo o chip carrega o rótulo: "Sabores" duas vezes
                          na mesma barra não diz qual pizza está pendente. */}
                      {rotulo ? `${rotulo} · ${g.nome}` : g.nome}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {/*
            SEM AVISO DE "sem personalizações" quando não há grupos.
            O modal agora abre em QUALQUER produto (tocar no card abre; só o "+"
            adiciona direto), então num item simples esse texto era a única
            coisa no corpo — parecia tela quebrada. Sem ele, o modal fica sendo
            o que precisa ser: foto grande, descrição, preço, quantidade e o
            botão de adicionar.
          */}
          {/*
            SLOTS EMPILHADOS, NÃO ASSISTENTE DE PASSOS.

            O concorrente analisado faz wizard — "Pizza 1 de 2", avançar, voltar —
            e paga dois preços: navegação com estado próprio ("dá pra avançar?") e,
            no caso dele, a troca de passo APAGANDO o que já foi escolhido.

            Empilhado, o combo é a mesma tela de sempre com cabeçalhos: nada pra
            navegar, nada pra apagar, e a barra de progresso no topo já diz o que
            falta em qual pizza. O cliente rola, que é o gesto que ele ia fazer de
            qualquer jeito dentro de cada passo.
          */}
          {slots.map(s => (
            <div key={s.slot}>
              {/*
                O cabeçalho do slot só existe no combo. Em produto comum o rótulo
                é vazio, e a tela sai idêntica ao que sempre foi — sem seção,
                sem faixa, sem nada a mais.
              */}
              {combo && s.rotulo && (
                <div className="sticky z-[19] flex items-center gap-2 border-y border-border/60 bg-muted/60 px-5 py-2 backdrop-blur"
                  style={{ top: (obrigatorios.length > 1 ? 70 : 0) + (compacto ? 44 : 0) }}>
                  <span className="flex size-5 items-center justify-center rounded-full bg-foreground/85 text-[10.5px] font-bold text-background">
                    {s.slot}
                  </span>
                  <span className="text-[13px] font-extrabold">{s.rotulo}</span>
                </div>
              )}
              {s.grupos.map(g => {
                const chave = chaveEscolha(s.slot, g.id);
                return (
                  <div key={chave} ref={el => { refsGrupo.current[chave] = el; }}>
                    <GrupoOpcao
                      grupo={g}
                      escolhidas={escolhidas[chave] || []}
                      onAlternar={opcao => alternar(s.slot, g, opcao)}
                      onRemoverFracao={opcao => removerFracao(s.slot, g, opcao)}
                      saboresPermitidos={saboresPorSlot.get(s.slot) ?? 0}
                      /* +34 quando há cabeçalho de slot: o sticky do grupo tem
                         que parar embaixo dele, não por cima. */
                      topoSticky={(obrigatorios.length > 1 ? 70 : 0) + (compacto ? 44 : 0)
                        + (combo && s.rotulo ? 34 : 0)}
                    />
                  </div>
                );
              })}
            </div>
          ))}
          {/*
            OBSERVAÇÃO POR ITEM.
            Existia uma só, do pedido inteiro, no fim do checkout: quem pedia
            dois lanches e queria um sem cebola escrevia "o segundo X-Burguer
            sem cebola" e torcia pra cozinha entender qual era. Aqui a
            instrução fica presa ao item, e sai na comanda dele.
          */}
          <div className="border-t-[6px] border-muted/70 px-5 py-4">
            <label htmlFor="obs-item" className="text-[14.5px] font-bold">Alguma observação?</label>
            <textarea
              id="obs-item"
              rows={2}
              maxLength={140}
              value={observacao}
              onChange={e => setObservacao(e.target.value)}
              placeholder="Ex.: sem cebola, molho à parte…"
              className="mt-2 w-full resize-none rounded-xl border border-border bg-muted/30 px-3 py-2.5 text-sm outline-none transition-shadow placeholder:text-muted-foreground/70 focus:border-primary focus:ring-2 focus:ring-primary/25"
            />
            {/* Contador só perto do fim: mostrar "0/140" de saída é ruído. */}
            {observacao.length > 100 && (
              <p className="mt-1 text-right text-[11px] text-muted-foreground tabular-nums">
                {observacao.length}/140
              </p>
            )}
          </div>
          <div className="h-4" />
        </div>

        {/* Footer */}
        <SheetFooter className="flex-col gap-0 px-5 py-4 border-t border-border bg-background shrink-0">
          {/*
            A COMPOSIÇÃO NO RODAPÉ, junto do total.
            O texto já era montado (é o que vai pro carrinho e pro cupom da
            cozinha) e ficava invisível pro cliente enquanto ele montava —
            justamente quando serve: é aqui que ele confere "1/2 4 Queijos ·
            1/2 Bolonhesa" antes de adicionar. `line-clamp-2` porque pizza de 4
            sabores com borda gera texto longo, e o rodapé não pode crescer até
            comer o botão.
          */}
          {opcoesTexto && (
            <p className="mb-2 w-full text-left text-[11.5px] leading-snug text-muted-foreground line-clamp-2">
              {opcoesTexto}
            </p>
          )}
          <div className="flex items-center gap-3 w-full">
            {/* Quantity picker */}
            <div className="flex items-center rounded-full border-2 border-border overflow-hidden shrink-0">
              <button
                type="button"
                aria-label="Diminuir quantidade"
                className="flex size-11 items-center justify-center transition-colors active:bg-muted disabled:opacity-40 touch-manipulation"
                onClick={() => setQtd(q => Math.max(1, q - 1))}
                disabled={qtd <= 1}
              >
                <Minus className="size-4" />
              </button>
              <span className="min-w-8 text-center font-extrabold text-base select-none">{qtd}</span>
              <button
                type="button"
                aria-label="Aumentar quantidade"
                className="flex size-11 items-center justify-center transition-colors active:bg-muted disabled:opacity-40 touch-manipulation"
                onClick={() => setQtd(q => (q < estoqueDisp ? q + 1 : q))}
                disabled={noLimite}
              >
                <Plus className="size-4" />
              </button>
            </div>

            {/*
              BOTÃO DESABILITADO enquanto falta escolha obrigatória, com o
              rótulo dizendo O QUE falta.
              Antes ele ficava ativo e, ao tocar, respondia com um aviso que
              subia no canto da tela — longe do dedo e longe do grupo que
              faltava. Agora a instrução está no próprio botão, e o rótulo dele
              é a resposta.
            */}
            {/*
              COM PENDÊNCIA, O BOTÃO LEVA ATÉ ELA — não fica morto.
              Antes era `disabled`: cor de destaque num botão inerte parece
              ativo, o cliente tocava, nada acontecia e ele não tinha como saber
              por quê. Agora o fundo é neutro (só o botão pronto usa a cor da
              marca) e o toque rola até o grupo que falta.

              `aria-disabled` e não `disabled`: o botão passou a TER ação, então
              precisa receber foco e clique. `disabled` mataria as duas coisas.
              Esgotado continua desabilitado de verdade — ali não há ação
              possível.
            */}
            <Button
              size="lg"
              variant={faltando.length > 0 && !esgotado ? 'outline' : 'default'}
              className={cn(
                'h-12 flex-1 justify-between gap-2 rounded-xl text-sm font-bold touch-manipulation',
                faltando.length > 0 && !esgotado && 'bg-muted text-foreground hover:bg-muted',
              )}
              onClick={e => {
                if (pendentes.length > 0) {
                  /* Leva ao primeiro pendente pela CHAVE, e não procurando o
                     grupo pelo nome: num combo há dois "Sabores", e achar pelo
                     nome levava sempre à primeira pizza. */
                  irParaGrupo(pendentes[0].chave);
                  return;
                }
                adicionar(e);
              }}
              disabled={esgotado}
              aria-disabled={faltando.length > 0}
            >
              {esgotado ? (
                <span className="mx-auto">Esgotado</span>
              ) : faltando.length > 0 ? (
                <>
                  <AlertCircle className="size-4 shrink-0" />
                  <span className="flex-1 text-left">Escolha {faltando[0]}</span>
                  {/* A seta diz que o toque LEVA a algum lugar. Sem ela, um botão
                      neutro com texto de aviso parece só desabilitado. */}
                  <ChevronDown className="size-4 shrink-0 opacity-60" />
                </>
              ) : (
                <>
                  <span>Adicionar ao carrinho</span>
                  <span className="tabular-nums">{brl(precoUnit * qtd)}</span>
                </>
              )}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function GrupoOpcao({
  grupo, escolhidas, onAlternar, onRemoverFracao, saboresPermitidos, topoSticky,
}: {
  /**
   * Altura da barra de progresso, pro cabeçalho grudar logo abaixo dela.
   *
   * Vem por prop porque o grupo não sabe se a barra existe: em produto com um
   * grupo obrigatório só ela não é renderizada, e um deslocamento fixo deixaria
   * um vão morto de 70px acima do título.
   */
  topoSticky: number;
  grupo: GrupoOpcoes;
  /** Com REPETIÇÃO no grupo de sabores: o mesmo id aparece uma vez por fração. */
  escolhidas: number[];
  /** Vem do tamanho escolhido; muda o limite deste grupo se ele for de sabores. */
  saboresPermitidos: number;
  onAlternar: (opcao: OpcaoItem) => void;
  onRemoverFracao: (opcao: OpcaoItem) => void;
}) {
  const maxEfetivo = maxEscolhasEfetivo(grupo, saboresPermitidos);
  const obrigatorioPendente = grupo.obrigatorio && escolhidas.length === 0;
  const concluido = grupo.obrigatorio && escolhidas.length > 0;

  let hint = '';
  if (grupo.tipo === 'unico') {
    hint = 'Escolha 1';
  } else if (grupo.papel === 'sabores' && saboresPermitidos === 0) {
    // Ainda não escolheu o tamanho: dizer 'até 3' aqui seria chute, e escolher
    // sabor antes do tamanho só levaria a ter que refazer.
    hint = 'Escolha o tamanho primeiro';
  } else if (maxEfetivo > 0) {
    // No grupo de sabores o que se conta é FRAÇÃO, não sabor distinto: 2/4 de um
    // sabor já ocupa dois pedaços, e dizer "1 escolhido" mentiria sobre o que
    // falta preencher.
    const unidade = grupo.papel === 'sabores' ? 'pedaços' : 'escolhidos';
    /*
     * "ATÉ", não "escolha N": o limite é MÁXIMO. Numa pizza que aceita 3 sabores
     * o cliente pode querer 2 — e aí a divisão é ao meio, não em terços. Dizer
     * "Escolha 3 pedaços" faria parecer obrigatório preencher tudo.
     */
    hint = escolhidas.length > 0
      ? `${escolhidas.length} de até ${maxEfetivo} ${unidade}`
      : `Até ${maxEfetivo} ${unidade}`;
  } else {
    hint = escolhidas.length > 0
      ? `${escolhidas.length} escolhido${escolhidas.length > 1 ? 's' : ''}`
      : 'Opcional';
  }

  return (
    <div className="border-t-[6px] border-muted/70">
      {/*
        CABEÇALHO DO GRUPO STICKY, ABAIXO DA BARRA DE PROGRESSO.
        Sem isto o título passava POR BAIXO da barra e aparecia cortado ao meio
        ("Tamanho" com o topo fatiado) — dava impressão de layout quebrado, e
        rolando a lista longa de sabores o cliente perdia de vista em qual grupo
        estava.

        `top-[70px]` é a altura da barra de progresso. Quando ela não existe
        (produto com um grupo obrigatório só), o valor sobra mas não atrapalha:
        o cabeçalho apenas gruda um pouco mais abaixo.
      */}
      <div
        style={{ top: topoSticky }}
        className="sticky z-10 flex items-center justify-between gap-3 border-b border-border/40 bg-background/95 px-5 pb-2.5 pt-3 backdrop-blur"
      >
        <div className="min-w-0">
          <h3 className="font-extrabold text-[15px] leading-tight">{grupo.nome}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>
        </div>
        {grupo.obrigatorio ? (
          <span className={cn(
            'shrink-0 rounded-full px-3 py-1 text-[11px] font-bold',
            concluido
              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400'
              : 'bg-primary/10 text-primary',
          )}>
            {/* Contador em vez de "Feito" quando há mais de um a escolher: em
                sabores, "Feito" com 1 de 3 pedaços esconderia que ainda cabe. */}
            {concluido
              ? (maxEfetivo > 1 ? `${escolhidas.length}/${maxEfetivo}` : '✓ Feito')
              : 'Obrigatório'}
          </span>
        ) : (
          <span className="shrink-0 rounded-full bg-muted px-3 py-1 text-[11px] font-semibold text-muted-foreground">
            Opcional
          </span>
        )}
      </div>

      {/* Option cards */}
      <div className="px-4 pb-4 space-y-2">
        {agruparPorSecao(grupo.opcoes).map(({ secao, opcoes }) => (
        <div key={secao || '__sem_secao'} className={cn(secao && 'pt-1')}>
        {/*
          Cabeçalho da seção só quando ELA TEM NOME. Loja que não usa seção
          continua vendo a lista exatamente como antes — recurso não usado não
          deve aparecer na tela do cliente.
        */}
        {secao && (
          <p className="mb-2 mt-1 px-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            {secao}
          </p>
        )}
        <div className="space-y-2">
        {opcoes.map(o => {
          const fracoes = escolhidas.filter(i => i === o.id).length;
          const ativa = fracoes > 0;
          /*
           * NO MÁXIMO, as não marcadas ficam INERTES.
           * O clique já era ignorado, mas a linha continuava com cara de
           * clicável — o cliente tocava, nada acontecia e ele não tinha como
           * saber por quê. Esmaecida e sem cursor, a regra fica visível.
           */
          const bloqueada = !ativa && maxEfetivo > 0 && escolhidas.length >= maxEfetivo;
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => !bloqueada && onAlternar(o)}
              disabled={bloqueada}
              aria-disabled={bloqueada}
              className={cn(
                'flex w-full items-center gap-3 px-4 py-3.5 rounded-2xl border-2 text-left transition-all select-none touch-manipulation',
                ativa
                  ? 'border-primary bg-primary/5 shadow-sm shadow-primary/10'
                  : bloqueada
                    ? 'cursor-not-allowed border-border/50 bg-muted/20 opacity-50'
                    : 'cursor-pointer border-border bg-background active:bg-muted/50',
              )}
            >
              {/* Indicator */}
              <span className={cn(
                'flex shrink-0 items-center justify-center size-[22px] transition-all',
                grupo.tipo === 'unico' ? 'rounded-full border-2' : 'rounded-[6px] border-2',
                ativa
                  ? 'border-primary bg-primary'
                  : 'border-muted-foreground/40 bg-background',
              )}>
                {ativa && grupo.tipo === 'unico' && (
                  <span className="block size-2 rounded-full bg-white" />
                )}
                {ativa && grupo.tipo !== 'unico' && (
                  <Check className="size-3 text-white" strokeWidth={3.5} />
                )}
              </span>

              {/*
                MINIATURA DO SABOR.
                Numa pizzaria a foto é o que vende — nome e ingredientes fazem o
                cliente ler, a foto faz escolher. 44px porque é o suficiente pra
                reconhecer o sabor sem empurrar o nome e o preço pra fora da
                linha; maior que isso e a lista deixa de caber na tela.

                Sem foto, nada aparece: um quadrado cinza de placeholder em cada
                sabor faria a lista parecer quebrada em loja que não subiu
                imagem.
              */}
              {o.imagem && (
                <img
                  src={o.imagem}
                  alt=""
                  loading="lazy"
                  className="size-11 shrink-0 rounded-xl border border-border/60 bg-muted object-cover"
                />
              )}

              {/* Name + ingredientes */}
              <span className="min-w-0 flex-1">
                <span className={cn(
                  'block text-sm font-semibold leading-snug',
                  ativa ? 'text-primary' : 'text-foreground',
                )}>
                  {o.nome}
                </span>
                {/*
                  Ingredientes numa linha, com clamp de 2: é o que transforma
                  "Portuguesa" numa escolha informada. Sem o clamp, um sabor com
                  descrição longa empurra os outros pra fora da tela e o cliente
                  para de comparar.
                */}
                {o.descricao && (
                  <span className="mt-0.5 block text-[11.5px] leading-snug text-muted-foreground line-clamp-2">
                    {o.descricao}
                  </span>
                )}
              </span>

              {/*
                STEPPER só no grupo de sabores, e só depois de escolhido.
                É o que deixa pedir 2/4 do mesmo sabor. Nos outros grupos a
                linha inteira continua sendo um toggle — stepper em "bacon
                extra" prometeria uma quantidade que o preço não cobra.

                `stopPropagation` porque a linha toda é um botão: sem isso, o
                "−" removeria uma fração e o clique da linha adicionaria outra
                de volta, e nada pareceria acontecer.
              */}
              {grupo.papel === 'sabores' && ativa && (
                <span className="flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-1">
                  <button
                    type="button"
                    aria-label={`Tirar um pedaço de ${o.nome}`}
                    onClick={ev => { ev.stopPropagation(); onRemoverFracao(o); }}
                    className="flex size-7 items-center justify-center rounded-full text-primary hover:bg-primary/15"
                  >
                    <Minus className="size-3.5" strokeWidth={3} />
                  </button>
                  {/*
                    Mostra a CONTAGEM de pedaços, não "1/3".
                    A fração depende de quantos pedaços o cliente vai usar no
                    total, e isso só se sabe no fim: parar em 2 numa pizza de até
                    3 é divisão ao meio. O stepper dizia "1/3" e o carrinho diria
                    "1/2" — dois números diferentes pra mesma escolha. A fração
                    aparece na linha de composição, embaixo.
                  */}
                  <span className="min-w-[22px] text-center text-[11px] font-bold tabular-nums text-primary">
                    {fracoes}
                  </span>
                  <button
                    type="button"
                    aria-label={`Mais um pedaço de ${o.nome}`}
                    disabled={maxEfetivo > 0 && escolhidas.length >= maxEfetivo}
                    onClick={ev => { ev.stopPropagation(); onAlternar(o); }}
                    className="flex size-7 items-center justify-center rounded-full text-primary hover:bg-primary/15 disabled:opacity-30"
                  >
                    <Plus className="size-3.5" strokeWidth={3} />
                  </button>
                </span>
              )}

              {/* Price */}
              {o.preco_adicional_centavos === 0 ? (
                <span className={cn(
                  'text-xs font-bold shrink-0',
                  ativa ? 'text-primary' : 'text-emerald-600 dark:text-emerald-400',
                )}>
                  grátis
                </span>
              ) : (
                <span className={cn(
                  'text-sm font-bold tabular-nums shrink-0',
                  ativa ? 'text-primary' : 'text-foreground/70',
                )}>
                  +{brl(o.preco_adicional_centavos)}
                </span>
              )}
            </button>
          );
        })}
        </div>
        </div>
        ))}
      </div>
    </div>
  );
}
