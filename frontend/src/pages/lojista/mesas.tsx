/**
 * Gestão de mesas e comandas — dine-in / salão.
 * Fluxo: criar mesa → abrir → adicionar itens → fechar (com pagamento).
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  UtensilsCrossed, Plus, Minus, X, Trash2, ChevronDown, ChevronUp,
  CreditCard, Banknote, QrCode, Check, Clock, History, Printer, ChefHat, ArrowRight,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { api, ApiError, sessaoUsuario } from '@/lib/api';
import { brl } from '@/lib/format';
import { imprimirCupom, imprimirDanfe, configImpressao, type ConfigImpressao, type DadosDanfe } from '@/lib/impressao';
import type { Produto, Loja } from '@/types';

interface Mesa {
  id: number;
  numero: string;
  status: 'livre' | 'ocupada';
  comanda_id: number | null;
  comanda_total: number;
  comanda_aberto_em: string | null;
  total_itens: number;
}

interface ItemComanda {
  id: number;
  comanda_id: number;
  produto_id: number | null;
  nome_produto: string;
  preco_unit_centavos: number;
  quantidade: number;
  observacao: string;
  enviado_cozinha: 0 | 1;
  categoria?: string | null;
}

interface Comanda {
  id: number;
  mesa_numero: string;
  status: string;
  total_centavos: number;
  aberto_em: string;
  fechado_em?: string | null;
  forma_pagamento?: string | null;
}

export function MesasLoja() {
  const [aba, setAba] = useState<'mesas' | 'historico'>('mesas');
  const [expandida, setExpandida] = useState<number | null>(null);
  const [criandoMesa, setCriandoMesa] = useState(false);
  const [novoNumero, setNovoNumero] = useState('');
  const [mesaCriada, setMesaCriada] = useState<{ id: number; numero: string } | null>(null);
  const { mostrar } = useToast();
  const qc = useQueryClient();

  const mesasQ = useQuery({
    queryKey: ['lojista-mesas'],
    queryFn: () => api<{ mesas: Mesa[] }>('GET', '/api/lojista/mesas').then(r => r.mesas),
    refetchInterval: 10000,
  });

  const historicoQ = useQuery({
    queryKey: ['lojista-comandas-historico'],
    queryFn: () => api<{ comandas: Comanda[] }>('GET', '/api/lojista/comandas-historico').then(r => r.comandas),
    enabled: aba === 'historico',
  });

  async function criarMesa(e: React.FormEvent) {
    e.preventDefault();
    try {
      const r = await api<{ mesa_id: number }>('POST', '/api/lojista/mesas', { numero: novoNumero });
      setMesaCriada({ id: r.mesa_id, numero: novoNumero });
      setNovoNumero('');
      setCriandoMesa(false);
      qc.invalidateQueries({ queryKey: ['lojista-mesas'] });
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    }
  }

  async function excluirMesa(id: number, numero: string) {
    if (!confirm(`Excluir mesa ${numero}?`)) return;
    try {
      await api('DELETE', `/api/lojista/mesas/${id}`);
      mostrar({ tipo: 'sucesso', titulo: `Mesa ${numero} removida.` });
      qc.invalidateQueries({ queryKey: ['lojista-mesas'] });
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    }
  }

  async function abrirMesa(id: number) {
    try {
      await api('POST', `/api/lojista/mesas/${id}/abrir`);
      qc.invalidateQueries({ queryKey: ['lojista-mesas'] });
      setExpandida(id);
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    }
  }

  const mesas = mesasQ.data ?? [];
  const livres = mesas.filter(m => m.status === 'livre').length;
  const ocupadas = mesas.filter(m => m.status === 'ocupada').length;
  const mesaExpandida = mesas.find(m => m.id === expandida && m.status === 'ocupada');

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold">
            <UtensilsCrossed className="size-5 text-primary" /> Mesas
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {livres} livre{livres !== 1 ? 's' : ''} · {ocupadas} ocupada{ocupadas !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => { setAba(a => a === 'mesas' ? 'historico' : 'mesas'); }}>
            <History className="size-4" />
            {aba === 'mesas' ? 'Histórico' : 'Mesas'}
          </Button>
          <Button size="sm" onClick={() => setCriandoMesa(c => !c)}>
            <Plus className="size-4" /> Nova mesa
          </Button>
        </div>
      </div>

      {/* Form nova mesa */}
      {criandoMesa && (
        <Card className="border-primary/30">
          <CardContent className="p-4">
            <form onSubmit={criarMesa} className="flex gap-3 items-end">
              <div className="flex-1">
                <Label>Número / nome da mesa</Label>
                <Input
                  required
                  autoFocus
                  value={novoNumero}
                  onChange={e => setNovoNumero(e.target.value)}
                  placeholder="Ex.: 1, 2, Varanda, Balcão"
                />
              </div>
              <Button type="submit">Criar</Button>
              <Button type="button" variant="ghost" size="icon" onClick={() => setCriandoMesa(false)}>
                <X className="size-4" />
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {/* ABA: Mesas */}
      {aba === 'mesas' && (
        <>
          {mesasQ.isLoading && (
            <div className="grid grid-cols-2 gap-3">
              {[1,2,3,4].map(i => <Skeleton key={i} className="h-28" />)}
            </div>
          )}

          {!mesasQ.isLoading && mesas.length === 0 && (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground space-y-2">
                <UtensilsCrossed className="size-10 mx-auto opacity-30" />
                <p>Nenhuma mesa cadastrada.</p>
                <p className="text-sm">Clique em "Nova mesa" para começar.</p>
              </CardContent>
            </Card>
          )}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {mesas.map(mesa => (
              <CardMesa
                key={mesa.id}
                mesa={mesa}
                expandida={expandida === mesa.id}
                onToggle={() => setExpandida(expandida === mesa.id ? null : mesa.id)}
                onAbrir={() => abrirMesa(mesa.id)}
                onExcluir={() => excluirMesa(mesa.id, mesa.numero)}
              />
            ))}
          </div>

          {/* Painel da comanda expandida — largura total, abaixo da grade.
              Fica fora do grid para não ser espremido numa coluna só. */}
          {mesaExpandida && mesaExpandida.comanda_id && (
            <PainelComanda
              comandaId={mesaExpandida.comanda_id}
              mesaNumero={mesaExpandida.numero}
              onFechar={() => { qc.invalidateQueries({ queryKey: ['lojista-mesas'] }); setExpandida(null); }}
            />
          )}
        </>
      )}

      {/* ABA: Histórico */}
      {aba === 'historico' && (
        <div className="space-y-2">
          {historicoQ.isLoading && (
            <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-14" />)}</div>
          )}
          {(historicoQ.data ?? []).length === 0 && !historicoQ.isLoading && (
            <Card>
              <CardContent className="p-6 text-center text-muted-foreground text-sm">
                Nenhuma comanda fechada ainda.
              </CardContent>
            </Card>
          )}
          {(historicoQ.data ?? []).map(c => (
            <Card key={c.id}>
              <CardContent className="p-4 flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-xl bg-accent font-bold shrink-0">
                  {c.mesa_numero}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm">Mesa {c.mesa_numero}</span>
                    <Badge variant={c.status === 'fechada' ? 'success' : 'danger'}>
                      {c.status}
                    </Badge>
                    {c.forma_pagamento && (
                      <span className="text-xs text-muted-foreground">{c.forma_pagamento}</span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    Fechada em {c.fechado_em ? new Date(c.fechado_em).toLocaleString('pt-BR') : '—'}
                  </div>
                </div>
                <div className="font-bold tabular-nums shrink-0">{brl(c.total_centavos)}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {mesaCriada && (
        <MesaCriadaModal
          numero={mesaCriada.numero}
          onIrParaMesa={() => { abrirMesa(mesaCriada.id); setMesaCriada(null); }}
          onFechar={() => setMesaCriada(null)}
        />
      )}
    </div>
  );
}

/* ────────────────────── Modal "Mesa criada!" ───────────────────────── */

function MesaCriadaModal({
  numero, onIrParaMesa, onFechar,
}: {
  numero: string;
  onIrParaMesa: () => void;
  onFechar: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onFechar}>
      <div
        className="relative w-full max-w-2xl overflow-hidden rounded-3xl bg-card shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <button
          onClick={onFechar}
          className="absolute top-4 right-4 z-10 flex size-8 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        >
          <X className="size-5" />
        </button>

        <div className="grid sm:grid-cols-[1fr_15rem] items-stretch">
          <div className="p-8 space-y-5 flex flex-col justify-center">
            <div className="flex size-16 items-center justify-center rounded-full bg-primary/15">
              <Check className="size-8 text-primary" strokeWidth={3} />
            </div>

            <div>
              <h2 className="text-2xl font-extrabold text-primary">Mesa criada!</h2>
              <p className="text-muted-foreground mt-1">
                A mesa foi criada com sucesso e já está pronta para receber pedidos.
              </p>
            </div>

            <div className="inline-flex items-center gap-2.5 rounded-xl border border-primary/25 bg-primary/10 px-4 py-3">
              <UtensilsCrossed className="size-5 text-primary shrink-0" />
              <span className="text-sm font-semibold text-muted-foreground">Mesa</span>
              <span className="text-2xl font-extrabold text-primary tabular-nums">{numero}</span>
            </div>

            <div className="flex flex-wrap gap-2 pt-1">
              <Button onClick={onIrParaMesa}>
                <ArrowRight className="size-4" /> Ir para a Mesa
              </Button>
              <Button variant="outline" onClick={onFechar}>Fechar</Button>
            </div>
          </div>

          {/* Mascote (imagem já traz o blob de fundo) */}
          <div className="relative hidden sm:flex items-center justify-center p-4">
            <img
              src="/mascote/mascote.png"
              alt=""
              className="w-56 max-w-none select-none pointer-events-none"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ──────────────────────────── CardMesa ─────────────────────────────── */

function CardMesa({
  mesa, expandida, onToggle, onAbrir, onExcluir,
}: {
  mesa: Mesa;
  expandida: boolean;
  onToggle: () => void;
  onAbrir: () => void;
  onExcluir: () => void;
}) {
  const livre = mesa.status === 'livre';

  return (
    <Card
      className={`cursor-pointer transition-all ${
        !livre
          ? expandida ? 'border-primary ring-2 ring-primary/30 bg-primary/5' : 'border-primary/40 bg-primary/5'
          : 'hover:border-border'
      }`}
      onClick={livre ? undefined : onToggle}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div>
            <div className={`text-2xl font-extrabold ${livre ? 'text-muted-foreground' : 'text-primary'}`}>
              {mesa.numero}
            </div>
            <Badge
              variant={livre ? 'secondary' : 'success'}
              className="mt-1 text-[10px]"
            >
              {livre ? 'Livre' : 'Ocupada'}
            </Badge>
          </div>
          {!livre && (
            <div className="text-right">
              <div className="text-sm font-bold">{brl(mesa.comanda_total)}</div>
              <div className="text-xs text-muted-foreground">{mesa.total_itens} item{mesa.total_itens !== 1 ? 's' : ''}</div>
              {expandida ? <ChevronUp className="size-4 mt-1 ml-auto text-muted-foreground" /> : <ChevronDown className="size-4 mt-1 ml-auto text-muted-foreground" />}
            </div>
          )}
        </div>

        {livre && (
          <div className="flex gap-2 mt-3">
            <Button size="sm" className="flex-1 text-xs h-8" onClick={onAbrir}>
              Abrir
            </Button>
            <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-muted-foreground" onClick={e => { e.stopPropagation(); onExcluir(); }}>
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ──────────────────────────── PainelComanda ─────────────────────────── */

function imprimirComanda(mesaNumero: string, comandaId: number, itens: ItemComanda[], total: number, config: ConfigImpressao) {
  imprimirCupom({
    titulo: `MESA ${mesaNumero} · COMANDA #${comandaId}`,
    linhas: itens.map(i => ({
      qtd: String(i.quantidade),
      nome: i.nome_produto,
      valor: brl(i.preco_unit_centavos * i.quantidade),
      detalhe: i.observacao ? `obs: ${i.observacao}` : undefined,
      observacao: i.observacao || undefined,
      categoria: i.categoria || undefined,
    })),
    totais: [{ rotulo: 'TOTAL', valor: brl(total), forte: true }],
    tipoVenda: `Mesa ${mesaNumero}`, referencia: `Comanda #${comandaId}`,
    atendente: sessaoUsuario('lojista')?.nome,
  }, config);
}

function PainelComanda({
  comandaId, mesaNumero, onFechar,
}: {
  comandaId: number;
  mesaNumero: string;
  onFechar: () => void;
}) {
  const { mostrar } = useToast();
  const qc = useQueryClient();
  const [adicionando, setAdicionando] = useState(false);
  const [fechando, setFechando] = useState(false);
  const [formaPagamento, setFormaPagamento] = useState<'dinheiro' | 'pix' | 'cartao'>('dinheiro');

  const comandaQ = useQuery({
    queryKey: ['comanda', comandaId],
    queryFn: () => api<{ comanda: Comanda; itens: ItemComanda[] }>('GET', `/api/lojista/comandas/${comandaId}`),
    refetchInterval: 5000,
  });

  const produtosQ = useQuery({
    queryKey: ['lojista-produtos'],
    queryFn: () => api<{ produtos: Produto[] }>('GET', '/api/lojista/produtos').then(r => r.produtos),
    enabled: adicionando,
  });

  const lojaQ = useQuery({
    queryKey: ['lojista-loja'],
    queryFn: () => api<{ loja: Loja }>('GET', '/api/lojista/loja').then(r => r.loja),
  });

  const itens = comandaQ.data?.itens ?? [];
  const total = comandaQ.data?.comanda.total_centavos ?? 0;
  const naoEnviados = itens.filter(i => !i.enviado_cozinha).length;

  async function enviarCozinha() {
    try {
      const r = await api<{ itens_enviados: number }>('POST', `/api/lojista/comandas/${comandaId}/enviar-cozinha`);
      mostrar({ tipo: 'sucesso', titulo: `${r.itens_enviados} item(ns) enviados à cozinha 🍳` });
      qc.invalidateQueries({ queryKey: ['comanda', comandaId] });
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    }
  }

  async function removerItem(id: number) {
    try {
      await api('DELETE', `/api/lojista/itens-comanda/${id}`);
      qc.invalidateQueries({ queryKey: ['comanda', comandaId] });
      qc.invalidateQueries({ queryKey: ['lojista-mesas'] });
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    }
  }

  async function mudarQtdItem(item: ItemComanda, delta: number) {
    const nova = item.quantidade + delta;
    if (nova < 1) { removerItem(item.id); return; }
    try {
      await api('PUT', `/api/lojista/itens-comanda/${item.id}`, { quantidade: nova });
      qc.invalidateQueries({ queryKey: ['comanda', comandaId] });
      qc.invalidateQueries({ queryKey: ['lojista-mesas'] });
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    }
  }

  async function adicionarProduto(p: Produto) {
    try {
      await api('POST', `/api/lojista/comandas/${comandaId}/itens`, { produto_id: p.id, quantidade: 1 });
      qc.invalidateQueries({ queryKey: ['comanda', comandaId] });
      qc.invalidateQueries({ queryKey: ['lojista-mesas'] });
      mostrar({ tipo: 'sucesso', titulo: `${p.nome} adicionado!` });
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    }
  }

  async function confirmarFechamento() {
    try {
      const r = await api<{ pedido_id: number | null }>(
        'POST', `/api/lojista/comandas/${comandaId}/fechar`, { forma_pagamento: formaPagamento }
      );
      mostrar({ tipo: 'sucesso', titulo: `Mesa ${mesaNumero} fechada! Total: ${brl(total)}` });
      // NFC-e ativa: emite (transmite + registra) e imprime o DANFE, igual ao balcão.
      const loja = lojaQ.data as Record<string, unknown> | undefined;
      if (r.pedido_id && loja?.nfce_ativo) {
        const largura = loja.impressora_largura === '58' ? '58' : '80';
        try {
          const nf = await api<DadosDanfe & { autorizada?: boolean }>('POST', `/api/lojista/nfce/emitir/${r.pedido_id}`);
          if (loja.impressora_auto !== 0) imprimirDanfe(nf, largura);
        } catch (e) {
          if (e instanceof ApiError) mostrar({ tipo: 'erro', titulo: 'NFC-e: ' + e.message, descricao: 'Veja em Fiscal › Notas fiscais emitidas.' });
        }
      }
      qc.invalidateQueries({ queryKey: ['lojista-mesas'] });
      qc.invalidateQueries({ queryKey: ['lojista-comandas-historico'] });
      onFechar();
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    }
  }

  async function cancelarComanda() {
    if (!confirm('Cancelar esta comanda? Os itens serão descartados.')) return;
    try {
      await api('POST', `/api/lojista/comandas/${comandaId}/cancelar`);
      mostrar({ tipo: 'sucesso', titulo: 'Comanda cancelada.' });
      qc.invalidateQueries({ queryKey: ['lojista-mesas'] });
      onFechar();
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    }
  }

  return (
    <Card className="border-primary/30 mt-2">
      <CardContent className="p-4 space-y-4">
        {/* Título */}
        <div className="flex items-center justify-between">
          <h3 className="font-bold flex items-center gap-2">
            <UtensilsCrossed className="size-4 text-primary" />
            Mesa {mesaNumero} — Comanda #{comandaId}
          </h3>
          <div className="flex items-center gap-2">
            {itens.length > 0 && (
              <button
                onClick={() => imprimirComanda(mesaNumero, comandaId, itens, total, configImpressao(lojaQ.data as unknown as Record<string, unknown>))}
                className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground"
                title="Imprimir comanda"
              >
                <Printer className="size-4" />
              </button>
            )}
            {comandaQ.data?.comanda.aberto_em && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="size-3" />
                {new Date(comandaQ.data.comanda.aberto_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
        </div>

        {/* Itens */}
        {comandaQ.isLoading && <Skeleton className="h-20" />}
        {itens.length === 0 && !comandaQ.isLoading && (
          <p className="text-sm text-muted-foreground text-center py-2">
            Nenhum item ainda. Adicione produtos abaixo.
          </p>
        )}
        <div className="space-y-1.5">
          {itens.map(item => (
            <div key={item.id} className="flex items-center gap-2 rounded-lg bg-accent/40 px-3 py-2">
              {/* Stepper de quantidade */}
              <div className="flex items-center gap-0.5 rounded-full border border-border bg-background shrink-0">
                <button
                  onClick={() => mudarQtdItem(item, -1)}
                  className="flex size-6 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
                  title={item.quantidade === 1 ? 'Remover' : 'Diminuir'}
                >
                  {item.quantidade === 1 ? <Trash2 className="size-3" /> : <Minus className="size-3" />}
                </button>
                <span className="min-w-5 text-center text-sm font-bold tabular-nums">{item.quantidade}</span>
                <button
                  onClick={() => mudarQtdItem(item, 1)}
                  className="flex size-6 items-center justify-center rounded-full text-muted-foreground hover:text-primary"
                  title="Aumentar"
                >
                  <Plus className="size-3" />
                </button>
              </div>
              <span className="flex-1 text-sm font-medium leading-tight flex items-center gap-1.5">
                {!item.enviado_cozinha && (
                  <span className="size-1.5 rounded-full bg-amber-500 shrink-0" title="Ainda não enviado à cozinha" />
                )}
                {item.nome_produto}
              </span>
              <span className="text-sm font-bold tabular-nums shrink-0">{brl(item.preco_unit_centavos * item.quantidade)}</span>
              <button
                onClick={() => removerItem(item.id)}
                className="text-muted-foreground hover:text-destructive p-0.5 shrink-0"
                title="Remover item"
              >
                <X className="size-3.5" />
              </button>
            </div>
          ))}
        </div>

        {/* Total */}
        {itens.length > 0 && (
          <div className="flex items-center justify-between border-t pt-3 font-bold text-lg">
            <span>Total</span>
            <span className="tabular-nums text-primary">{brl(total)}</span>
          </div>
        )}

        {/* Enviar para a cozinha (só os itens ainda não enviados) */}
        {itens.length > 0 && (
          naoEnviados > 0 ? (
            <Button variant="default" size="sm" className="w-full" onClick={enviarCozinha}>
              <ChefHat className="size-4" /> Enviar {naoEnviados} item(ns) para a cozinha
            </Button>
          ) : (
            <p className="flex items-center justify-center gap-1.5 text-xs text-green-600 dark:text-green-400 font-medium">
              <Check className="size-3.5" /> Tudo já enviado para a cozinha
            </p>
          )
        )}

        {/* Botão adicionar itens */}
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() => setAdicionando(a => !a)}
        >
          <Plus className="size-4" />
          {adicionando ? 'Fechar cardápio' : 'Adicionar itens'}
        </Button>

        {/* Cardápio inline */}
        {adicionando && (
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {produtosQ.isLoading && <Skeleton className="h-20" />}
            {(produtosQ.data ?? [])
              .filter(p => p.disponivel)
              .map(p => (
                <button
                  key={p.id}
                  onClick={() => adicionarProduto(p)}
                  className="w-full flex items-center gap-3 rounded-xl border border-border bg-background hover:bg-accent/40 px-3 py-2.5 text-left transition-colors"
                >
                  {p.foto_url
                    ? <img src={p.foto_url} alt="" className="size-10 rounded-lg object-cover shrink-0" />
                    : <div className="flex size-10 items-center justify-center rounded-lg bg-accent text-lg shrink-0">🍽️</div>
                  }
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold truncate">{p.nome}</div>
                    {p.categoria && <div className="text-xs text-muted-foreground">{p.categoria}</div>}
                  </div>
                  <div className="text-sm font-bold tabular-nums shrink-0">{brl(p.preco_centavos)}</div>
                  <Plus className="size-4 text-primary shrink-0" />
                </button>
              ))
            }
          </div>
        )}

        {/* Fechamento */}
        {!fechando ? (
          <div className="flex gap-2 pt-1">
            <Button
              size="sm"
              className="flex-1"
              disabled={itens.length === 0}
              onClick={() => setFechando(true)}
            >
              <Check className="size-4" /> Fechar conta
            </Button>
            <Button size="sm" variant="destructive" onClick={cancelarComanda}>
              Cancelar
            </Button>
          </div>
        ) : (
          <div className="space-y-3 border-t pt-3">
            <p className="text-sm font-semibold">Forma de pagamento:</p>
            <div className="grid grid-cols-3 gap-2">
              {(['dinheiro', 'pix', 'cartao'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setFormaPagamento(f)}
                  className={`flex flex-col items-center gap-1.5 rounded-xl border p-3 transition-colors text-xs font-semibold ${
                    formaPagamento === f
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:border-primary/50'
                  }`}
                >
                  {f === 'dinheiro' && <Banknote className="size-5" />}
                  {f === 'pix' && <QrCode className="size-5" />}
                  {f === 'cartao' && <CreditCard className="size-5" />}
                  {f === 'dinheiro' ? 'Dinheiro' : f === 'pix' ? 'Pix' : 'Cartão'}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <Button size="sm" className="flex-1" onClick={confirmarFechamento}>
                Confirmar — {brl(total)}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setFechando(false)}>
                Voltar
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
