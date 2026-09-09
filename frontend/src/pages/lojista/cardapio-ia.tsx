/**
 * MONTAR O CARDÁPIO ESCREVENDO O QUE A LOJA VENDE.
 *
 * O lojista digita como fala; a IA devolve uma PROPOSTA; ele revisa e cria.
 *
 * Por que existe: hoje o jeito rápido de povoar cardápio é importar do iFood, o
 * que só serve para quem já está no iFood. Quem está começando digita item por
 * item — e é aí que desiste do cadastro.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * O QUE ESTA TELA NÃO FAZ
 *
 * Não cria nada sozinha, e não deixa criar produto sem preço. A IA propõe
 * texto; preço é dinheiro, e quem decide preço é o dono. Item que voltou sem
 * preço aparece marcado e o botão de criar fica travado até ser preenchido —
 * porque um preço plausível chutado passa despercebido e vira venda no
 * prejuízo, enquanto preço vazio grita.
 * ─────────────────────────────────────────────────────────────────────────
 */
import { useState } from 'react';
import { Loader2, Sparkles, X, AlertTriangle, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api, ApiError } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { brl } from '@/lib/format';

interface OpcaoProposta { nome: string; precoCentavos: number }
interface GrupoProposto {
  nome: string; obrigatorio: boolean; min: number; max: number; opcoes: OpcaoProposta[];
}
interface ProdutoProposto {
  nome: string; descricao: string; categoria: string;
  precoCentavos: number | null; grupos: GrupoProposto[];
}
interface Proposta {
  produtos: ProdutoProposto[];
  categorias: string[];
  semPreco: string[];
  descartados: string[];
}

const EXEMPLO = 'Ex.: pizzaria. Pizza grande 40cm de calabresa, mussarela ou portuguesa a 65 reais; média 30cm a 45. Borda de catupiry ou cheddar mais 8. Refrigerante 2 litros 12, lata 6. Água 4.';

export function MontarCardapioIA({ aberto, aoFechar, aoCriar }: {
  aberto: boolean;
  aoFechar: () => void;
  /** Chamado depois de criar, para a lista recarregar. */
  aoCriar: () => void;
}) {
  const { mostrar } = useToast();
  const [descricao, setDescricao] = useState('');
  const [proposta, setProposta] = useState<Proposta | null>(null);
  const [precos, setPrecos] = useState<Record<number, string>>({});
  const [pensando, setPensando] = useState(false);
  const [criando, setCriando] = useState(false);
  const [progresso, setProgresso] = useState(0);
  const [falhas, setFalhas] = useState<string[]>([]);

  if (!aberto) return null;

  async function pedirProposta() {
    setPensando(true);
    setFalhas([]);
    try {
      const p = await api<Proposta>('POST', '/api/lojista/cardapio/sugerir', { descricao });
      setProposta(p);
      /* Os preços que vieram entram como texto editável em reais; os nulos
         ficam vazios de propósito, para o campo cobrar sozinho. */
      const iniciais: Record<number, string> = {};
      p.produtos.forEach((prod, i) => {
        iniciais[i] = prod.precoCentavos === null ? '' : String(prod.precoCentavos / 100);
      });
      setPrecos(iniciais);
      if (p.produtos.length === 0) {
        mostrar({
          tipo: 'erro',
          titulo: 'Não deu para montar com essa descrição.',
          descricao: 'Diga os itens e os preços, como no exemplo.',
        });
      }
    } catch (err) {
      mostrar({
        tipo: 'erro',
        titulo: err instanceof ApiError ? err.message : 'Não deu para montar o cardápio agora.',
      });
    } finally {
      setPensando(false);
    }
  }

  const semPreco = proposta
    ? proposta.produtos.filter((_, i) => !precos[i] || Number(precos[i]) <= 0).length
    : 0;

  async function criar() {
    if (!proposta || semPreco > 0) return;
    setCriando(true);
    setProgresso(0);
    const problemas: string[] = [];

    for (let i = 0; i < proposta.produtos.length; i++) {
      const p = proposta.produtos[i];
      try {
        /*
         * REUSA OS ENDPOINTS QUE JÁ EXISTEM — produto, grupo, opção — em vez de
         * um "criar em lote" novo. São as mesmas validações e a mesma checagem
         * de posse de sempre, e nada de caminho de escrita paralelo para
         * manter em pé.
         */
        const r = await api<{ produto_id: number }>('POST', '/api/lojista/produtos', {
          nome: p.nome,
          descricao: p.descricao,
          categoria: p.categoria || 'Geral',
          subcategoria: '',
          preco: Number(precos[i]),
          foto_url: '',
          /*
           * NASCE PAUSADO. O dono revisou os PREÇOS nesta tela; a descrição foi
           * escrita pela IA e ninguém leu com calma. Publicar direto é deixar
           * texto não revisado na frente do cliente. Depois de conferir, a
           * seleção em massa liga tudo de uma vez.
           */
          disponivel: false,
          disponivel_pdv: false,
          destaque: false,
          vendido_sozinho: true,
          vendido_por: 'unidade',
          codigo_barras: '',
          controla_estoque: false,
          estoque: 0,
        });

        let ordem = 0;
        for (const g of p.grupos) {
          const grupo = await api<{ grupo_id: number }>(
            'POST', `/api/lojista/produtos/${r.produto_id}/grupos`, {
              nome: g.nome,
              tipo: g.max > 1 ? 'multiplo' : 'unico',
              obrigatorio: g.obrigatorio,
              max_escolhas: g.max > 1 ? String(g.max) : '',
              papel: '',
              modo_preco: 'somar',
              ordem: ordem++,
            });
          for (const o of g.opcoes) {
            await api('POST', `/api/lojista/grupos/${grupo.grupo_id}/opcoes`, {
              nome: o.nome,
              preco_adicional: String(o.precoCentavos / 100),
              secao: '', descricao: '', imagem: '',
            });
          }
        }
      } catch (err) {
        /* Um produto que falha NÃO para os outros: melhor 28 de 30 criados com
           a lista do que zero e um erro genérico. */
        problemas.push(`${p.nome}: ${err instanceof ApiError ? err.message : 'falhou'}`);
      }
      setProgresso(i + 1);
    }

    setCriando(false);
    setFalhas(problemas);
    aoCriar();

    if (problemas.length === 0) {
      mostrar({
        tipo: 'sucesso',
        titulo: `${proposta.produtos.length} produto(s) criado(s), pausados.`,
        descricao: 'Confira os textos e publique pela seleção em massa.',
      });
      setProposta(null);
      setDescricao('');
      aoFechar();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:p-8">
      <div className="w-full max-w-2xl rounded-2xl border border-border bg-background shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            <h2 className="text-[15px] font-bold">Montar cardápio escrevendo</h2>
          </div>
          <button type="button" onClick={aoFechar} className="text-muted-foreground hover:text-foreground">
            <X className="size-5" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          {!proposta ? (
            <>
              <p className="text-[13px] leading-relaxed text-muted-foreground">
                Escreva o que a loja vende, com os preços, do jeito que você falaria.
                A gente monta a lista e você confere antes de criar — nada vai pro ar sozinho.
              </p>
              <textarea
                value={descricao}
                onChange={e => setDescricao(e.target.value)}
                rows={7}
                maxLength={4000}
                placeholder={EXEMPLO}
                className="w-full resize-none rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
              <div className="flex items-center justify-between gap-3">
                <span className="text-[11.5px] text-muted-foreground">
                  {descricao.length}/4000 — diga os preços, senão eles voltam em branco
                </span>
                <Button type="button" onClick={pedirProposta} disabled={pensando || descricao.trim().length < 10}>
                  {pensando ? <><Loader2 className="size-4 animate-spin" /> Montando…</> : <><Sparkles className="size-4" /> Montar</>}
                </Button>
              </div>
            </>
          ) : (
            <>
              {semPreco > 0 && (
                <div className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2.5">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
                  <p className="text-[12.5px] leading-snug">
                    <b>{semPreco} item(ns) sem preço.</b> A descrição não disse quanto custam, e
                    a gente não chuta preço — preencha para poder criar.
                  </p>
                </div>
              )}

              <div className="max-h-[45vh] space-y-3 overflow-y-auto">
                {proposta.categorias.map(cat => (
                  <div key={cat}>
                    <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{cat}</p>
                    <div className="space-y-1.5">
                      {proposta.produtos.map((p, i) => p.categoria === cat && (
                        <div key={i} className="rounded-xl border border-border p-2.5">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <p className="text-[13.5px] font-semibold">{p.nome}</p>
                              {p.descricao && (
                                <p className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">{p.descricao}</p>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span className="text-[11.5px] text-muted-foreground">R$</span>
                              <input
                                value={precos[i] ?? ''}
                                onChange={e => setPrecos(v => ({ ...v, [i]: e.target.value.replace(',', '.') }))}
                                inputMode="decimal"
                                placeholder="0,00"
                                className={cnPreco(!precos[i] || Number(precos[i]) <= 0)}
                              />
                            </div>
                          </div>
                          {p.grupos.length > 0 && (
                            <ul className="mt-1.5 space-y-0.5 border-t border-border pt-1.5">
                              {p.grupos.map((g, gi) => (
                                <li key={gi} className="text-[11.5px] text-muted-foreground">
                                  · <b className="text-foreground">{g.nome}</b>{' '}
                                  {g.obrigatorio ? 'obrigatório' : 'opcional'}, até {g.max} —{' '}
                                  {g.opcoes.map(o => o.nome + (o.precoCentavos ? ` (+${brl(o.precoCentavos)})` : '')).join(', ')}
                                  {/* min > 1 não é expressável: o grupo só tem
                                      "obrigatório" e "máximo". Melhor dizer que
                                      falta ajustar do que perder em silêncio. */}
                                  {g.min > 1 && (
                                    <b className="text-amber-600"> · ajuste o mínimo ({g.min}) depois</b>
                                  )}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {proposta.descartados.length > 0 && (
                <p className="text-[11.5px] text-muted-foreground">
                  Descartados por vir incompletos: {proposta.descartados.join('; ')}
                </p>
              )}

              {falhas.length > 0 && (
                <div className="rounded-xl border border-destructive/40 bg-destructive/5 px-3 py-2.5">
                  <p className="text-[12.5px] font-semibold">Alguns não foram criados:</p>
                  <ul className="mt-1 space-y-0.5">
                    {falhas.map((f, i) => <li key={i} className="text-[11.5px] text-muted-foreground">· {f}</li>)}
                  </ul>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
                <Button type="button" onClick={criar} disabled={criando || semPreco > 0}>
                  {criando
                    ? <><Loader2 className="size-4 animate-spin" /> Criando {progresso}/{proposta.produtos.length}…</>
                    : <><Check className="size-4" /> Criar {proposta.produtos.length} produto(s)</>}
                </Button>
                <Button type="button" variant="outline" onClick={() => setProposta(null)} disabled={criando}>
                  Reescrever
                </Button>
                <span className="text-[11.5px] text-muted-foreground">
                  Criados pausados — confira e publique pela seleção em massa.
                </span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Campo de preço: fica visivelmente vazio quando falta, porque é bloqueio. */
function cnPreco(faltando: boolean): string {
  return [
    'h-9 w-[92px] rounded-lg border px-2 text-right text-[13px] outline-none',
    faltando ? 'border-amber-500 bg-amber-500/10' : 'border-input bg-background',
  ].join(' ');
}
