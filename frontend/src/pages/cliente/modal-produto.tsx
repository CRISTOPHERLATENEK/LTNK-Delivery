/**
 * Modal de montagem do produto: tamanho (radio), borda, adicionais (checkbox).
 * Recalcula o preço em tempo real conforme as escolhas.
 */
import { useEffect, useMemo, useState } from 'react';
import { precoVigente, promocaoVigente } from '@/lib/preco-produto';
import { Minus, Plus, Check, AlertCircle, X } from 'lucide-react';
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

interface Props {
  produto: Produto;
  loja: Loja;
  aberto: boolean;
  onFechar: () => void;
}

export function ModalProduto({ produto, loja, aberto, onFechar }: Props) {
  const grupos = produto.grupos || [];
  const [escolhidas, setEscolhidas] = useState<Record<number, number[]>>({});
  const [qtd, setQtd] = useState(1);
  const [observacao, setObservacao] = useState('');
  const { mostrar } = useToast();

  useEffect(() => {
    setEscolhidas({});
    setQtd(1);
    setObservacao('');
  }, [produto.id]);

  const precoBase = precoVigente(produto);

  // Estoque: quando controlado, limita a quantidade e bloqueia se zerado.
  const controlaEstoque = !!produto.controla_estoque;
  const estoqueDisp = controlaEstoque ? (produto.estoque ?? 0) : Infinity;
  const esgotado = controlaEstoque && estoqueDisp <= 0;
  const noLimite = qtd >= estoqueDisp;

  const { precoUnit, opcoesTexto, opcoesIds, faltando } = useMemo(() => {
    let preco = precoBase;
    const partes: string[] = [];
    const ids: number[] = [];
    const faltandoLocal: string[] = [];

    for (const g of grupos) {
      const ids_g = escolhidas[g.id] || [];
      if (g.obrigatorio && ids_g.length === 0) faltandoLocal.push(g.nome);

      const opcoes = ids_g
        .map(id => g.opcoes.find(o => o.id === id))
        .filter((o): o is OpcaoItem => !!o);
      if (opcoes.length === 0) continue;

      /*
       * `precoDoGrupo` E NÃO SOMA À MÃO.
       *
       * Esta tela somava os acréscimos direto, ignorando o `modo_preco` do
       * grupo — e o servidor usa `precoDoGrupo`. Numa pizza com 'maior', a tela
       * somava três acréscimos e a cobrança era de um: prévia diferente do que
       * se paga, que é o pior jeito de errar preço. A função estava até
       * importada aqui, e nunca era chamada.
       */
      preco += precoDoGrupo(g, opcoes);
      ids.push(...ids_g);

      /*
       * O texto mostra a FRAÇÃO quando o sabor se repete ("2/4 Calabresa"), e o
       * nome puro quando não. É este texto que vai pro carrinho e pro cupom da
       * cozinha — sem a fração ali, a tela promete uma divisão que quem produz
       * não recebe.
       */
      const total = opcoes.length;
      for (const p of contarFracoes(opcoes)) {
        const nome = (p.opcao as OpcaoItem).nome;
        partes.push(p.fracoes > 1 && total > 1
          ? `${g.nome}: ${p.fracoes}/${total} ${nome}`
          : `${g.nome}: ${nome}`);
      }
    }
    return { precoUnit: preco, opcoesTexto: partes.join(' · '), opcoesIds: ids, faltando: faltandoLocal };
  }, [escolhidas, grupos, precoBase]);

  /** Sabores liberados pelo tamanho escolhido — 0 quando ninguém definiu. */
  const saboresPermitidos = useMemo(() => saboresLiberados(
    grupos.map(g => ({
      grupo: g,
      escolhidas: (escolhidas[g.id] || [])
        .map(id => g.opcoes.find(o => o.id === id))
        .filter((o): o is OpcaoItem => !!o),
    })),
  ), [escolhidas, grupos]);

  function alternar(grupo: GrupoOpcoes, opcao: OpcaoItem) {
    setEscolhidas(antigo => {
      const atual = antigo[grupo.id] || [];
      if (grupo.tipo === 'unico') {
        /*
         * Trocar de TAMANHO pode reduzir o limite de sabores (da G pra P, de 3
         * pra 1). Sem limpar, o cliente ficaria com 3 sabores numa pizza que só
         * aceita 1 — e o servidor recusaria o pedido no final, depois de ele já
         * ter montado tudo.
         */
        if (grupo.papel === 'tamanho') {
          const limpo = { ...antigo, [grupo.id]: [opcao.id] };
          for (const g of grupos) if (g.papel === 'sabores') limpo[g.id] = [];
          return limpo;
        }
        return { ...antigo, [grupo.id]: [opcao.id] };
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
        return { ...antigo, [grupo.id]: [...atual, opcao.id] };
      }
      if (atual.includes(opcao.id)) return { ...antigo, [grupo.id]: atual.filter(i => i !== opcao.id) };
      if (max > 0 && atual.length >= max) return antigo;
      return { ...antigo, [grupo.id]: [...atual, opcao.id] };
    });
  }

  /**
   * Remove UMA fração do sabor (o "−" do stepper).
   *
   * Tira só a última ocorrência, não todas: quem tem 2/4 de calabresa e toca em
   * "−" quer 1/4, não perder o sabor inteiro.
   */
  function removerFracao(grupo: GrupoOpcoes, opcao: OpcaoItem) {
    setEscolhidas(antigo => {
      const atual = antigo[grupo.id] || [];
      const i = atual.lastIndexOf(opcao.id);
      if (i < 0) return antigo;
      return { ...antigo, [grupo.id]: [...atual.slice(0, i), ...atual.slice(i + 1)] };
    });
  }

  function adicionar(e: React.MouseEvent<HTMLButtonElement>) {
    if (faltando.length) {
      mostrar({ tipo: 'erro', titulo: 'Faltam escolhas obrigatórias', descricao: faltando.join(', ') });
      return;
    }
    const r = e.currentTarget.getBoundingClientRect();
    vooCarrinho({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
    const ok = adicionarAoCarrinho(loja, {
      produto_id: produto.id,
      nome: produto.nome,
      preco_centavos: precoUnit,
      quantidade: qtd,
      opcoes: opcoesIds,
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
          className="absolute right-3 top-3 z-10 flex size-9 items-center justify-center rounded-full bg-white/95 text-stone-800 shadow-md transition-transform active:scale-90"
        >
          <X className="size-[18px]" strokeWidth={2.5} />
        </button>

        {/* Foto: sangra na largura toda, sem moldura */}
        {produto.foto_url ? (
          <div className="relative h-60 shrink-0 overflow-hidden">
            <img
              src={produto.foto_url}
              alt={produto.nome}
              className="size-full object-cover"
            />
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
          NOME E PREÇO NA MESMA LINHA. Empilhados, o preço caía depois da
          descrição e num item de texto longo saía da primeira tela — o dado que
          mais decide a compra exigia rolar pra aparecer.
        */}
        <div className="shrink-0 px-5 pb-3 pt-4">
          <div className="flex items-start justify-between gap-4">
            <h2 className="min-w-0 text-[21px] font-extrabold leading-tight">{produto.nome}</h2>
            <div className="shrink-0 text-right leading-tight">
              {temPromo && (
                <span className="block text-[13px] text-muted-foreground line-through tabular-nums">
                  {brl(produto.preco_centavos)}
                </span>
              )}
              <span className={cn('block text-[19px] font-extrabold tabular-nums',
                temPromo ? 'text-emerald-600 dark:text-emerald-400' : 'text-foreground')}>
                {brl(precoBase)}
              </span>
            </div>
          </div>
          {produto.descricao && (
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{produto.descricao}</p>
          )}
          {produto.serve_pessoas && (
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
        <div className="flex-1 overflow-y-auto min-h-0">
          {/*
            SEM AVISO DE "sem personalizações" quando não há grupos.
            O modal agora abre em QUALQUER produto (tocar no card abre; só o "+"
            adiciona direto), então num item simples esse texto era a única
            coisa no corpo — parecia tela quebrada. Sem ele, o modal fica sendo
            o que precisa ser: foto grande, descrição, preço, quantidade e o
            botão de adicionar.
          */}
          {grupos.map(g => (
            <GrupoOpcao
              key={g.id}
              grupo={g}
              escolhidas={escolhidas[g.id] || []}
              onAlternar={opcao => alternar(g, opcao)}
              onRemoverFracao={opcao => removerFracao(g, opcao)}
              saboresPermitidos={saboresPermitidos}
            />
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
            <Button
              size="lg"
              className="h-12 flex-1 justify-between gap-2 rounded-xl text-sm font-bold touch-manipulation"
              onClick={adicionar}
              disabled={esgotado || faltando.length > 0}
            >
              {esgotado ? (
                <span className="mx-auto">Esgotado</span>
              ) : faltando.length > 0 ? (
                <>
                  <AlertCircle className="size-4 shrink-0" />
                  <span className="flex-1 text-left">Escolha {faltando[0]}</span>
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
  grupo, escolhidas, onAlternar, onRemoverFracao, saboresPermitidos,
}: {
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
      {/* Group header */}
      <div className="flex items-center justify-between px-5 pt-4 pb-3 gap-3">
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
            {concluido ? '✓ Feito' : 'Obrigatório'}
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
