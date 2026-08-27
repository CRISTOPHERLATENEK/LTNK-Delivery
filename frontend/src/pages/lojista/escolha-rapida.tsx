/**
 * ESCOLHA RÁPIDA — a lista compacta de opções do PDV.
 *
 * O modal do cliente é bom pra quem escolhe com calma. No balcão a operação é
 * outra: o atendente repete isso cem vezes por noite, com o cliente na frente,
 * e cada clique num alvo pequeno custa tempo que aparece na fila.
 *
 * Aqui cada opção tem UM número, contínuo entre grupos, e a mão não sai do
 * teclado: dígito escolhe, Enter fecha, Esc desiste. Sem foto e sem rolagem por
 * seção — a tela cabe de uma vez, e o número é o que se decora.
 */
import { useEffect, useMemo, useState } from 'react';
import { Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { brl } from '@/lib/format';
import { precoVigente } from '@/lib/preco-produto';
import { montarSlots, chaveEscolha, escolhasParaEnvio, faltandoPorSlot } from '@/lib/slots-produto';
import { saboresLiberados, maxEscolhasEfetivo, precoDoGrupo, agruparPorSecao } from '@/lib/opcoes-preco';
import { numerarOpcoes, resolverDigitado, grupoConcluido } from '@/lib/escolha-rapida';
import type { Produto } from '@/types';

export interface EscolhaFeita {
  opcoes: Array<number | { s: number; o: number }>;
  opcoesTexto: string;
  precoUnit: number;
}

export function EscolhaRapida({ produto, onCancelar, onConfirmar }: {
  produto: Produto;
  onCancelar: () => void;
  onConfirmar: (r: EscolhaFeita) => void;
}) {
  const slotsCrus = useMemo(() => montarSlots(produto), [produto]);

  /*
   * AS SEÇÕES ENTRAM AQUI — e a numeração TEM que seguir a ordem exibida.
   *
   * O cardápio de sabores vem em seções (Tradicional, Especial, Doce) e a lista
   * compacta as ignorava: 33 sabores em fila, sem dizer onde acaba o que está
   * incluso e começa o que custa mais.
   *
   * `agruparPorSecao` pode REORDENAR — o bloco sem seção vai pra frente, pra
   * uma opção sem seção não aparecer sob o título "Doces" e ser lida como
   * doce. Numerar por `g.opcoes` e exibir por seção faria o número apontar pro
   * sabor errado num grupo com bloco sem seção no meio. Então a lista exibida
   * é a fonte da numeração.
   */
  const slots = useMemo(() => slotsCrus.map(s => ({
    ...s,
    grupos: s.grupos.map(g => {
      const secoes = agruparPorSecao(g.opcoes);
      return { ...g, secoes, opcoes: secoes.flatMap(x => x.opcoes) };
    }),
  })), [slotsCrus]);

  const numeradas = useMemo(() => numerarOpcoes(slots), [slots]);
  const [escolhidas, setEscolhidas] = useState<Record<string, number[]>>({});
  const [buffer, setBuffer] = useState('');
  /*
   * Grupos que o atendente REABRIU na mão, pra trocar uma escolha já feita.
   * Guardar a reabertura (em vez de o fechamento) mantém o padrão sendo
   * "decidido = fechado": grupo novo aparece aberto sem precisar de registro.
   */
  const [reaberto, setReaberto] = useState<Record<string, boolean>>({});

  const faltando = faltandoPorSlot(slots, escolhidas);

  /* Sabores liberados depende do TAMANHO escolhido, e tamanho é uma escolha como
     qualquer outra — então isto recalcula a cada tecla, por slot. */
  const saboresPorSlot = useMemo(() => {
    const m = new Map<number, number>();
    for (const s of slots) {
      m.set(s.slot, saboresLiberados(
        /* `{ grupo, escolhidas }` e não o grupo espalhado: a lib precisa das
           OPÇÕES escolhidas (que carregam `sabores`), não dos ids — é no item de
           tamanho que mora quantos sabores ele libera. */
        s.grupos.map(g => {
          const ids = escolhidas[chaveEscolha(s.slot, g.id)] ?? [];
          return { grupo: g, escolhidas: g.opcoes.filter(o => ids.includes(o.id)) };
        }),
      ));
    }
    return m;
  }, [slots, escolhidas]);

  const preco = useMemo(() => {
    let total = precoVigente(produto);
    for (const s of slots) {
      for (const g of s.grupos) {
        const ids = escolhidas[chaveEscolha(s.slot, g.id)] ?? [];
        total += precoDoGrupo(g, g.opcoes.filter(o => ids.includes(o.id)));
      }
    }
    return total;
  }, [produto, slots, escolhidas]);

  /* Texto no mesmo formato do servidor — serve pra linha do carrinho. O valor
     que VALE é sempre o recalculado no servidor; isto é prévia. */
  const texto = useMemo(() => {
    const partes: string[] = [];
    for (const s of slots) {
      for (const g of s.grupos) {
        const ids = escolhidas[chaveEscolha(s.slot, g.id)] ?? [];
        if (ids.length === 0) continue;
        const nomes = g.opcoes.filter(o => ids.includes(o.id)).map(o => o.nome).join(', ');
        partes.push(`${s.rotulo ? `${s.rotulo} | ` : ''}${g.nome}: ${nomes}`);
      }
    }
    return partes.join(' · ');
  }, [slots, escolhidas]);

  function alternar(numero: number) {
    const alvo = numeradas.find(o => o.numero === numero);
    if (!alvo) return;
    const chave = chaveEscolha(alvo.slot, alvo.grupoId);
    const slot = slots.find(s => s.slot === alvo.slot);
    const grupo = slot?.grupos.find(g => g.id === alvo.grupoId);
    if (!slot || !grupo) return;
    setEscolhidas(atual => {
      const atuais = atual[chave] ?? [];
      if (atuais.includes(alvo.opcaoId)) {
        return { ...atual, [chave]: atuais.filter(i => i !== alvo.opcaoId) };
      }
      /* Escolha única TROCA em vez de recusar: no balcão, corrigir o tamanho é
         digitar o outro número, não desmarcar e marcar de novo. */
      if (grupo.tipo === 'unico') return { ...atual, [chave]: [alvo.opcaoId] };
      const max = maxEscolhasEfetivo(grupo, saboresPorSlot.get(alvo.slot) ?? 0);
      /* No teto, o mais ANTIGO sai e o novo entra. Recusar em silêncio faria a
         tecla parecer quebrada; abrir um aviso exigiria ler no meio da fila. */
      const base = max > 0 && atuais.length >= max ? atuais.slice(1) : atuais;
      return { ...atual, [chave]: [...base, alvo.opcaoId] };
    });
  }

  function confirmar() {
    if (faltando.length > 0) return;
    onConfirmar({ opcoes: escolhasParaEnvio(slots, escolhidas), opcoesTexto: texto, precoUnit: preco });
  }

  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); onCancelar(); return; }
      if (e.key === 'Enter') { e.preventDefault(); confirmar(); return; }
      if (e.key === 'Backspace') { e.preventDefault(); setBuffer(''); return; }
      if (!/^[0-9]$/.test(e.key)) return;
      e.preventDefault();
      const r = resolverDigitado(buffer + e.key, numeradas.length);
      setBuffer(r.buffer);
      if (r.aplicar !== null) alternar(r.aplicar);
    }
    /* `capture` pra chegar antes do campo de busca do PDV, que costuma estar com
       o foco: com o painel aberto, o teclado é dele. */
    window.addEventListener('keydown', aoTeclar, true);
    return () => window.removeEventListener('keydown', aoTeclar, true);
  });

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4">
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl bg-card shadow-2xl sm:rounded-2xl">
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-bold leading-tight">{produto.nome}</p>
            <p className="text-[12px] text-muted-foreground">
              Digite o número · Enter adiciona · Esc cancela
            </p>
          </div>
          {/* O buffer aparece porque ele EXPLICA a espera: com 27 opções, o "1"
              não aplica sozinho, e sem ver o dígito na tela o atendente conclui
              que a tecla falhou. */}
          {buffer && (
            <span className="rounded-lg bg-primary px-2.5 py-1 font-mono text-[15px] font-bold text-primary-foreground">
              {buffer}
            </span>
          )}
          <button type="button" onClick={onCancelar} aria-label="Cancelar"
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent">
            <X className="size-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {slots.map(s => (
            <div key={s.slot}>
              {s.rotulo && (
                <p className="px-2 pt-2 text-[11px] font-bold uppercase tracking-wider text-primary">{s.rotulo}</p>
              )}
              {s.grupos.map(g => {
                const chave = chaveEscolha(s.slot, g.id);
                const ids = escolhidas[chave] ?? [];
                const max = maxEscolhasEfetivo(g, saboresPorSlot.get(s.slot) ?? 0);
                const pendente = g.obrigatorio && ids.length === 0;
                /*
                 * GRUPO DECIDIDO ENCOLHE PRA UMA LINHA.
                 *
                 * Com seis tamanhos, 33 sabores e a borda abertos ao mesmo
                 * tempo, a borda ficava FORA DA TELA — e o rodapé anunciava que
                 * ela faltava sem que desse pra vê-la. Cada decisão tomada
                 * deixa de precisar de espaço.
                 *
                 * Os NÚMEROS NÃO MUDAM: `numeradas` é calculado sobre todos os
                 * grupos, sem saber o que está fechado. Renumerar o visível
                 * destruiria a única vantagem da lista, que é decorar o número
                 * — "28 é Camarão" tem que valer com o Tamanho fechado.
                 */
                const fechado = grupoConcluido(g.tipo, ids.length, max) && !reaberto[chave];
                if (fechado) {
                  const nomes = g.opcoes.filter(o => ids.includes(o.id)).map(o => o.nome).join(', ');
                  return (
                    <button
                      key={chave}
                      type="button"
                      onClick={() => setReaberto(r => ({ ...r, [chave]: true }))}
                      className="flex w-full items-baseline gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-accent"
                    >
                      <Check className="size-3.5 shrink-0 translate-y-0.5 text-emerald-600" strokeWidth={3} />
                      <span className="shrink-0 text-[12px] font-bold uppercase tracking-wide">{g.nome}</span>
                      <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{nomes}</span>
                      <span className="shrink-0 text-[11px] font-semibold text-primary">trocar</span>
                    </button>
                  );
                }
                return (
                  <div key={chave} className="mb-1">
                    <div className="flex items-baseline gap-2 px-2 py-1.5">
                      <span className="text-[12px] font-bold uppercase tracking-wide">{g.nome}</span>
                      <span className={cn('text-[11px]', pendente ? 'font-bold text-destructive' : 'text-muted-foreground')}>
                        {g.obrigatorio ? 'obrigatório' : 'opcional'}
                        {max > 0 ? ` · até ${max}` : ''}
                        {ids.length > 0 ? ` · ${ids.length} escolhido(s)` : ''}
                      </span>
                    </div>
                    {g.secoes.map(sec => (
                    <div key={sec.secao}>
                      {/* Cabeçalho só quando a seção TEM nome: loja que não usa
                          seção não deve ganhar título nenhum. */}
                      {sec.secao && (
                        <p className="px-2 pb-0.5 pt-1.5 text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground/80">
                          {sec.secao}
                        </p>
                      )}
                    {/* Duas colunas: a lista de sabores tem 33 itens, e numa coluna
                        não caberia sem rolagem — o gesto que esta tela evita. */}
                    <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
                      {sec.opcoes.map(o => {
                        const achado = numeradas.find(
                          x => x.slot === s.slot && x.grupoId === g.id && x.opcaoId === o.id);
                        if (!achado) return null;
                        const ativo = ids.includes(o.id);
                        return (
                          <button
                            key={o.id}
                            type="button"
                            onClick={() => alternar(achado.numero)}
                            className={cn(
                              'flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13.5px] transition-colors',
                              ativo ? 'bg-primary/[0.12] font-semibold' : 'hover:bg-accent',
                              /* `esgotado` e não `disponivel`: é como o tipo do
                                 frontend marca opção indisponível. */
                              (o as { esgotado?: boolean }).esgotado && 'opacity-40',
                            )}
                          >
                            <span className={cn(
                              'flex size-6 shrink-0 items-center justify-center rounded-md font-mono text-[12px] font-bold',
                              ativo ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
                            )}>{achado.numero}</span>
                            <span className="min-w-0 flex-1 truncate">{o.nome}</span>
                            {o.preco_adicional_centavos > 0 && (
                              <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground">
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
                );
              })}
            </div>
          ))}
        </div>

        <div className="flex items-center gap-3 border-t border-border px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-[17px] font-extrabold leading-none tabular-nums">{brl(preco)}</p>
            {/* O que falta, NOMEADO. "Faltam escolhas" manda o atendente procurar
                numa tela que ele já está olhando. */}
            {faltando.length > 0 && (
              <p className="mt-1 truncate text-[11.5px] font-semibold text-destructive">
                Falta: {faltando.map(f => f.rotulo).join(', ')}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={confirmar}
            disabled={faltando.length > 0}
            className="rounded-xl bg-primary px-5 py-2.5 text-[14px] font-bold text-primary-foreground disabled:opacity-40"
          >
            Adicionar
          </button>
        </div>
      </div>
    </div>
  );
}
