/**
 * Carrinho com checkout completo: endereço salvo (ou novo), pagamento,
 * troco condicional e observações. Preço é re-confirmado pelo servidor.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Minus, Plus, ShoppingBag, MapPin, CreditCard, Ticket, X, AlertTriangle, QrCode, Banknote, Copy, Check, Loader2 } from 'lucide-react';
import { useCarrinho, mudarQuantidade, limparCarrinho } from '@/lib/carrinho';
import { api, ApiError, sessaoUsuario } from '@/lib/api';
import { brl } from '@/lib/format';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import type { Endereco, FormaPagamento } from '@/types';

export function PaginaCarrinho() {
  const carrinho = useCarrinho();
  const usuario = sessaoUsuario();
  const navigate = useNavigate();
  const { mostrar } = useToast();

  const [cupom, setCupom] = useState<{ codigo: string; tipo: 'percentual' | 'fixo'; valor: number } | null>(null);
  const [freteEfetivo, setFreteEfetivo] = useState<number | null>(null);
  // Pix fica AQUI (não dentro do Checkout) pra sobreviver ao carrinho ser
  // esvaziado assim que o pedido é criado — senão a tela do QR desmontaria.
  const [pix, setPix] = useState<(PixData & { pedidoId: number }) | null>(null);

  function concluirPedido(pedidoId: number) {
    limparCarrinho();
    mostrar({ tipo: 'sucesso', titulo: 'Pedido realizado! 🎉' });
    navigate(`/pedido/${pedidoId}`);
  }

  const infoLoja = useQuery({
    queryKey: ['loja-checkout', carrinho?.loja_id],
    queryFn: () => api<{ loja: { minimo_pedido_centavos?: number }; zonas: { bairro: string; taxa_centavos: number }[] }>(
      'GET', `/api/lojas/${carrinho!.loja_id}`),
    enabled: !!carrinho?.loja_id,
  });
  const minimoPedido = infoLoja.data?.loja.minimo_pedido_centavos || 0;
  const zonas = infoLoja.data?.zonas || [];

  const subtotal = carrinho?.itens.reduce((s, i) => s + i.preco_centavos * i.quantidade, 0) || 0;
  const desconto = useMemo(() => {
    if (!cupom) return 0;
    const d = cupom.tipo === 'percentual'
      ? Math.round(subtotal * cupom.valor / 100)
      : Math.min(cupom.valor, subtotal);
    return Math.min(d, subtotal);
  }, [cupom, subtotal]);
  const taxaEntrega = freteEfetivo ?? (carrinho?.taxa_entrega_centavos || 0);
  const total = subtotal - desconto + taxaEntrega;
  const abaixoMinimo = minimoPedido > 0 && subtotal < minimoPedido;

  // Pedido Pix criado: o carrinho já foi esvaziado; mostra o QR pra pagar.
  // Se cancelar/fechar, vai pro acompanhamento do pedido (que fica aguardando).
  if (pix) {
    return (
      <div className="space-y-4 pb-4">
        <PixPagamento
          dados={pix}
          onPago={() => concluirPedido(pix.pedidoId)}
          onCancelar={() => navigate(`/pedido/${pix.pedidoId}`)}
        />
      </div>
    );
  }

  if (!carrinho) {
    return (
      <div className="flex flex-col items-center justify-center text-center py-20 space-y-4">
        <div className="size-24 rounded-3xl bg-accent flex items-center justify-center">
          <ShoppingBag className="size-10 text-primary" />
        </div>
        <h2 className="text-xl font-bold">Carrinho vazio</h2>
        <p className="text-muted-foreground text-sm max-w-xs">
          Explore as lojas e adicione seus itens favoritos ao carrinho.
        </p>
        <Button asChild size="lg" className="rounded-2xl mt-2">
          <Link to="/">Explorar lojas</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-4">
      {/* Itens do pedido */}
      <Card className="overflow-hidden">
        <div className="px-5 py-3 bg-accent/50 border-b border-border">
          <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            {carrinho.loja_nome}
          </div>
        </div>
        <CardContent className="p-5">
          <div className="divide-y divide-border/60">
            {carrinho.itens.map(item => (
              <div key={item.chave} className="py-3 first:pt-0 last:pb-0">
                <div className="flex items-start gap-3">
                  {item.foto_url ? (
                    <img src={item.foto_url} alt="" className="size-12 shrink-0 rounded-xl object-cover" />
                  ) : (
                    <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-orange-100 to-rose-200 text-xl">🍽️</div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold leading-tight">{item.nome}</div>
                    {item.opcoes_texto && (
                      <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{item.opcoes_texto}</div>
                    )}
                    <div className="text-xs text-muted-foreground mt-1">{brl(item.preco_centavos)} cada</div>
                  </div>
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <div className="font-bold tabular-nums">{brl(item.preco_centavos * item.quantidade)}</div>
                    <div className="flex items-center gap-0.5 rounded-full bg-accent p-0.5">
                      <button
                        onClick={() => mudarQuantidade(item.chave, -1)}
                        className="flex size-6 items-center justify-center rounded-full hover:bg-background transition-colors"
                        aria-label="Diminuir"
                      >
                        <Minus className="size-3" />
                      </button>
                      <span className="min-w-5 text-center text-sm font-bold">{item.quantidade}</span>
                      <button
                        onClick={() => mudarQuantidade(item.chave, +1)}
                        className="flex size-6 items-center justify-center rounded-full hover:bg-background transition-colors"
                        aria-label="Aumentar"
                      >
                        <Plus className="size-3" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Cupom */}
          {usuario && (
            <CupomBox lojaId={carrinho.loja_id} subtotal={subtotal} cupom={cupom} onAplicar={setCupom} />
          )}

          {/* Resumo de preços */}
          <div className="mt-4 pt-4 border-t border-border space-y-2 text-sm">
            <div className="flex justify-between text-muted-foreground">
              <span>Subtotal</span>
              <span className="tabular-nums">{brl(subtotal)}</span>
            </div>
            {desconto > 0 && cupom && (
              <div className="flex justify-between text-success">
                <span>Desconto ({cupom.codigo})</span>
                <span className="tabular-nums font-semibold">- {brl(desconto)}</span>
              </div>
            )}
            <div className="flex justify-between text-muted-foreground">
              <span>Taxa de entrega</span>
              <span className="tabular-nums">{taxaEntrega === 0 ? 'Grátis' : brl(taxaEntrega)}</span>
            </div>
            <div className="flex justify-between font-extrabold text-base pt-2 border-t border-border">
              <span>Total</span>
              <span className="tabular-nums">{brl(total)}</span>
            </div>
          </div>

          {abaixoMinimo && (
            <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-700 dark:text-amber-300">
              <AlertTriangle className="size-4 shrink-0 mt-0.5" />
              <span>
                Pedido mínimo: <b>{brl(minimoPedido)}</b>. Faltam <b>{brl(minimoPedido - subtotal)}</b>.
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {!usuario ? (
        <Card className="p-6 text-center space-y-3">
          <div className="text-3xl">🔐</div>
          <p className="font-semibold">Entre para finalizar o pedido</p>
          <p className="text-sm text-muted-foreground">Faça login ou crie uma conta gratuitamente.</p>
          <Button asChild size="lg" className="w-full rounded-2xl">
            <Link to="/conta">Entrar na minha conta</Link>
          </Button>
        </Card>
      ) : (
        <Checkout
          subtotal={subtotal}
          total={total}
          zonas={zonas}
          fretePadrao={carrinho.taxa_entrega_centavos}
          bloqueado={abaixoMinimo}
          cupomCodigo={desconto > 0 ? cupom?.codigo : undefined}
          onFreteChange={setFreteEfetivo}
          onPedido={concluirPedido}
          onPix={dados => { limparCarrinho(); setPix(dados); }}
        />
      )}
    </div>
  );
}

function CupomBox({
  lojaId, subtotal, cupom, onAplicar,
}: {
  lojaId: number;
  subtotal: number;
  cupom: { codigo: string; tipo: 'percentual' | 'fixo'; valor: number } | null;
  onAplicar: (c: { codigo: string; tipo: 'percentual' | 'fixo'; valor: number } | null) => void;
}) {
  const [codigo, setCodigo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const { mostrar } = useToast();

  async function aplicar() {
    const cod = codigo.trim().toUpperCase();
    if (!cod) return;
    setEnviando(true);
    try {
      const r = await api<{ codigo: string; tipo: 'percentual' | 'fixo'; valor: number; desconto_centavos: number }>(
        'POST', '/api/cliente/cupons/validar',
        { loja_id: lojaId, codigo: cod, subtotal },
      );
      onAplicar({ codigo: r.codigo, tipo: r.tipo, valor: r.valor });
      mostrar({ tipo: 'sucesso', titulo: 'Cupom aplicado! 🎟️' });
      setCodigo('');
    } catch (e) {
      if (e instanceof ApiError) mostrar({ tipo: 'erro', titulo: e.message });
    } finally {
      setEnviando(false);
    }
  }

  if (cupom) {
    return (
      <div className="mt-4 flex items-center gap-2 rounded-xl border border-success/40 bg-success/10 px-3 py-2.5">
        <Ticket className="size-4 text-success shrink-0" />
        <span className="flex-1 text-sm font-semibold text-success">
          Cupom <span className="font-mono">{cupom.codigo}</span> aplicado
        </span>
        <button onClick={() => onAplicar(null)} className="text-success/70 hover:text-success p-0.5" title="Remover">
          <X className="size-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="mt-4 flex gap-2">
      <div className="relative flex-1">
        <Ticket className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          value={codigo}
          onChange={e => setCodigo(e.target.value.toUpperCase().replace(/\s/g, ''))}
          onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), aplicar())}
          placeholder="Cupom de desconto"
          className="pl-9 font-mono uppercase"
          maxLength={20}
        />
      </div>
      <Button type="button" variant="outline" onClick={aplicar} disabled={enviando || !codigo.trim()}>
        {enviando ? '…' : 'Aplicar'}
      </Button>
    </div>
  );
}

const PAGAMENTOS: { id: FormaPagamento; label: string; icon: React.ReactNode; desc: string }[] = [
  {
    id: 'pix',
    label: 'Pix online',
    icon: <QrCode className="size-5" />,
    desc: 'Pague agora e confirme na hora',
  },
  {
    id: 'dinheiro',
    label: 'Dinheiro',
    icon: <Banknote className="size-5" />,
    desc: 'Pague na entrega',
  },
  {
    id: 'cartao_entrega',
    label: 'Cartão',
    icon: <CreditCard className="size-5" />,
    desc: 'Débito ou crédito',
  },
];

interface PixData { pagamento_id: string; status: string; qr_code: string; qr_code_base64: string; }

/** Tela de pagamento Pix: QR + copia-e-cola, conferindo o status automaticamente. */
function PixPagamento({
  dados, onPago, onCancelar,
}: {
  dados: PixData & { pedidoId: number };
  onPago: () => void;
  onCancelar: () => void;
}) {
  const { mostrar } = useToast();
  const [copiado, setCopiado] = useState(false);

  // Confere o pagamento a cada 4s; quando aprovar, segue pro acompanhamento.
  const statusQ = useQuery({
    queryKey: ['pix-status', dados.pedidoId],
    queryFn: () => api<{ pedido: { pagamento_status: string } }>('GET', `/api/cliente/pedidos/${dados.pedidoId}`),
    refetchInterval: 4000,
  });
  const aprovado = statusQ.data?.pedido?.pagamento_status === 'aprovado';
  useEffect(() => { if (aprovado) onPago(); }, [aprovado, onPago]);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(dados.qr_code);
      setCopiado(true);
      mostrar({ tipo: 'sucesso', titulo: 'Código Pix copiado!' });
      setTimeout(() => setCopiado(false), 2500);
    } catch {
      mostrar({ tipo: 'erro', titulo: 'Não consegui copiar — selecione manualmente.' });
    }
  }

  return (
    <Card>
      <CardContent className="p-6 space-y-4 text-center">
        <div>
          <h2 className="text-lg font-extrabold flex items-center justify-center gap-2">
            <QrCode className="size-5 text-primary" /> Pague com Pix
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Escaneie o QR no app do seu banco ou use o copia-e-cola.
          </p>
        </div>

        {dados.qr_code_base64 && (
          <img
            src={`data:image/png;base64,${dados.qr_code_base64}`}
            alt="QR Code Pix"
            className="mx-auto size-56 rounded-xl border border-border bg-white p-2"
          />
        )}

        <div className="flex items-center gap-2">
          <Input readOnly value={dados.qr_code} className="font-mono text-xs" onFocus={e => e.currentTarget.select()} />
          <Button type="button" variant="outline" size="icon" className="shrink-0" onClick={copiar}>
            {copiado ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
          </Button>
        </div>

        <div className="flex items-center justify-center gap-2 rounded-xl bg-accent/50 py-3 text-sm font-medium text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Aguardando confirmação do pagamento…
        </div>

        <p className="text-xs text-muted-foreground">
          Assim que o Pix cair, seu pedido é enviado pra loja automaticamente.
        </p>
        <Button variant="ghost" size="sm" className="w-full" onClick={onCancelar}>
          Voltar
        </Button>
      </CardContent>
    </Card>
  );
}

function Checkout({
  subtotal: _subtotal, total, cupomCodigo, onPedido, onPix,
  zonas, fretePadrao, bloqueado, onFreteChange,
}: {
  subtotal: number; total: number; cupomCodigo?: string;
  onPedido: (id: number) => void;
  onPix: (dados: PixData & { pedidoId: number }) => void;
  zonas: { bairro: string; taxa_centavos: number }[];
  fretePadrao: number;
  bloqueado: boolean;
  onFreteChange: (centavos: number | null) => void;
}) {
  void _subtotal;
  const carrinho = useCarrinho()!;
  const { mostrar } = useToast();
  const enderecos = useQuery({
    queryKey: ['enderecos'],
    queryFn: () => api<{ enderecos: Endereco[] }>('GET', '/api/cliente/enderecos').then(r => r.enderecos),
  });

  const [enderecoId, setEnderecoId] = useState<number | 'novo' | null>(null);
  const [pagamento, setPagamento] = useState<FormaPagamento>('pix');
  const [troco, setTroco] = useState('');
  const [obs, setObs] = useState('');
  const [enviando, setEnviando] = useState(false);

  const [novo, setNovo] = useState({
    rotulo: 'Casa', rua: '', numero: '', complemento: '',
    bairro: '', cidade: '', uf: '', cep: '', referencia: '',
  });

  useEffect(() => {
    if (!enderecos.data) return;
    if (enderecos.data.length === 0) setEnderecoId('novo');
    else if (enderecoId === null) setEnderecoId(enderecos.data[0].id);
  }, [enderecos.data, enderecoId]);

  const bairroSelecionado = enderecoId === 'novo'
    ? novo.bairro
    : enderecos.data?.find(e => e.id === enderecoId)?.bairro ?? '';
  useEffect(() => {
    const zona = zonas.find(z => z.bairro.toLowerCase() === bairroSelecionado.trim().toLowerCase());
    onFreteChange(zona ? zona.taxa_centavos : fretePadrao);
  }, [bairroSelecionado, zonas, fretePadrao, onFreteChange]);

  async function finalizar() {
    setEnviando(true);
    try {
      let idFinal = enderecoId;
      if (idFinal === 'novo') {
        const r = await api<{ endereco: Endereco }>('POST', '/api/cliente/enderecos', novo);
        idFinal = r.endereco.id;
      }
      const r = await api<{ pedido_id: number; pix?: PixData }>('POST', '/api/cliente/pedidos', {
        loja_id: carrinho.loja_id,
        itens: carrinho.itens.map(i => ({ produto_id: i.produto_id, quantidade: i.quantidade, opcoes: i.opcoes })),
        endereco_id: idFinal,
        forma_pagamento: pagamento,
        troco_para: pagamento === 'dinheiro' && troco ? troco : undefined,
        observacoes: obs,
        cupom_codigo: cupomCodigo,
      });
      // Pix online: abre a tela do QR (o pai já esvazia o carrinho). Senão, conclui.
      if (r.pix) onPix({ pedidoId: r.pedido_id, ...r.pix });
      else onPedido(r.pedido_id);
    } catch (e) {
      if (e instanceof ApiError) mostrar({ tipo: 'erro', titulo: 'Não foi possível', descricao: e.message });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Endereço */}
      <Card>
        <CardContent className="p-5 space-y-3">
          <h2 className="flex items-center gap-2 font-bold">
            <div className="flex size-7 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-extrabold">1</div>
            <MapPin className="size-4 text-primary" />
            Endereço de entrega
          </h2>

          <div className="space-y-2">
            {enderecos.data?.map(e => (
              <button
                key={e.id}
                onClick={() => setEnderecoId(e.id)}
                className={cn(
                  'flex w-full items-start gap-3 rounded-xl border-2 p-3.5 text-left transition-all',
                  enderecoId === e.id ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40',
                )}
              >
                <MapPin className={cn('size-4 mt-0.5 shrink-0', enderecoId === e.id ? 'text-primary' : 'text-muted-foreground')} />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{e.rotulo}</div>
                  <div className="text-sm font-semibold">{e.rua}, {e.numero} · {e.bairro}</div>
                  <div className="text-xs text-muted-foreground">{e.cidade}/{e.uf}</div>
                </div>
                {enderecoId === e.id && (
                  <div className="flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground shrink-0">
                    <span className="text-[10px]">✓</span>
                  </div>
                )}
              </button>
            ))}

            <button
              onClick={() => setEnderecoId('novo')}
              className={cn(
                'flex w-full items-center gap-3 rounded-xl border-2 border-dashed p-3.5 text-left text-sm font-semibold transition-colors',
                enderecoId === 'novo' ? 'border-primary text-primary bg-primary/5' : 'border-border text-muted-foreground hover:border-primary/40',
              )}
            >
              <Plus className="size-4" /> Novo endereço
            </button>
          </div>

          {enderecoId === 'novo' && <FormNovoEndereco valor={novo} onMudar={setNovo} />}
        </CardContent>
      </Card>

      {/* Pagamento */}
      <Card>
        <CardContent className="p-5 space-y-3">
          <h2 className="flex items-center gap-2 font-bold">
            <div className="flex size-7 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-extrabold">2</div>
            <CreditCard className="size-4 text-primary" />
            Forma de pagamento
          </h2>
          <div className="grid grid-cols-3 gap-2">
            {PAGAMENTOS.map(p => (
              <button
                key={p.id}
                onClick={() => setPagamento(p.id)}
                className={cn(
                  'flex flex-col items-center gap-1.5 rounded-xl border-2 p-3 text-center transition-all',
                  pagamento === p.id
                    ? 'border-primary bg-primary/5 text-primary'
                    : 'border-border hover:border-primary/40 text-muted-foreground',
                )}
              >
                <div className={cn('transition-colors', pagamento === p.id ? 'text-primary' : 'text-muted-foreground')}>
                  {p.icon}
                </div>
                <span className="text-xs font-bold">{p.label}</span>
                <span className="text-[10px] text-muted-foreground leading-tight">{p.desc}</span>
              </button>
            ))}
          </div>

          {pagamento === 'dinheiro' && (
            <div>
              <Label htmlFor="troco">Troco para quanto? (opcional)</Label>
              <Input
                id="troco"
                value={troco}
                onChange={e => setTroco(e.target.value)}
                inputMode="decimal"
                placeholder="Ex.: 50,00"
              />
            </div>
          )}

          <div>
            <Label htmlFor="obs">Observações para a loja</Label>
            <Textarea
              id="obs"
              value={obs}
              onChange={e => setObs(e.target.value)}
              maxLength={300}
              placeholder="Ex.: sem cebola, interfone quebrado…"
              rows={2}
            />
          </div>
        </CardContent>
      </Card>

      {/* Finalizar */}
      <Button
        size="xl"
        className="w-full rounded-2xl h-14 text-base font-bold"
        onClick={finalizar}
        disabled={enviando || enderecoId === null || bloqueado}
      >
        {enviando ? 'Enviando…' : bloqueado ? 'Pedido abaixo do mínimo' : `Finalizar pedido · ${brl(total)}`}
      </Button>
    </div>
  );
}

function FormNovoEndereco({ valor, onMudar }: { valor: any; onMudar: (v: any) => void }) {
  const m = (campo: string, v: string) => onMudar({ ...valor, [campo]: v });
  return (
    <div className="space-y-3 rounded-xl border border-dashed border-border p-4 bg-accent/30">
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2">
          <Label htmlFor="rua">Rua</Label>
          <Input id="rua" value={valor.rua} onChange={e => m('rua', e.target.value)} />
        </div>
        <div>
          <Label htmlFor="numero">Número</Label>
          <Input id="numero" value={valor.numero} onChange={e => m('numero', e.target.value)} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="complemento">Complemento</Label>
          <Input id="complemento" value={valor.complemento} onChange={e => m('complemento', e.target.value)} />
        </div>
        <div>
          <Label htmlFor="bairro">Bairro</Label>
          <Input id="bairro" value={valor.bairro} onChange={e => m('bairro', e.target.value)} />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2">
          <Label htmlFor="cidade">Cidade</Label>
          <Input id="cidade" value={valor.cidade} onChange={e => m('cidade', e.target.value)} />
        </div>
        <div>
          <Label htmlFor="uf">UF</Label>
          <Input id="uf" maxLength={2} value={valor.uf} onChange={e => m('uf', e.target.value.toUpperCase())} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="cep">CEP</Label>
          <Input id="cep" value={valor.cep} onChange={e => m('cep', e.target.value)} />
        </div>
        <div>
          <Label htmlFor="rotulo">Rótulo</Label>
          <Input id="rotulo" placeholder="Casa, Trabalho…" value={valor.rotulo} onChange={e => m('rotulo', e.target.value)} />
        </div>
      </div>
      <div>
        <Label htmlFor="referencia">Referência</Label>
        <Input id="referencia" value={valor.referencia} onChange={e => m('referencia', e.target.value)} />
      </div>
    </div>
  );
}
