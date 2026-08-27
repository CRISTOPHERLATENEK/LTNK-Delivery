/**
 * COMPLEMENTOS NO PDV — duas colunas, sem badge, sem faixa de aviso.
 *
 * A versão anterior era uma coluna só: o operador não via o que já tinha
 * escolhido, o total não se compunha e a Borda ficava fora da tela. A clareza
 * vem da ESTRUTURA — a esquerda oferece, a direita confirma — e não de cor.
 *
 * O painel da direita é a FONTE DA VERDADE do que foi escolhido. É ele que
 * permite duas coisas que a lista sozinha não permitia: conferir sem rolar de
 * volta, e remover um item específico.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Minus, Plus, X } from 'lucide-react';
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
  quantidade: number;
}

/** Quanto tempo o eco da digitação fica na tela depois de aplicar. */
const ECO_MS = 1400;
/** Abaixo disto o painel da direita vira faixa no rodapé. */
const LARGURA_DUAS_COLUNAS = 1100;

export function EscolhaRapida({ produto, onCancelar, onConfirmar }: {
  produto: Produto;
  onCancelar: () => void;
  onConfirmar: (r: EscolhaFeita) => void;
}) {
  const slotsCrus = useMemo(() => montarSlots(produto), [produto]);

  /*
   * AS SEÇÕES ENTRAM AQUI — e a numeração TEM que seguir a ordem exibida.
   *
   * `agruparPorSecao` pode REORDENAR: o bloco sem seção vai pra frente, pra uma
   * opção sem seção não aparecer sob o título "Doces" e ser lida como doce.
   * Numerar por `g.opcoes` e exibir por seção faria o número apontar pro sabor
   * errado. Então a lista exibida é a fonte da numeração.
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
  const [quantidade, setQuantidade] = useState(1);
  /** O eco da digitação: número aplicado com o nome, ou número inexistente. */
  const [eco, setEco] = useState<{ txt: string; erro: boolean } | null>(null);

  /* Duas colunas só cabem em tela larga. `matchMedia` em vez de variante do
     Tailwind porque 1100px não é breakpoint padrão, e inventar um em classe
     arbitrária esconderia a regra de quem for mexer depois. */
  const [largo, setLargo] = useState(() =>
    typeof window === 'undefined' ? true : window.innerWidth > LARGURA_DUAS_COLUNAS);
  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${LARGURA_DUAS_COLUNAS + 1}px)`);
    const ao = () => setLargo(mq.matches);
    ao();
    mq.addEventListener('change', ao);
    return () => mq.removeEventListener('change', ao);
  }, []);

  const faltando = faltandoPorSlot(slots, escolhidas);

  const areaRolagem = useRef<HTMLDivElement | null>(null);
  /* Indexada por `slot:grupo`: num combo, dois slots têm o MESMO grupo, e o id
     sozinho guardaria uma ref só — o pulo levaria sempre à primeira pizza. */
  const refsGrupo = useRef<Record<string, HTMLDivElement | null>>({});

  function irPara(chave: string) {
    const area = areaRolagem.current;
    const alvo = refsGrupo.current[chave];
    if (!area || !alvo) return;
    /* Não rola se já está visível: rolar de qualquer jeito arrancaria a vista do
       lugar a cada escolha, e a correção viraria o incômodo. */
    const r = alvo.getBoundingClientRect();
    const c = area.getBoundingClientRect();
    if (r.top >= c.top && r.bottom <= c.bottom) return;
    /* `scrollTop` no container, NUNCA `scrollIntoView`: este último rola a
       página atrás do modal e a tela do PDV volta pro topo sozinha. */
    area.scrollTop += r.top - c.top - 8;
  }

  const saboresPorSlot = useMemo(() => {
    const m = new Map<number, number>();
    for (const s of slots) {
      m.set(s.slot, saboresLiberados(
        s.grupos.map(g => {
          const ids = escolhidas[chaveEscolha(s.slot, g.id)] ?? [];
          return { grupo: g, escolhidas: g.opcoes.filter(o => ids.includes(o.id)) };
        }),
      ));
    }
    return m;
  }, [slots, escolhidas]);

  const base = precoVigente(produto);
  const acrescimos = useMemo(() => {
    let total = 0;
    for (const s of slots) {
      for (const g of s.grupos) {
        const ids = escolhidas[chaveEscolha(s.slot, g.id)] ?? [];
        total += precoDoGrupo(g, g.opcoes.filter(o => ids.includes(o.id)));
      }
    }
    return total;
  }, [slots, escolhidas]);
  const preco = base + acrescimos;

  /* Texto no formato que o servidor grava. O valor que VALE é sempre o
     recalculado lá; isto é prévia. */
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

  /** Quantos grupos obrigatórios já têm escolha — o subtítulo do cabeçalho. */
  const progresso = useMemo(() => {
    let total = 0; let feitos = 0;
    for (const s of slots) {
      for (const g of s.grupos) {
        if (!g.obrigatorio) continue;
        total += 1;
        if ((escolhidas[chaveEscolha(s.slot, g.id)] ?? []).length > 0) feitos += 1;
      }
    }
    return { total, feitos };
  }, [slots, escolhidas]);

  const algoEscolhido = useMemo(
    () => Object.values(escolhidas).some(v => v.length > 0), [escolhidas]);

  function noTeto(slot: number, g: { tipo: string }, ids: number[], max: number) {
    return g.tipo !== 'unico' && max > 0 && ids.length >= max;
  }

  function alternar(numero: number) {
    const alvo = numeradas.find(o => o.numero === numero);
    if (!alvo) return;
    const chave = chaveEscolha(alvo.slot, alvo.grupoId);
    const slot = slots.find(s => s.slot === alvo.slot);
    const grupo = slot?.grupos.find(g => g.id === alvo.grupoId);
    if (!slot || !grupo) return;
    const max = maxEscolhasEfetivo(grupo, saboresPorSlot.get(alvo.slot) ?? 0);
    setEscolhidas(atual => {
      const atuais = atual[chave] ?? [];
      if (atuais.includes(alvo.opcaoId)) {
        return { ...atual, [chave]: atuais.filter(i => i !== alvo.opcaoId) };
      }
      /* Escolha única TROCA: corrigir o tamanho é digitar o outro número, não
         desmarcar e marcar de novo. */
      if (grupo.tipo === 'unico') return { ...atual, [chave]: [alvo.opcaoId] };
      /*
       * NO TETO, O CLIQUE É IGNORADO — antes o mais antigo era descartado.
       *
       * A troca silenciosa fazia sentido quando não havia onde ver o que estava
       * escolhido: recusar sem dizer nada faria a tecla parecer quebrada. Agora
       * o painel da direita mostra tudo e tem o `x` pra remover, e o item no
       * teto fica esmaecido — o operador vê o limite e escolhe o que sai.
       */
      if (noTeto(alvo.slot, grupo, atuais, max)) return atual;
      return { ...atual, [chave]: [...atuais, alvo.opcaoId] };
    });
  }

  function remover(chave: string, opcaoId: number) {
    setEscolhidas(a => ({ ...a, [chave]: (a[chave] ?? []).filter(i => i !== opcaoId) }));
  }

  function confirmar() {
    /* Incompleto NÃO é botão morto: ele leva ao que falta. Desabilitado de
       verdade parece clicável e não diz o que fazer. */
    if (faltando.length > 0) { irPara(faltando[0].chave); return; }
    onConfirmar({
      opcoes: escolhasParaEnvio(slots, escolhidas),
      opcoesTexto: texto,
      precoUnit: preco,
      quantidade,
    });
  }

  /* O eco some sozinho. Sem o tempo ele viraria resíduo permanente da última
     tecla, e o operador leria como se ainda estivesse digitando. */
  useEffect(() => {
    if (!eco) return;
    const t = setTimeout(() => setEco(null), ECO_MS);
    return () => clearTimeout(t);
  }, [eco]);

  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); onCancelar(); return; }
      if (e.key === 'Enter') { e.preventDefault(); confirmar(); return; }
      if (e.key === 'Backspace') { e.preventDefault(); setBuffer(''); setEco(null); return; }
      if (!/^[0-9]$/.test(e.key)) return;
      e.preventDefault();
      const tentativa = buffer + e.key;
      const r = resolverDigitado(tentativa, numeradas.length);
      setBuffer(r.buffer);
      if (r.aplicar !== null) {
        const alvo = numeradas.find(o => o.numero === r.aplicar);
        const slot = slots.find(s => s.slot === alvo?.slot);
        const g = slot?.grupos.find(x => x.id === alvo?.grupoId);
        const nome = g?.opcoes.find(o => o.id === alvo?.opcaoId)?.nome ?? '';
        setEco({ txt: `${r.aplicar} · ${nome}`, erro: false });
        alternar(r.aplicar);
      } else if (r.buffer === '') {
        /*
         * Buffer limpo sem aplicar = número FORA da lista, e dizer isso é o
         * ponto: antes sumia calado e o operador concluía que a tecla falhou.
         */
        setEco({ txt: `${tentativa} · não existe`, erro: true });
      }
    }
    window.addEventListener('keydown', aoTeclar, true);
    return () => window.removeEventListener('keydown', aoTeclar, true);
  });

  /* Pula pro próximo pendente na TRANSIÇÃO: sem comparar com o anterior, cada
     tecla dentro de um grupo já completo puxaria a tela de novo. */
  const completosAntes = useRef<Set<string>>(new Set());
  useEffect(() => {
    const completos = new Set<string>();
    for (const s of slots) {
      for (const g of s.grupos) {
        const chave = chaveEscolha(s.slot, g.id);
        const ids = escolhidas[chave] ?? [];
        const max = maxEscolhasEfetivo(g, saboresPorSlot.get(s.slot) ?? 0);
        if (grupoConcluido(g.tipo, ids.length, max)) completos.add(chave);
      }
    }
    let novo = false;
    for (const c of completos) if (!completosAntes.current.has(c)) novo = true;
    completosAntes.current = completos;
    if (novo && faltando[0]) irPara(faltando[0].chave);
  }, [escolhidas]);

  const completo = faltando.length === 0;

  /* ── total, quantidade e ação: o que decide a venda ── */
  const rodape = (
    <div className="space-y-3 border-t border-border p-4">
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[12.5px] text-muted-foreground">Total</p>
          {/* A COMPOSIÇÃO do total, não só o número: "R$ 45,00 + R$ 22,00" deixa
              conferir de onde veio o valor sem somar de cabeça. Some quando não
              há acréscimo — "+ R$ 0,00" é ruído. */}
          {acrescimos > 0 && (
            <p className="truncate text-[11.5px] text-muted-foreground/70">
              {brl(base)} + {brl(acrescimos)}
            </p>
          )}
        </div>
        <p className="shrink-0 text-[26px] font-extrabold leading-none tabular-nums">
          {brl(preco * quantidade)}
        </p>
      </div>

      <div className="flex items-center gap-2">
        <div className="flex shrink-0 items-center gap-1 rounded-xl border border-border p-0.5">
          <button
            type="button" aria-label="Diminuir"
            onClick={() => setQuantidade(q => Math.max(1, q - 1))}
            disabled={quantidade === 1}
            className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent disabled:opacity-25"
          ><Minus className="size-3.5" /></button>
          <span className="w-6 text-center text-[14px] font-bold tabular-nums">{quantidade}</span>
          <button
            type="button" aria-label="Aumentar"
            onClick={() => setQuantidade(q => Math.min(30, q + 1))}
            disabled={quantidade === 30}
            className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent disabled:opacity-25"
          ><Plus className="size-3.5" /></button>
        </div>
        <button
          type="button"
          onClick={confirmar}
          className={cn(
            'h-11 min-w-0 flex-1 whitespace-nowrap rounded-xl px-4 text-[14px] font-bold transition-colors',
            completo
              ? 'bg-primary text-primary-foreground'
              : 'border border-border bg-muted/40 text-muted-foreground hover:bg-muted',
          )}
        >
          {completo ? 'Adicionar à venda' : `Escolha ${faltando[0].rotulo.toLowerCase()}`}
        </button>
      </div>

      {/* A pendência em UMA FRASE, sem faixa. Cada nome leva ao grupo. */}
      {!completo && (
        <p className="flex flex-wrap items-baseline gap-x-1 text-[12px] text-muted-foreground">
          <span>Falta escolher</span>
          {faltando.map((f, i) => (
            <button
              key={f.chave} type="button" onClick={() => irPara(f.chave)}
              className="font-semibold text-primary underline underline-offset-2 hover:no-underline"
            >
              {f.rotulo.toLowerCase()}{i < faltando.length - 1 ? ',' : ''}
            </button>
          ))}
        </p>
      )}
    </div>
  );

  const listaEscolhidas = (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      {!algoEscolhido ? (
        <p className="text-[13px] leading-relaxed text-muted-foreground/60">
          Nada escolhido ainda.<br />Clique nos itens ou digite o número.
        </p>
      ) : (
        slots.map(s => s.grupos.map(g => {
          const chave = chaveEscolha(s.slot, g.id);
          const ids = escolhidas[chave] ?? [];
          if (ids.length === 0) return null;
          return (
            <div key={chave} className="mb-3">
              <p className="mb-1 text-[12.5px] text-muted-foreground">
                {s.rotulo ? `${s.rotulo} · ` : ''}{g.nome}
              </p>
              {g.opcoes.filter(o => ids.includes(o.id)).map(o => (
                <div key={o.id} className="flex items-baseline gap-2 py-0.5">
                  <span className="min-w-0 flex-1 truncate text-[14.5px] font-semibold">{o.nome}</span>
                  {o.preco_adicional_centavos > 0 && (
                    <span className="shrink-0 text-[12.5px] tabular-nums text-muted-foreground">
                      {brl(o.preco_adicional_centavos)}
                    </span>
                  )}
                  <button
                    type="button" aria-label={`Remover ${o.nome}`}
                    onClick={() => remover(chave, o.id)}
                    className="shrink-0 text-muted-foreground/40 transition-colors hover:text-destructive"
                  ><X className="size-3.5" /></button>
                </div>
              ))}
            </div>
          );
        }))
      )}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4">
      <div className={cn(
        'flex w-full max-h-[92vh] max-w-[1040px] flex-col overflow-hidden rounded-t-2xl bg-card shadow-2xl sm:rounded-2xl',
        largo && 'h-[700px]',
      )}>
        {/* ── cabeçalho ── */}
        <div className="flex items-start gap-3 border-b border-border px-5 py-3.5">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[18px] font-extrabold leading-tight">{produto.nome}</p>
            <p className="text-[12.5px] text-muted-foreground">
              {progresso.total === 0
                ? 'Complementos opcionais'
                : completo
                  ? 'Tudo escolhido'
                  : `${progresso.feitos} de ${progresso.total} escolhas feitas`}
            </p>
          </div>
          {/* O ECO da digitação, sem moldura e sem legenda de teclas: quem usa o
              atalho já sabe, e quem não usa não precisa aprender agora. */}
          {(eco || buffer) && (
            <p className={cn(
              'shrink-0 truncate pt-1 font-mono text-[12.5px]',
              eco?.erro ? 'text-destructive' : 'text-muted-foreground',
            )}>
              {eco ? eco.txt : buffer}
            </p>
          )}
          <button type="button" onClick={onCancelar} aria-label="Fechar"
            className="flex size-[34px] shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent">
            <X className="size-4" />
          </button>
        </div>

        <div className={cn('flex min-h-0 flex-1', largo ? 'flex-row' : 'flex-col')}>
          {/* ── esquerda: os grupos ── */}
          <div ref={areaRolagem} className="min-h-0 flex-1 overflow-y-auto">
            {slots.map(s => (
              <div key={s.slot}>
                {s.rotulo && (
                  <p className="px-5 pt-3 text-[11px] font-bold uppercase tracking-wider text-primary">{s.rotulo}</p>
                )}
                {s.grupos.map(g => {
                  const chave = chaveEscolha(s.slot, g.id);
                  const ids = escolhidas[chave] ?? [];
                  const max = maxEscolhasEfetivo(g, saboresPorSlot.get(s.slot) ?? 0);
                  const satisfeito = grupoConcluido(g.tipo, ids.length, max);
                  const teto = noTeto(s.slot, g, ids, max);
                  /* A REGRA DO GRUPO EM TEXTO, na mesma linha do nome. Badge
                     colorido gritaria mais que o nome do produto; o estado cabe
                     em cinza, e só o satisfeito ganha um tom. */
                  const regra = g.tipo === 'unico'
                    ? (ids.length > 0 ? 'escolhido' : 'escolha 1')
                    : max > 0
                      ? (ids.length > 0 ? `${ids.length} de ${max} escolhidos` : `escolha até ${max}`)
                      : (ids.length > 0 ? `${ids.length} escolhidos` : 'escolha à vontade');
                  return (
                    <div key={chave} ref={el => { refsGrupo.current[chave] = el; }}>
                      <div className="sticky top-0 z-10 flex items-baseline gap-2 bg-card px-5 pb-1.5 pt-3">
                        <span className="shrink-0 text-[15px] font-extrabold">{g.nome}</span>
                        <span className={cn('shrink-0 text-[12.5px]',
                          satisfeito ? 'text-emerald-700/80 dark:text-emerald-400/80' : 'text-muted-foreground')}>
                          {regra}
                        </span>
                        <span className="h-px flex-1 translate-y-[-2px] bg-border" />
                      </div>
                      {g.secoes.map(sec => (
                        <div key={sec.secao}>
                          {sec.secao && (
                            <p className="px-5 pb-0.5 pt-2 text-[12px] text-muted-foreground/60">{sec.secao}</p>
                          )}
                          <div className="grid grid-cols-1 gap-x-6 px-5 sm:grid-cols-2">
                            {sec.opcoes.map(o => {
                              const achado = numeradas.find(
                                x => x.slot === s.slot && x.grupoId === g.id && x.opcaoId === o.id);
                              if (!achado) return null;
                              const ativo = ids.includes(o.id);
                              const bloqueado = teto && !ativo;
                              /* Alvo da digitação: enquanto o buffer não resolve
                                 sozinho, mostra QUEM ele ainda pode virar. */
                              const alvoDigitado = buffer !== '' && String(achado.numero).startsWith(buffer);
                              return (
                                <button
                                  key={o.id}
                                  type="button"
                                  onClick={() => { if (!bloqueado) alternar(achado.numero); }}
                                  className={cn(
                                    'flex h-10 items-center gap-2.5 border-b border-border/40 text-left text-[14.5px]',
                                    ativo && 'bg-primary/[0.06] font-bold',
                                    alvoDigitado && !ativo && 'bg-muted',
                                    bloqueado ? 'cursor-not-allowed opacity-35' : 'hover:bg-accent/60',
                                  )}
                                >
                                  <span className="flex w-[18px] shrink-0 justify-center">
                                    {ativo
                                      ? <Check className="size-[17px] text-primary" strokeWidth={3} />
                                      : (
                                        <span className={cn('font-mono text-[12.5px]',
                                          alvoDigitado ? 'font-bold text-foreground' : 'text-muted-foreground')}>
                                          {achado.numero}
                                        </span>
                                      )}
                                  </span>
                                  <span className="min-w-0 flex-1 truncate">{o.nome}</span>
                                  {/* Preço só quando existe. Escrever "incluso"
                                      quinze vezes é ruído, não informação. */}
                                  {o.preco_adicional_centavos > 0 && (
                                    <span className="shrink-0 pr-1 text-[13px] tabular-nums text-muted-foreground">
                                      + {brl(o.preco_adicional_centavos)}
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

          {/* ── direita: o que foi escolhido ── */}
          {largo ? (
            <aside className="box-border flex w-[284px] shrink-0 flex-col border-l border-border">
              {listaEscolhidas}
              {rodape}
            </aside>
          ) : (
            /* Em tela estreita a lista de escolhidos empurraria os grupos pra
               fora; sobra o que decide a ação — total, pendência e botão. */
            <div className="shrink-0">{rodape}</div>
          )}
        </div>
      </div>
    </div>
  );
}
