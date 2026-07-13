/**
 * Modal de montagem do produto: tamanho (radio), borda, adicionais (checkbox).
 * Recalcula o preço em tempo real conforme as escolhas.
 */
import { useEffect, useMemo, useState } from 'react';
import { Minus, Plus, Check, AlertCircle } from 'lucide-react';
import {
  Sheet, SheetContent, SheetFooter,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { brl } from '@/lib/format';
import { cn } from '@/lib/utils';
import { adicionarAoCarrinho, vooCarrinho } from '@/lib/carrinho';
import { useToast } from '@/components/ui/toast';
import type { GrupoOpcoes, Loja, OpcaoItem, Produto } from '@/types';

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
  const { mostrar } = useToast();

  useEffect(() => {
    setEscolhidas({});
    setQtd(1);
  }, [produto.id]);

  const precoBase = (produto.preco_promocional_centavos && produto.preco_promocional_centavos > 0)
    ? produto.preco_promocional_centavos : produto.preco_centavos;

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
      for (const id of ids_g) {
        const opcao = g.opcoes.find(o => o.id === id);
        if (opcao) {
          preco += opcao.preco_adicional_centavos;
          partes.push(`${g.nome}: ${opcao.nome}`);
          ids.push(id);
        }
      }
    }
    return { precoUnit: preco, opcoesTexto: partes.join(' · '), opcoesIds: ids, faltando: faltandoLocal };
  }, [escolhidas, grupos, precoBase]);

  function alternar(grupo: GrupoOpcoes, opcao: OpcaoItem) {
    setEscolhidas(antigo => {
      const atual = antigo[grupo.id] || [];
      if (grupo.tipo === 'unico') return { ...antigo, [grupo.id]: [opcao.id] };
      if (atual.includes(opcao.id)) return { ...antigo, [grupo.id]: atual.filter(i => i !== opcao.id) };
      if (grupo.max_escolhas > 0 && atual.length >= grupo.max_escolhas) return antigo;
      return { ...antigo, [grupo.id]: [...atual, opcao.id] };
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
      foto_url: produto.foto_url,
    });
    if (ok) {
      mostrar({ tipo: 'sucesso', titulo: `${qtd}× ${produto.nome} adicionado` });
      onFechar();
    } else {
      mostrar({ tipo: 'info', titulo: 'Carrinho de outra loja', descricao: 'Esvazie o carrinho para pedir desta loja.' });
    }
  }

  const temPromo = !!produto.preco_promocional_centavos && produto.preco_promocional_centavos > 0;

  return (
    <Sheet open={aberto} onOpenChange={v => !v && onFechar()}>
      <SheetContent
        side="bottom"
        hideHandle
        className={cn(
          'p-0 flex flex-col overflow-hidden gap-0',
          // Mobile: bottom sheet full width
          'max-h-[92dvh] rounded-t-3xl',
          // Desktop: centered card with constrained width
          'sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 sm:bottom-6 sm:w-full sm:max-w-md sm:rounded-3xl sm:max-h-[85dvh]',
        )}
      >

        {/* Foto com gradient overlay */}
        {produto.foto_url ? (
          <div className="relative h-52 shrink-0 overflow-hidden">
            <img
              src={produto.foto_url}
              alt={produto.nome}
              className="size-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-background/95 via-background/20 to-transparent" />
            <div className="absolute top-3 left-1/2 -translate-x-1/2 w-10 h-1 rounded-full bg-white/60" />
            <div className="absolute top-4 right-4 flex gap-1.5">
              {!!produto.destaque && (
                <span className="rounded-full bg-amber-400 text-amber-900 text-[10px] font-bold px-2.5 py-1 shadow-sm">
                  ★ Destaque
                </span>
              )}
              {temPromo && (
                <span className="rounded-full bg-primary text-primary-foreground text-[10px] font-bold px-2.5 py-1 shadow-sm">
                  PROMO
                </span>
              )}
            </div>
          </div>
        ) : null}

        {/* Header info */}
        <div className="px-5 pt-4 pb-4 shrink-0">
          <h2 className="text-xl font-extrabold leading-tight">{produto.nome}</h2>
          {produto.descricao && (
            <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{produto.descricao}</p>
          )}
          <div className="flex items-baseline gap-2.5 mt-2.5 flex-wrap">
            {temPromo ? (
              <>
                <span className="text-sm text-muted-foreground line-through">{brl(produto.preco_centavos)}</span>
                <span className="text-2xl font-extrabold text-success">{brl(precoBase)}</span>
                <Badge variant="promo" className="text-[10px]">
                  {Math.round((1 - precoBase / produto.preco_centavos) * 100)}% off
                </Badge>
              </>
            ) : (
              <span className="text-2xl font-extrabold">{brl(precoBase)}</span>
            )}
            {produto.serve_pessoas && (
              <Badge variant="outline" className="text-xs font-medium">
                serve {produto.serve_pessoas} pessoa{produto.serve_pessoas > 1 ? 's' : ''}
              </Badge>
            )}
          </div>
          {controlaEstoque && !esgotado && estoqueDisp <= 5 && (
            <p className="mt-2 text-xs font-semibold text-amber-600">
              🔥 Últimas {estoqueDisp} unidade{estoqueDisp > 1 ? 's' : ''} em estoque
            </p>
          )}
        </div>

        {/* Scroll area */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {grupos.length === 0 && (
            <div className="py-10 text-center px-5">
              <p className="text-sm text-muted-foreground">Sem personalizações para este item.</p>
            </div>
          )}
          {grupos.map(g => (
            <GrupoOpcao
              key={g.id}
              grupo={g}
              escolhidas={escolhidas[g.id] || []}
              onAlternar={opcao => alternar(g, opcao)}
            />
          ))}
          <div className="h-4" />
        </div>

        {/* Footer */}
        <SheetFooter className="px-5 py-4 border-t border-border bg-background shrink-0">
          <div className="flex items-center gap-3 w-full">
            {/* Quantity picker */}
            <div className="flex items-center rounded-full border-2 border-border overflow-hidden shrink-0">
              <button
                type="button"
                className="flex size-10 items-center justify-center transition-colors active:bg-muted disabled:opacity-40 touch-manipulation"
                onClick={() => setQtd(q => Math.max(1, q - 1))}
                disabled={qtd <= 1}
              >
                <Minus className="size-4" />
              </button>
              <span className="min-w-8 text-center font-extrabold text-base select-none">{qtd}</span>
              <button
                type="button"
                className="flex size-10 items-center justify-center transition-colors active:bg-muted disabled:opacity-40 touch-manipulation"
                onClick={() => setQtd(q => (q < estoqueDisp ? q + 1 : q))}
                disabled={noLimite}
              >
                <Plus className="size-4" />
              </button>
            </div>

            {/* Add button */}
            <Button
              size="lg"
              className="flex-1 h-12 text-sm font-bold rounded-2xl gap-2 touch-manipulation"
              onClick={adicionar}
              disabled={esgotado}
            >
              {esgotado ? (
                'Esgotado'
              ) : faltando.length > 0 ? (
                <>
                  <AlertCircle className="size-4 shrink-0" />
                  Escolha: {faltando[0]}
                </>
              ) : (
                `Adicionar · ${brl(precoUnit * qtd)}`
              )}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function GrupoOpcao({
  grupo, escolhidas, onAlternar,
}: {
  grupo: GrupoOpcoes;
  escolhidas: number[];
  onAlternar: (opcao: OpcaoItem) => void;
}) {
  const obrigatorioPendente = grupo.obrigatorio && escolhidas.length === 0;
  const concluido = grupo.obrigatorio && escolhidas.length > 0;

  let hint = '';
  if (grupo.tipo === 'unico') {
    hint = 'Escolha 1';
  } else if (grupo.max_escolhas > 0) {
    hint = escolhidas.length > 0
      ? `${escolhidas.length}/${grupo.max_escolhas} escolhidos`
      : `Até ${grupo.max_escolhas}`;
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
        {grupo.opcoes.map(o => {
          const ativa = escolhidas.includes(o.id);
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => onAlternar(o)}
              className={cn(
                'flex w-full items-center gap-3 px-4 py-3.5 rounded-2xl border-2 text-left transition-all cursor-pointer select-none touch-manipulation',
                ativa
                  ? 'border-primary bg-primary/5 shadow-sm shadow-primary/10'
                  : 'border-border bg-background active:bg-muted/50',
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

              {/* Name */}
              <span className={cn(
                'flex-1 text-sm font-semibold leading-snug',
                ativa ? 'text-primary' : 'text-foreground',
              )}>
                {o.nome}
              </span>

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
  );
}
