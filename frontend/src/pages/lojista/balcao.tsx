/**
 * PDV / Balcão — venda rápida no caixa. Toca nos produtos, monta a venda,
 * cobra (com troco no dinheiro) e finaliza. Registra como pedido origem='balcao'
 * (entra no faturamento). Imprime cupom ao concluir.
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ShoppingCart, Search, Plus, Minus, Trash2, Banknote, QrCode, CreditCard,
  Check, Printer, Receipt, ChefHat, Barcode, Scale, X, UtensilsCrossed,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { api, ApiError, sessaoUsuario } from '@/lib/api';
import { brl } from '@/lib/format';
import { cn } from '@/lib/utils';
import { imprimirCupom, imprimirDanfe, montarHtmlDanfe, configImpressao, type LinhaCupom, type DadosDanfe } from '@/lib/impressao';
import { agenteAtivo, buscarConfigFiscal } from '@/lib/agente';
import type { Produto, Loja } from '@/types';

type Pagamento = 'dinheiro' | 'pix' | 'cartao';
// Contador de linhas do carrinho: dá a cada linha um id estável, pra key do
// React e pra remoção não dependerem do índice (o mesmo produto pode aparecer
// em várias linhas quando vendido por peso).
let seqLinhaCarrinho = 0;
const novaLinhaUid = () => `l${++seqLinhaCarrinho}`;

interface ItemCarrinho {
  uid: string;
  produto: Produto;
  quantidade: number;
  precoUnit: number;
  /** Peso em gramas (só produtos vendidos por kg). */
  pesoG?: number;
  /** Texto descritivo da linha (ex.: "0,350 kg × R$ 39,90/kg"). */
  detalhe?: string;
}

function precoDe(p: Produto): number {
  return (p.preco_promocional_centavos && p.preco_promocional_centavos > 0)
    ? p.preco_promocional_centavos : p.preco_centavos;
}

type NfceResultado = DadosDanfe & { xml: string };

const ehPeso = (p: Produto) => p.vendido_por === 'kg';

/**
 * Interpreta um código bipado. Reconhece:
 *  - EAN/PLU exato cadastrado no produto (produto por unidade ou peso fixo)
 *  - Etiqueta de balança EAN-13 prefixo 2: dígitos 2–7 = PLU, 8–12 = peso em gramas
 */
function lerCodigoBarras(bruto: string, produtos: Produto[]): { produto: Produto; pesoG?: number } | null {
  const code = bruto.replace(/\D/g, '');
  if (!code) return null;
  const exato = produtos.find(p => p.codigo_barras && p.codigo_barras === code);
  if (exato) return { produto: exato };
  if (code.length === 13 && code[0] === '2') {
    const plu = String(Number(code.slice(1, 7)));
    const pesoG = Number(code.slice(7, 12));
    const p = produtos.find(x => x.codigo_barras && String(Number(x.codigo_barras)) === plu);
    if (p) return { produto: p, pesoG: pesoG > 0 ? pesoG : undefined };
  }
  return null;
}

export function BalcaoLoja() {
  const { mostrar } = useToast();
  const qc = useQueryClient();
  const [busca, setBusca] = useState('');
  const [categoria, setCategoria] = useState<string | null>(null);
  const [carrinho, setCarrinho] = useState<ItemCarrinho[]>([]);
  const [pagamento, setPagamento] = useState<Pagamento>('dinheiro');
  const [descontoStr, setDescontoStr] = useState('');
  const [recebidoStr, setRecebidoStr] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [codigo, setCodigo] = useState('');
  const [pesando, setPesando] = useState<Produto | null>(null);
  const [nfce, setNfce] = useState<NfceResultado | null>(null);

  const produtosQ = useQuery({
    queryKey: ['lojista-produtos'],
    queryFn: () => api<{ produtos: Produto[] }>('GET', '/api/lojista/produtos').then(r => r.produtos),
  });

  const hojeQ = useQuery({
    queryKey: ['balcao-hoje'],
    queryFn: () => api<{ total_centavos: number; quantidade: number }>('GET', '/api/lojista/balcao/hoje'),
  });

  const lojaQ = useQuery({
    queryKey: ['lojista-loja'],
    queryFn: () => api<{ loja: Loja }>('GET', '/api/lojista/loja').then(r => r.loja),
  });

  function imprimirVenda(pedidoId: number) {
    const config = configImpressao(lojaQ.data as unknown as Record<string, unknown>);
    const linhas: LinhaCupom[] = carrinho.map(i => ({
      qtd: i.pesoG ? (i.pesoG / 1000).toFixed(3).replace('.', ',') + ' kg' : String(i.quantidade),
      nome: i.produto.nome,
      valor: brl(i.precoUnit * i.quantidade),
      detalhe: i.detalhe,
      categoria: i.produto.categoria,
    }));
    const totais = [
      { rotulo: 'Subtotal', valor: brl(subtotal) },
      ...(descontoCent > 0 ? [{ rotulo: 'Desconto', valor: '- ' + brl(descontoCent) }] : []),
      { rotulo: 'TOTAL', valor: brl(total), forte: true },
    ];
    const formaTxt = pagamento === 'cartao' ? 'Cartão' : pagamento === 'pix' ? 'Pix' : 'Dinheiro';
    const extras = [
      { rotulo: 'Pagamento', valor: formaTxt },
      ...(troco > 0 ? [{ rotulo: 'Troco', valor: brl(troco) }] : []),
    ];
    imprimirCupom({
      titulo: `VENDA BALCÃO #${pedidoId}`, linhas, totais, extras,
      tipoVenda: 'Balcão', referencia: `#${pedidoId}`,
      atendente: sessaoUsuario('lojista')?.nome,
    }, config);
  }

  const disponiveis = (produtosQ.data ?? []).filter(p => p.disponivel);
  const categorias = useMemo(
    () => Array.from(new Set(disponiveis.map(p => p.categoria).filter(Boolean))),
    [disponiveis],
  );
  const produtosFiltrados = disponiveis.filter(p => {
    const okCat = !categoria || p.categoria === categoria;
    const okBusca = !busca || p.nome.toLowerCase().includes(busca.toLowerCase());
    return okCat && okBusca;
  });

  const subtotal = carrinho.reduce((s, i) => s + i.precoUnit * i.quantidade, 0);
  const descontoCent = Math.min(Math.max(Math.round(parseFloat(descontoStr.replace(',', '.')) * 100) || 0, 0), subtotal);
  const total = subtotal - descontoCent;
  const recebidoCent = Math.round(parseFloat(recebidoStr.replace(',', '.')) * 100) || 0;
  const troco = pagamento === 'dinheiro' && recebidoCent > total ? recebidoCent - total : 0;

  function adicionar(p: Produto) {
    // Produto por peso abre o teclado de peso em vez de somar unidade.
    if (ehPeso(p)) { setPesando(p); return; }
    setCarrinho(c => {
      const i = c.findIndex(x => x.produto.id === p.id && !x.pesoG);
      if (i >= 0) {
        const novo = [...c];
        novo[i] = { ...novo[i], quantidade: novo[i].quantidade + 1 };
        return novo;
      }
      return [...c, { uid: novaLinhaUid(), produto: p, quantidade: 1, precoUnit: precoDe(p) }];
    });
  }

  /** Adiciona um item por peso (gramas) — calcula o preço pela tabela por kg. */
  function adicionarPeso(p: Produto, pesoG: number) {
    if (!pesoG || pesoG <= 0) return;
    const precoLinha = Math.round(precoDe(p) * pesoG / 1000);
    const kg = (pesoG / 1000).toFixed(3).replace('.', ',');
    setCarrinho(c => [...c, {
      uid: novaLinhaUid(), produto: p, quantidade: 1, precoUnit: precoLinha, pesoG,
      detalhe: `${kg} kg × ${brl(precoDe(p))}/kg`,
    }]);
  }

  /** Processa um código bipado/digitado. */
  function adicionarPorCodigo(bruto: string) {
    const r = lerCodigoBarras(bruto, disponiveis);
    setCodigo('');
    if (!r) { mostrar({ tipo: 'erro', titulo: 'Código não encontrado.' }); return; }
    if (ehPeso(r.produto)) {
      if (r.pesoG) adicionarPeso(r.produto, r.pesoG);
      else setPesando(r.produto); // produto por peso sem peso na etiqueta → pede
    } else {
      adicionar(r.produto);
    }
  }
  function mudarQtd(id: number, delta: number) {
    setCarrinho(c => c.flatMap(x => {
      if (x.produto.id !== id || x.pesoG) return [x]; // não mexe em itens por peso
      const q = x.quantidade + delta;
      return q < 1 ? [] : [{ ...x, quantidade: q }];
    }));
  }
  function limpar() {
    setCarrinho([]); setDescontoStr(''); setRecebidoStr('');
  }

  async function enviarCozinha() {
    if (carrinho.length === 0 || enviando) return; // trava clique duplo — sem isso, dois cliques rápidos duplicavam os itens na cozinha
    setEnviando(true);
    try {
      const r = await api<{ itens_enviados: number }>('POST', '/api/lojista/balcao/enviar-cozinha', {
        itens: carrinho.map(i => ({ produto_id: i.produto.id, quantidade: i.quantidade })),
      });
      mostrar({ tipo: 'sucesso', titulo: `${r.itens_enviados} item(ns) enviados à cozinha 🍳` });
    } catch (e) {
      if (e instanceof ApiError) mostrar({ tipo: 'erro', titulo: e.message });
    } finally {
      setEnviando(false);
    }
  }

  async function finalizar() {
    if (carrinho.length === 0) return;
    setEnviando(true);
    try {
      const r = await api<{ pedido_id: number }>('POST', '/api/lojista/balcao', {
        itens: carrinho.map(i => i.pesoG
          ? { produto_id: i.produto.id, peso_g: i.pesoG }
          : { produto_id: i.produto.id, quantidade: i.quantidade }),
        forma_pagamento: pagamento,
        desconto_centavos: descontoCent,
      });
      mostrar({ tipo: 'sucesso', titulo: `Venda registrada! ${brl(total)}`, descricao: troco > 0 ? `Troco: ${brl(troco)}` : undefined });
      const nfceAtivo = !!(lojaQ.data as any)?.nfce_ativo;
      const largura = lojaQ.data?.impressora_largura === '58' ? '58' : '80';
      if (nfceAtivo) {
        // NFC-e ativa: EMITE (transmite + registra em Notas fiscais) e imprime o DANFE.
        try {
          const nf = await api<NfceResultado & { autorizada?: boolean; motivo?: string; c_stat?: string }>(
            'POST', `/api/lojista/nfce/emitir/${r.pedido_id}`
          );
          setNfce(nf);
          if (lojaQ.data?.impressora_auto !== 0) imprimirDanfe(nf, largura);
        } catch (e) {
          // Rejeição/erro da SEFAZ: a nota já fica registrada em "Notas fiscais" com o motivo.
          if (e instanceof ApiError) mostrar({ tipo: 'erro', titulo: 'NFC-e: ' + e.message, descricao: 'Veja o motivo em Fiscal › Notas fiscais emitidas.' });
          if (lojaQ.data?.impressora_auto !== 0) imprimirVenda(r.pedido_id); // fallback: cupom simples
        }
      } else if (lojaQ.data?.impressora_auto !== 0) {
        imprimirVenda(r.pedido_id);
      }
      limpar();
      qc.invalidateQueries({ queryKey: ['balcao-hoje'] });
    } catch (e) {
      if (e instanceof ApiError) mostrar({ tipo: 'erro', titulo: e.message });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Header com total do dia */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold">
            <ShoppingCart className="size-5 text-primary" /> Balcão (PDV)
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">Venda rápida no caixa</p>
        </div>
        <div className="rounded-xl bg-emerald-500/10 px-4 py-2 text-right">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Vendas hoje</div>
          <div className="text-lg font-extrabold text-emerald-600 tabular-nums leading-none">
            {brl(hojeQ.data?.total_centavos ?? 0)}
          </div>
          <div className="text-[10px] text-muted-foreground">{hojeQ.data?.quantidade ?? 0} venda(s)</div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        {/* ─── Grade de produtos ─── */}
        <div className="min-w-0 space-y-3 order-2 lg:order-1">
          {/* Bipar código de barras / PLU da balança */}
          <form
            onSubmit={e => { e.preventDefault(); adicionarPorCodigo(codigo); }}
            className="relative"
          >
            <Barcode className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-primary" />
            <Input
              value={codigo}
              onChange={e => setCodigo(e.target.value)}
              inputMode="numeric"
              placeholder="Bipar código de barras / etiqueta da balança…"
              className="pl-10 font-mono"
            />
          </form>
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar produto…" className="pl-10" />
          </div>

          {categorias.length > 1 && (
            <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
              <button onClick={() => setCategoria(null)}
                className={cn('shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold border-2 transition-colors',
                  !categoria ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground')}>
                Todos
              </button>
              {categorias.map(c => (
                <button key={c} onClick={() => setCategoria(categoria === c ? null : c)}
                  className={cn('shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold border-2 transition-colors whitespace-nowrap',
                    categoria === c ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground')}>
                  {c}
                </button>
              ))}
            </div>
          )}

          {produtosQ.isLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2.5">
              {[1, 2, 3, 4, 5, 6].map(i => <Skeleton key={i} className="h-28 rounded-xl" />)}
            </div>
          ) : produtosFiltrados.length === 0 ? (
            <Card><CardContent className="p-8 text-center text-muted-foreground text-sm">Nenhum produto.</CardContent></Card>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2.5">
              {produtosFiltrados.map(p => (
                <button
                  key={p.id}
                  onClick={() => adicionar(p)}
                  className="group rounded-xl border border-border bg-card overflow-hidden text-left transition-all hover:border-primary hover:shadow-md active:scale-95"
                >
                  <div className="relative aspect-[4/3] bg-white overflow-hidden">
                    {p.foto_url
                      ? <img src={p.foto_url} alt="" className="size-full object-cover" />
                      : <div className="size-full flex items-center justify-center text-muted-foreground/50"><UtensilsCrossed className="size-8" strokeWidth={1.5} /></div>}
                    {ehPeso(p) && (
                      <span className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded-full bg-primary/90 px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground">
                        <Scale className="size-2.5" /> kg
                      </span>
                    )}
                    <div className="absolute inset-0 bg-primary/0 group-hover:bg-primary/10 transition-colors flex items-center justify-center">
                      <Plus className="size-7 text-white drop-shadow opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </div>
                  <div className="p-2">
                    <div className="text-xs font-semibold leading-tight line-clamp-2">{p.nome}</div>
                    <div className="text-sm font-extrabold text-primary tabular-nums mt-0.5">
                      {brl(precoDe(p))}{ehPeso(p) && <span className="text-[10px] font-medium text-muted-foreground">/kg</span>}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ─── Carrinho do caixa ─── */}
        <div className="min-w-0 order-1 lg:order-2">
          <Card className="lg:sticky lg:top-4">
            <CardContent className="p-4 space-y-3">
              <h3 className="font-bold flex items-center gap-2 text-sm">
                <Receipt className="size-4 text-primary" /> Venda atual
                {carrinho.length > 0 && (
                  <button onClick={limpar} className="ml-auto text-xs text-muted-foreground hover:text-destructive flex items-center gap-1">
                    <Trash2 className="size-3.5" /> limpar
                  </button>
                )}
              </h3>

              {carrinho.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground text-sm">
                  <ShoppingCart className="size-8 mx-auto opacity-30 mb-2" />
                  Toque nos produtos para adicionar.
                </div>
              ) : (
                <div className="space-y-1.5 max-h-[40vh] overflow-y-auto">
                  {carrinho.map((item) => (
                    <div key={item.uid} className="flex items-center gap-2 rounded-lg bg-accent/40 px-2.5 py-2">
                      {item.pesoG ? (
                        // Item por peso: não tem stepper, só remover.
                        <button
                          onClick={() => setCarrinho(c => c.filter(x => x.uid !== item.uid))}
                          className="flex size-6 items-center justify-center rounded-full border border-border bg-background text-muted-foreground hover:text-destructive shrink-0"
                          title="Remover"
                        >
                          <Trash2 className="size-3" />
                        </button>
                      ) : (
                        <div className="flex items-center gap-0.5 rounded-full border border-border bg-background shrink-0">
                          <button onClick={() => mudarQtd(item.produto.id, -1)} className="flex size-6 items-center justify-center rounded-full text-muted-foreground hover:text-foreground">
                            {item.quantidade === 1 ? <Trash2 className="size-3" /> : <Minus className="size-3" />}
                          </button>
                          <span className="min-w-5 text-center text-sm font-bold tabular-nums">{item.quantidade}</span>
                          <button onClick={() => mudarQtd(item.produto.id, 1)} className="flex size-6 items-center justify-center rounded-full text-muted-foreground hover:text-primary">
                            <Plus className="size-3" />
                          </button>
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium leading-tight line-clamp-1">{item.produto.nome}</div>
                        {item.detalhe && <div className="text-[11px] text-muted-foreground leading-tight">{item.detalhe}</div>}
                      </div>
                      <span className="text-sm font-bold tabular-nums shrink-0">{brl(item.precoUnit * item.quantidade)}</span>
                    </div>
                  ))}
                </div>
              )}

              {carrinho.length > 0 && (
                <>
                  {/* Desconto */}
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground flex-1">Desconto (R$)</span>
                    <Input value={descontoStr} onChange={e => setDescontoStr(e.target.value)} inputMode="decimal" placeholder="0,00" className="w-24 h-8 text-right" />
                  </div>

                  {/* Totais */}
                  <div className="border-t pt-2 space-y-1 text-sm">
                    <div className="flex justify-between text-muted-foreground"><span>Subtotal</span><span className="tabular-nums">{brl(subtotal)}</span></div>
                    {descontoCent > 0 && <div className="flex justify-between text-success"><span>Desconto</span><span className="tabular-nums">- {brl(descontoCent)}</span></div>}
                    <div className="flex justify-between font-extrabold text-lg"><span>Total</span><span className="tabular-nums text-primary">{brl(total)}</span></div>
                  </div>

                  {/* Pagamento */}
                  <div className="grid grid-cols-3 gap-2">
                    {(['dinheiro', 'pix', 'cartao'] as Pagamento[]).map(f => (
                      <button key={f} onClick={() => setPagamento(f)}
                        className={cn('flex flex-col items-center gap-1 rounded-xl border-2 p-2.5 text-xs font-semibold transition-colors',
                          pagamento === f ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-primary/40')}>
                        {f === 'dinheiro' && <Banknote className="size-4" />}
                        {f === 'pix' && <QrCode className="size-4" />}
                        {f === 'cartao' && <CreditCard className="size-4" />}
                        {f === 'dinheiro' ? 'Dinheiro' : f === 'pix' ? 'Pix' : 'Cartão'}
                      </button>
                    ))}
                  </div>

                  {/* Troco (dinheiro) */}
                  {pagamento === 'dinheiro' && (
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground flex-1">Valor recebido</span>
                        <Input value={recebidoStr} onChange={e => setRecebidoStr(e.target.value)} inputMode="decimal" placeholder="0,00" className="w-24 h-8 text-right" />
                      </div>
                      {troco > 0 && (
                        <div className="flex justify-between text-sm font-bold rounded-lg bg-emerald-500/10 text-emerald-600 px-3 py-1.5">
                          <span>Troco</span><span className="tabular-nums">{brl(troco)}</span>
                        </div>
                      )}
                    </div>
                  )}

                  <Button size="lg" variant="outline" className="w-full" disabled={enviando} onClick={enviarCozinha}>
                    <ChefHat className="size-4" /> Enviar para a cozinha
                  </Button>
                  <Button size="lg" className="w-full" onClick={finalizar} disabled={enviando}>
                    {enviando ? 'Registrando…' : <><Check className="size-4" /> Finalizar · {brl(total)}</>}
                  </Button>
                  <p className="text-[10px] text-center text-muted-foreground flex items-center justify-center gap-1">
                    <Printer className="size-3" /> imprime o cupom ao finalizar
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Modal de peso — produtos vendidos por kg */}
      {pesando && (
        <PesoModal
          produto={pesando}
          onCancelar={() => setPesando(null)}
          onConfirmar={(pesoG) => { adicionarPeso(pesando, pesoG); setPesando(null); }}
        />
      )}

      {/* Modal da NFC-e (teste/local) gerada da venda */}
      {nfce && <NfceModal nfce={nfce} onFechar={() => setNfce(null)} />}
    </div>
  );
}

/* ───────────────────────── Modal da NFC-e ───────────────────────── */
function NfceModal({ nfce, onFechar }: { nfce: NfceResultado; onFechar: () => void }) {
  // O botão "Imprimir" só aparece se o Agente de Impressão não estiver ativo:
  // quando está, a impressão já saiu sozinha ao finalizar a venda.
  const [agenteOk, setAgenteOk] = useState<boolean | null>(null);
  useEffect(() => { agenteAtivo().then(setAgenteOk); }, []);

  function baixarXml() {
    const blob = new Blob([nfce.xml], { type: 'application/xml' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `nfce-${nfce.chave}.xml`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function baixarPdf() {
    // Abre a aba já no clique (senão o bloqueador de pop-up barra o async depois).
    const w = window.open('', '_blank');
    if (!w) return;
    // Mesma personalização (cabeçalho/rodapé/fonte) que sai na impressão automática.
    const config = await buscarConfigFiscal();
    w.document.write(montarHtmlDanfe(nfce, '80', config));
    w.document.close();
    w.onload = () => w.print();
  }

  const autorizada = !!nfce.autorizada;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onFechar}>
      <div className="w-full max-w-md rounded-2xl bg-card shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b p-4">
          <h3 className="flex items-center gap-2 font-bold"><Receipt className="size-4 text-primary" /> NFC-e da venda</h3>
          <button onClick={onFechar} className="p-1 rounded-lg hover:bg-accent text-muted-foreground"><X className="size-4" /></button>
        </div>
        <div className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            {autorizada
              ? <span className="rounded-full bg-green-500/15 text-green-600 px-3 py-1 text-sm font-bold flex items-center gap-1"><Check className="size-3.5" /> Autorizada</span>
              : nfce.assinado
                ? <span className="rounded-full bg-amber-500/15 text-amber-600 px-3 py-1 text-sm font-bold">Não transmitida à SEFAZ</span>
                : <span className="rounded-full bg-amber-500/15 text-amber-600 px-3 py-1 text-sm font-bold">Teste local — sem certificado</span>}
            <span className="rounded-full bg-muted px-2.5 py-1 text-xs">{nfce.ambiente === 1 ? 'Produção' : 'Homologação'}</span>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Chave de acesso</p>
            <p className="font-mono text-xs break-all">{nfce.chave}</p>
          </div>
          {agenteOk && (
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Printer className="size-3.5" /> Cupom já enviado à impressora automaticamente.
            </p>
          )}
        </div>
        <div className="border-t p-4 flex justify-end gap-2 flex-wrap">
          <Button variant="outline" onClick={onFechar}>Fechar</Button>
          <Button variant="outline" onClick={baixarXml}>Baixar XML</Button>
          <Button variant="outline" onClick={baixarPdf}>Baixar PDF</Button>
          {agenteOk === false && (
            <Button onClick={() => imprimirDanfe(nfce)}><Printer className="size-4" /> Imprimir</Button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────── Modal de peso (kg) ───────────────────────── */
function PesoModal({
  produto, onConfirmar, onCancelar,
}: {
  produto: Produto;
  onConfirmar: (pesoG: number) => void;
  onCancelar: () => void;
}) {
  const [str, setStr] = useState('');
  const precoKg = precoDe(produto);
  const pesoG = Math.round((parseFloat(str.replace(',', '.')) || 0) * 1000);
  const totalLinha = Math.round(precoKg * pesoG / 1000);

  function confirmar() {
    if (pesoG > 0) onConfirmar(pesoG);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onCancelar}>
      <div className="w-full max-w-xs rounded-2xl bg-card p-5 shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h3 className="flex items-center gap-2 font-bold">
            <Scale className="size-4 text-primary" /> Pesar produto
          </h3>
          <button onClick={onCancelar} className="p-1 rounded-lg hover:bg-accent text-muted-foreground">
            <X className="size-4" />
          </button>
        </div>
        <p className="text-sm font-semibold leading-tight">{produto.nome}</p>
        <p className="text-xs text-muted-foreground mb-4">{brl(precoKg)}/kg</p>

        <label className="text-xs font-medium text-muted-foreground">Peso (kg)</label>
        <Input
          autoFocus
          value={str}
          onChange={e => setStr(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); confirmar(); } }}
          inputMode="decimal"
          placeholder="Ex.: 0,350"
          className="text-lg text-center font-bold mt-1"
        />

        <div className="flex justify-between items-center mt-4 mb-3">
          <span className="text-sm text-muted-foreground">Total</span>
          <span className="text-xl font-extrabold text-primary tabular-nums">{brl(totalLinha)}</span>
        </div>

        <Button className="w-full" size="lg" onClick={confirmar} disabled={pesoG <= 0}>
          <Plus className="size-4" /> Adicionar
        </Button>
      </div>
    </div>
  );
}
