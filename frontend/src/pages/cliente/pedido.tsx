/**
 * Acompanhamento do pedido em tempo real (polling 4s) com linha do tempo
 * animada. Cancelar disponível apenas enquanto pendente.
 */
import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { ArrowLeft, Bike, MapPin, MessageSquare, CreditCard, Check, Clock, Star, Package, ChefHat, CheckCircle2, Truck, Bell, BellRing, Phone, MessagesSquare, ChevronDown, ChevronUp, FileText, XCircle, HelpCircle, LifeBuoy } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { brl, dataLocal, tempoRelativo } from '@/lib/format';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge, ROTULOS_STATUS } from '@/components/ui/status-badge';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';
import { tocarAlerta } from '@/lib/alerta-pedido';
import { suportaPush, estadoPush, ativarPush, type EstadoPush } from '@/lib/push';
import { useTema } from '@/lib/tema';
import { registrarCorLoja } from '@/lib/loja-atual';
import { ChatPedido } from '@/components/chat-pedido';
import { cn } from '@/lib/utils';

// Mapa (Leaflet ~140KB) só baixa quando há entrega ativa para acompanhar.
const MapaRastreamento = lazy(() =>
  import('@/components/mapa-rastreamento').then(m => ({ default: m.MapaRastreamento })),
);
import type { EventoStatus, ItemPedido, Pedido, StatusPedido } from '@/types';

interface AvaliacaoPedido { nota: number; comentario: string; resposta: string; }
interface AvaliacaoEntregador { nota: number; comentario: string; }

const FLUXO: StatusPedido[] = ['pendente', 'aceito', 'preparando', 'pronto', 'em_entrega', 'entregue'];

const ICONES_STATUS: Record<StatusPedido, typeof Clock> = {
  pendente: Clock,
  aceito: Check,
  preparando: ChefHat,
  pronto: Package,
  em_entrega: Truck,
  entregue: CheckCircle2,
  cancelado: Clock,
  recusado: Clock,
};


interface Resposta {
  pedido: Pedido;
  itens: ItemPedido[];
  historico: EventoStatus[];
  avaliacao: AvaliacaoPedido | null;
  avaliacaoEntregador: AvaliacaoEntregador | null;
}

export function PaginaPedido() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { mostrar } = useToast();
  const confirmar = useConfirm();
  const { aplicarCorPrimaria, resetarCorPrimaria } = useTema();
  const [chatAberto, setChatAberto] = useState(false);
  const [detalhesAbertos, setDetalhesAbertos] = useState(false);

  const consulta = useQuery({
    queryKey: ['pedido', id],
    queryFn: () => api<Resposta>('GET', `/api/cliente/pedidos/${id}`),
    enabled: !!id,
    refetchInterval: data => {
      const status = (data as any)?.pedido?.status;
      if (status && ['entregue', 'cancelado', 'recusado'].includes(status)) return false;
      return 4000;
    },
  });

  // A página de acompanhamento adota a cor da marca da LOJA daquele pedido —
  // assim o rastreio "fala a mesma língua" visual do storefront onde o cliente
  // comprou, em vez do laranja padrão da plataforma. Volta ao padrão ao sair.
  const corMarcaLoja = (consulta.data?.pedido as any)?.loja_cor_marca as string | undefined;
  const corSecundariaLoja = (consulta.data?.pedido as any)?.loja_cor_secundaria as string | undefined;
  useEffect(() => {
    if (corMarcaLoja) {
      aplicarCorPrimaria(corMarcaLoja, corSecundariaLoja);
      registrarCorLoja(corMarcaLoja, corSecundariaLoja);
    }
    return () => { resetarCorPrimaria(); };
  }, [corMarcaLoja, corSecundariaLoja, aplicarCorPrimaria, resetarCorPrimaria]);

  // Alerta em primeiro plano: se o entregador avisar "estou chegando" enquanto
  // a página está aberta, toca o som e mostra um toast (o push cobre o app fechado).
  const avisoAnterior = useRef<string | null | undefined>(undefined);
  const aviso = consulta.data?.pedido?.aviso_chegada_em;
  useEffect(() => {
    if (aviso === undefined) return;
    if (avisoAnterior.current === undefined) {
      // Primeira carga: memoriza sem alertar (evita alarme de aviso antigo).
      avisoAnterior.current = aviso || null;
      return;
    }
    if (aviso && aviso !== avisoAnterior.current) {
      tocarAlerta(3);
      mostrar({ tipo: 'info', titulo: 'Seu pedido está chegando!', descricao: 'O entregador está quase aí.' });
    }
    avisoAnterior.current = aviso || null;
  }, [aviso, mostrar]);

  if (consulta.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-32" />
        <Skeleton className="h-72 rounded-2xl" />
        <Skeleton className="h-48 rounded-2xl" />
      </div>
    );
  }
  if (!consulta.data) return null;
  const { pedido, itens, historico, avaliacao, avaliacaoEntregador } = consulta.data;

  const horarios: Partial<Record<StatusPedido, string>> = {};
  for (const h of historico) horarios[h.status] = h.criado_em;

  const terminouMal = pedido.status === 'cancelado' || pedido.status === 'recusado';
  const indiceAtual = FLUXO.indexOf(pedido.status as StatusPedido);
  const ehAtivo = !terminouMal && pedido.status !== 'entregue';

  async function cancelar() {
    if (!(await confirmar({ titulo: 'Cancelar este pedido?', descricao: 'Esta ação não pode ser desfeita.', confirmar: 'Cancelar pedido', cancelar: 'Voltar', destrutivo: true }))) return;
    try {
      await api('POST', `/api/cliente/pedidos/${id}/cancelar`);
      mostrar({ tipo: 'info', titulo: 'Pedido cancelado' });
      consulta.refetch();
    } catch (e) {
      if (e instanceof ApiError) mostrar({ tipo: 'erro', titulo: e.message });
    }
  }

  return (
    <div className="space-y-4 pb-4">
      <button
        onClick={() => navigate('/pedidos')}
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="size-4" /> Meus pedidos
      </button>

      {/* Status hero card */}
      <Card className="overflow-hidden">
        <div className={cn(
          'px-5 py-6 text-center',
          terminouMal
            ? 'bg-destructive/10'
            : pedido.status === 'entregue'
            ? 'bg-emerald-500/10'
            : 'bg-primary/5',
        )}>
          <motion.div
            key={pedido.status}
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className={cn(
              'mx-auto mb-3 flex size-16 items-center justify-center rounded-full',
              terminouMal
                ? 'bg-destructive/15 text-destructive'
                : pedido.status === 'entregue'
                ? 'bg-emerald-500/15 text-emerald-600'
                : 'bg-primary/15 text-primary',
            )}
          >
            {(() => {
              const IconeHero = ICONES_STATUS[pedido.status as StatusPedido] || Clock;
              return <IconeHero className="size-8" strokeWidth={2} />;
            })()}
          </motion.div>
          <div className="flex items-center justify-center gap-2 mb-1">
            <StatusBadge status={pedido.status} />
          </div>
          <div className="text-lg font-extrabold mt-2">Pedido #{pedido.id}</div>
          <div className="text-sm text-muted-foreground mt-0.5">
            {pedido.loja_nome} · {dataLocal(pedido.criado_em)}
          </div>

          {/* Duas caixinhas: previsão de entrega + entregador (ou loja, se ainda não tem entregador) */}
          {ehAtivo && (
            <div className="mt-3 flex flex-col sm:flex-row items-stretch justify-center gap-2">
              <PrevisaoEntrega pedido={pedido} />
              <div className="flex flex-col items-center justify-center rounded-2xl bg-background/70 px-6 py-2.5 shadow-sm min-w-[160px]">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <Bike className="size-3.5 text-primary" />
                  {pedido.entregador_nome ? 'Entregador parceiro' : 'Loja'}
                </div>
                <div className="text-sm font-extrabold mt-0.5 truncate max-w-[160px]">
                  {pedido.entregador_nome || pedido.loja_nome}
                </div>
                {!!pedido.entregador_nota_qtd && pedido.entregador_nota_qtd > 0 && (
                  <div className="flex items-center gap-1 mt-0.5">
                    <Star className="size-3 fill-amber-400 text-amber-400" />
                    <span className="text-xs font-semibold">{pedido.entregador_nota_media?.toFixed(1)}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* Mapa de rastreamento ao vivo — vem antes da timeline, igual ao rastreador de apps de delivery */}
      {pedido.status === 'em_entrega' && (
        <Card className="overflow-hidden">
          <div className="px-5 py-3 flex items-center justify-between border-b border-border">
            <h2 className="flex items-center gap-2 font-bold text-sm">
              <Bike className="size-4 text-primary" />
              Acompanhe a entrega
            </h2>
            {pedido.entregador_local_em && (
              <span className="text-xs text-muted-foreground">
                atualizado {tempoRelativo(pedido.entregador_local_em)}
              </span>
            )}
          </div>
          {pedido.entregador_lat != null && pedido.entregador_lng != null ? (
            <div className="h-64 w-full bg-muted">
              <Suspense fallback={<div className="h-full w-full animate-pulse bg-muted" />}>
                <MapaRastreamento
                  lat={pedido.entregador_lat}
                  lng={pedido.entregador_lng}
                  rotulo={pedido.entregador_nome ? `${pedido.entregador_nome} 🛵` : 'Entregador a caminho'}
                />
              </Suspense>
            </div>
          ) : (
            <div className="px-5 py-8 text-center space-y-2">
              <div className="text-3xl">🛵</div>
              <p className="text-sm font-semibold">O entregador está a caminho!</p>
              <p className="text-xs text-muted-foreground">
                A localização ao vivo aparece assim que ele ativar o GPS.
              </p>
            </div>
          )}
        </Card>
      )}

      {terminouMal && (
        <Card>
          <CardContent className="p-5">
            <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive text-center">
              Pedido {ROTULOS_STATUS[pedido.status].toLowerCase()}
              {pedido.motivo_recusa && `: ${pedido.motivo_recusa}`}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Opt-in de notificações no celular (enquanto o pedido está ativo) */}
      {ehAtivo && <CardAvisos />}

      {/* Duas colunas no desktop: linha do tempo detalhada à esquerda, entregador + resumo à direita */}
      <div className="lg:grid lg:grid-cols-[1fr_320px] lg:gap-4 lg:items-start space-y-4 lg:space-y-0">
        {/* Timeline detalhada */}
        {!terminouMal && (
          <Card>
            <CardContent className="p-5">
              <h2 className="font-bold text-sm uppercase tracking-wider text-muted-foreground mb-4">Acompanhe seu pedido</h2>
              <div className="space-y-0">
                {FLUXO.map((s, i) => {
                  const estado = i < indiceAtual ? 'feito' : i === indiceAtual ? 'atual' : 'futuro';
                  const Icone = ICONES_STATUS[s] || Clock;
                  const isLast = i === FLUXO.length - 1;

                  return (
                    <div key={s} className="flex gap-4">
                      {/* Connector column */}
                      <div className="flex flex-col items-center">
                        <div className={cn(
                          'flex size-9 items-center justify-center rounded-full border-2 shrink-0 transition-all z-10',
                          estado === 'feito' && 'border-primary bg-primary text-primary-foreground',
                          estado === 'atual' && 'border-primary bg-background text-primary',
                          estado === 'futuro' && 'border-border bg-muted text-muted-foreground/50',
                        )}>
                          {estado === 'feito' && <Check className="size-4" strokeWidth={3} />}
                          {estado === 'atual' && (
                            <motion.div
                              className="size-2 rounded-full bg-primary"
                              animate={{ scale: [1, 1.5, 1] }}
                              transition={{ repeat: Infinity, duration: 1.4 }}
                            />
                          )}
                          {estado === 'futuro' && <Icone className="size-4" />}
                        </div>
                        {!isLast && (
                          <div className={cn(
                            'w-0.5 flex-1 my-1 min-h-5 rounded-full',
                            i < indiceAtual ? 'bg-primary/60' : 'bg-border',
                          )} />
                        )}
                      </div>

                      {/* Text */}
                      <div className={cn('flex-1 pb-4', isLast && 'pb-0')}>
                        <div className={cn(
                          'text-sm font-semibold pt-1.5',
                          estado === 'futuro' && 'text-muted-foreground',
                          estado === 'atual' && 'text-primary',
                        )}>
                          {ROTULOS_STATUS[s]}
                          {estado === 'atual' && ehAtivo && (
                            <span className="ml-2 text-xs font-normal text-primary/70 animate-pulse">em andamento…</span>
                          )}
                        </div>
                        {horarios[s] && estado !== 'futuro' && (
                          <div className="text-xs text-muted-foreground mt-0.5">{dataLocal(horarios[s]!)}</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Coluna direita: contato (entregador ou loja, o que estiver disponível) + resumo */}
        <div className="space-y-4">
          {ehAtivo && (
            <ContatoCard pedido={pedido} onAbrirChat={() => setChatAberto(true)} />
          )}

          {/* Resumo do pedido — recolhido, expande pro detalhe completo */}
          <Card>
            <button
              type="button"
              onClick={() => setDetalhesAbertos(v => !v)}
              className="flex w-full items-center justify-between gap-2 p-4 text-left"
            >
              <span className="font-bold text-sm uppercase tracking-wider text-muted-foreground">Resumo do pedido</span>
              {detalhesAbertos ? <ChevronUp className="size-4 text-muted-foreground" /> : <ChevronDown className="size-4 text-muted-foreground" />}
            </button>
            <CardContent className="px-4 pb-4 pt-0 space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{itens.length} {itens.length === 1 ? 'item' : 'itens'}</span>
                <span className="text-muted-foreground">{brl(pedido.subtotal_centavos)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Pagamento</span>
                <span className="font-semibold">
                  {pedido.forma_pagamento === 'pix' && 'Pix'}
                  {pedido.forma_pagamento === 'dinheiro' && 'Dinheiro'}
                  {pedido.forma_pagamento === 'cartao_entrega' && 'Cartão na entrega'}
                </span>
              </div>
              <div className="flex items-center justify-between font-extrabold text-base pt-1.5 border-t">
                <span>Total</span>
                <span className="tabular-nums">{brl(pedido.total_centavos)}</span>
              </div>
            </CardContent>

            {detalhesAbertos && (
              <CardContent className="px-4 pb-4 pt-0 border-t space-y-3">
                <div className="divide-y divide-border pt-2">
                  {itens.map((i, idx) => (
                    <div key={idx} className="py-2.5 first:pt-0 last:pb-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1">
                          <div className="text-sm font-semibold">
                            <span className="inline-flex size-5 items-center justify-center rounded-full bg-primary/10 text-primary text-[10px] font-bold mr-1.5">
                              {i.quantidade}
                            </span>
                            {i.nome_produto}
                          </div>
                          {i.opcoes_texto && (
                            <div className="text-xs text-muted-foreground mt-0.5 ml-6.5">{i.opcoes_texto}</div>
                          )}
                        </div>
                        <div className="font-bold tabular-nums text-sm">{brl(i.preco_unit_centavos * i.quantidade)}</div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="space-y-2 text-sm text-muted-foreground border-t pt-3">
                  <div className="flex items-start gap-2">
                    <CreditCard className="size-4 mt-0.5 shrink-0 text-primary" />
                    <span>
                      {pedido.forma_pagamento === 'pix' && 'Pix'}
                      {pedido.forma_pagamento === 'dinheiro' && 'Dinheiro'}
                      {pedido.forma_pagamento === 'cartao_entrega' && 'Cartão na entrega'}
                      {!!pedido.troco_para_centavos && ` · troco para ${brl(pedido.troco_para_centavos)}`}
                    </span>
                  </div>
                  <div className="flex items-start gap-2">
                    <MapPin className="size-4 mt-0.5 shrink-0 text-primary" />
                    <span>{pedido.endereco_entrega}</span>
                  </div>
                  {pedido.observacoes && (
                    <div className="flex items-start gap-2">
                      <MessageSquare className="size-4 mt-0.5 shrink-0 text-primary" />
                      <span>{pedido.observacoes}</span>
                    </div>
                  )}
                </div>
              </CardContent>
            )}
          </Card>
        </div>
      </div>

      {pedido.status === 'entregue' && (
        <CardAvaliacao
          pedidoId={pedido.id}
          avaliacao={avaliacao}
          onAvaliado={() => consulta.refetch()}
        />
      )}

      {pedido.status === 'entregue' && pedido.entregador_nome && (
        <CardAvaliacaoEntregador
          pedidoId={pedido.id}
          nomeEntregador={pedido.entregador_nome}
          avaliacao={avaliacaoEntregador}
          onAvaliado={() => consulta.refetch()}
        />
      )}

      {/* Barra de ações */}
      <div className="grid grid-cols-3 gap-2">
        <button
          onClick={() => setDetalhesAbertos(v => !v)}
          className="flex flex-col items-center gap-1.5 rounded-2xl border border-border bg-card px-2 py-3 text-xs font-semibold hover:bg-accent transition-colors"
        >
          <FileText className="size-4 text-primary" /> Detalhes do pedido
        </button>
        {pedido.status === 'pendente' ? (
          <button
            onClick={cancelar}
            className="flex flex-col items-center gap-1.5 rounded-2xl border border-border bg-card px-2 py-3 text-xs font-semibold text-destructive hover:bg-destructive/5 transition-colors"
          >
            <XCircle className="size-4" /> Cancelar pedido
          </button>
        ) : (
          <div />
        )}
        <a
          href="#ajuda-pedido"
          className="flex flex-col items-center gap-1.5 rounded-2xl border border-border bg-card px-2 py-3 text-xs font-semibold hover:bg-accent transition-colors"
        >
          <HelpCircle className="size-4 text-primary" /> Ajuda
        </a>
      </div>

      {/* Banner de suporte */}
      <Card id="ajuda-pedido" className="border-primary/20 bg-primary/5">
        <CardContent className="p-4 flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-full bg-primary/15 text-primary shrink-0">
            <LifeBuoy className="size-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-bold text-sm">Precisa de ajuda com seu pedido?</div>
            <p className="text-xs text-muted-foreground">Nossa equipe está pronta pra te ajudar.</p>
          </div>
          <Button size="sm" className="rounded-xl shrink-0" asChild>
            <a href={`mailto:suporte@delivery.com?subject=${encodeURIComponent(`Ajuda com pedido #${pedido.id}`)}`}>
              Falar com atendimento
            </a>
          </Button>
        </CardContent>
      </Card>

      {!terminouMal && (
        <ChatPedido
          basePath={`/api/cliente/pedidos/${pedido.id}`}
          remetenteProprio="cliente"
          nomeContato={pedido.entregador_nome || pedido.loja_nome || 'Loja'}
          aberto={chatAberto}
          onFechar={() => setChatAberto(false)}
        />
      )}
    </div>
  );
}

/** Foto (iniciais)/nota/ligar/chat do entregador designado ao pedido. */
/** Contato do pedido: mostra o entregador se já tiver um atribuído, senão a loja. */
function ContatoCard({ pedido, onAbrirChat }: { pedido: Pedido; onAbrirChat: () => void }) {
  const temEntregador = !!pedido.entregador_nome;
  const nome = pedido.entregador_nome || pedido.loja_nome || 'Loja';
  const temNota = temEntregador && !!pedido.entregador_nota_qtd && pedido.entregador_nota_qtd > 0;
  const usaWhatsApp = temEntregador && pedido.entregador_chat_metodo === 'whatsapp';
  const telefoneDigitos = temEntregador ? (pedido.entregador_telefone || '').replace(/\D/g, '') : '';

  function abrirChatOuWhats() {
    if (usaWhatsApp && telefoneDigitos) {
      const numero = telefoneDigitos.length <= 11 ? `55${telefoneDigitos}` : telefoneDigitos;
      window.open(`https://wa.me/${numero}`, '_blank');
    } else {
      onAbrirChat();
    }
  }

  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary text-lg font-bold shrink-0">
          {(nome || '?').charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-bold text-sm truncate">{nome}</div>
          <div className="text-xs text-muted-foreground">{temEntregador ? 'Entregador parceiro' : 'Sua loja'}</div>
          {temNota && (
            <div className="flex items-center gap-1 mt-0.5">
              <Star className="size-3 fill-amber-400 text-amber-400" />
              <span className="text-xs font-semibold">{pedido.entregador_nota_media?.toFixed(1)}</span>
              <span className="text-xs text-muted-foreground">({pedido.entregador_nota_qtd})</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {telefoneDigitos && (
            <a
              href={`tel:${telefoneDigitos}`}
              className="flex size-9 items-center justify-center rounded-full bg-muted hover:bg-accent text-foreground transition-colors"
              title="Ligar pro entregador"
            >
              <Phone className="size-4" />
            </a>
          )}
          <button
            type="button"
            onClick={abrirChatOuWhats}
            className="flex size-9 items-center justify-center rounded-full bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
            title={temEntregador ? 'Conversar com o entregador' : 'Conversar com a loja'}
          >
            <MessagesSquare className="size-4" />
          </button>
        </div>
      </CardContent>
    </Card>
  );
}

/** Previsão dinâmica de entrega: hora estimada + minutos restantes (atualiza sozinha). */
function PrevisaoEntrega({ pedido }: { pedido: Pedido }) {
  const [, setTick] = useState(0);
  // Re-renderiza a cada 30s para manter os "minutos restantes" atualizados.
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  const minutos = pedido.tempo_estimado_min ?? 40;
  const previsaoMs = new Date(pedido.criado_em).getTime() + minutos * 60_000;
  const restante = Math.round((previsaoMs - Date.now()) / 60_000);
  const hora = new Date(previsaoMs).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  const texto = restante > 1 ? `faltam ~${restante} min` : 'deve chegar a qualquer momento';

  return (
    <div className="mt-3 inline-flex flex-col items-center rounded-2xl bg-background/70 px-6 py-2.5 shadow-sm">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        <Clock className="size-3.5 text-primary" /> Previsão de entrega
      </div>
      <div className="text-2xl font-extrabold tabular-nums leading-tight mt-0.5">~{hora}</div>
      <div className="text-xs font-semibold text-primary">{texto}</div>
    </div>
  );
}

/** Opt-in de notificações push: cliente liga os avisos do pedido no celular. */
function CardAvisos() {
  const { mostrar } = useToast();
  const [estado, setEstado] = useState<EstadoPush>('inativo');
  const [carregando, setCarregando] = useState(false);

  useEffect(() => {
    if (!suportaPush()) { setEstado('sem-suporte'); return; }
    estadoPush().then(setEstado);
  }, []);

  async function ativar() {
    setCarregando(true);
    try {
      const novo = await ativarPush();
      setEstado(novo);
      if (novo === 'ativo') {
        mostrar({ tipo: 'sucesso', titulo: 'Avisos ativados!', descricao: 'Você será notificado quando o pedido estiver chegando.' });
      } else if (novo === 'negado') {
        mostrar({ tipo: 'erro', titulo: 'Permissão negada', descricao: 'Libere as notificações nas configurações do navegador.' });
      }
    } catch {
      mostrar({ tipo: 'erro', titulo: 'Não foi possível ativar os avisos.' });
    } finally {
      setCarregando(false);
    }
  }

  if (estado === 'sem-suporte') return null;

  if (estado === 'ativo') {
    return (
      <div className="flex items-center gap-2.5 rounded-2xl border border-success/30 bg-success/5 px-4 py-3 text-sm">
        <BellRing className="size-4 text-success shrink-0" />
        <span className="text-success font-semibold">Avisos ativados</span>
        <span className="text-muted-foreground">— você será notificado quando chegar.</span>
      </div>
    );
  }

  const bloqueado = estado === 'negado';

  return (
    <Card className={cn(bloqueado ? 'border-border' : 'border-primary/30 bg-primary/5')}>
      <CardContent className="p-4 flex items-center gap-3">
        <div className={cn(
          'flex size-10 items-center justify-center rounded-full shrink-0',
          bloqueado ? 'bg-muted text-muted-foreground' : 'bg-primary/15 text-primary',
        )}>
          <Bell className="size-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-bold text-sm">Quer ser avisado quando chegar?</div>
          <p className="text-xs text-muted-foreground">
            {bloqueado
              ? 'Notificações bloqueadas — libere nas configurações do navegador.'
              : 'Receba um alerta no celular quando o entregador estiver perto.'}
          </p>
        </div>
        {!bloqueado && (
          <Button size="sm" className="rounded-xl shrink-0" onClick={ativar} disabled={carregando}>
            {carregando ? '…' : 'Ativar'}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function CardAvaliacao({
  pedidoId, avaliacao, onAvaliado,
}: { pedidoId: number; avaliacao: AvaliacaoPedido | null; onAvaliado: () => void }) {
  const { mostrar } = useToast();
  const [nota, setNota] = useState(0);
  const [hover, setHover] = useState(0);
  const [comentario, setComentario] = useState('');
  const [enviando, setEnviando] = useState(false);

  if (avaliacao) {
    return (
      <Card className="border-amber-400/30 bg-amber-400/5">
        <CardContent className="p-5 space-y-2">
          <h2 className="font-bold">Sua avaliação</h2>
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map(n => (
              <Star key={n} className={cn('size-5', n <= avaliacao.nota ? 'text-amber-400 fill-amber-400' : 'text-muted-foreground/30')} />
            ))}
          </div>
          {avaliacao.comentario && <p className="text-sm text-muted-foreground">"{avaliacao.comentario}"</p>}
          {avaliacao.resposta && (
            <div className="mt-2 rounded-xl bg-accent/50 px-3 py-2 text-sm">
              <span className="font-semibold">Resposta da loja: </span>{avaliacao.resposta}
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  async function enviar() {
    if (!nota) { mostrar({ tipo: 'erro', titulo: 'Escolha de 1 a 5 estrelas.' }); return; }
    setEnviando(true);
    try {
      await api('POST', `/api/cliente/pedidos/${pedidoId}/avaliar`, { nota, comentario });
      mostrar({ tipo: 'sucesso', titulo: 'Obrigado pela avaliação! ⭐' });
      onAvaliado();
    } catch (e) {
      if (e instanceof ApiError) mostrar({ tipo: 'erro', titulo: e.message });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardContent className="p-5 space-y-3">
        <div className="text-center">
          <div className="text-3xl mb-2">⭐</div>
          <h2 className="font-bold">Como foi seu pedido?</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Sua opinião ajuda outros clientes</p>
        </div>
        <div className="flex justify-center gap-2">
          {[1, 2, 3, 4, 5].map(n => (
            <button
              key={n}
              type="button"
              onClick={() => setNota(n)}
              onMouseEnter={() => setHover(n)}
              onMouseLeave={() => setHover(0)}
              className="p-0.5 transition-transform active:scale-90"
            >
              <Star className={cn('size-9 transition-all', n <= (hover || nota) ? 'text-amber-400 fill-amber-400 scale-110' : 'text-muted-foreground/30')} />
            </button>
          ))}
        </div>
        <textarea
          value={comentario}
          onChange={e => setComentario(e.target.value)}
          rows={2}
          maxLength={500}
          placeholder="Conte como foi (opcional)…"
          className="w-full px-3 py-2.5 rounded-xl border border-input bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <Button className="w-full rounded-2xl" size="lg" onClick={enviar} disabled={enviando || !nota}>
          {enviando ? 'Enviando…' : 'Enviar avaliação'}
        </Button>
      </CardContent>
    </Card>
  );
}

function CardAvaliacaoEntregador({
  pedidoId, nomeEntregador, avaliacao, onAvaliado,
}: { pedidoId: number; nomeEntregador: string; avaliacao: AvaliacaoEntregador | null; onAvaliado: () => void }) {
  const { mostrar } = useToast();
  const [nota, setNota] = useState(0);
  const [hover, setHover] = useState(0);
  const [comentario, setComentario] = useState('');
  const [enviando, setEnviando] = useState(false);

  if (avaliacao) {
    return (
      <Card>
        <CardContent className="p-5 space-y-2">
          <h2 className="font-bold">Avaliação do entregador</h2>
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map(n => (
              <Star key={n} className={cn('size-5', n <= avaliacao.nota ? 'text-amber-400 fill-amber-400' : 'text-muted-foreground/30')} />
            ))}
          </div>
          {avaliacao.comentario && <p className="text-sm text-muted-foreground">"{avaliacao.comentario}"</p>}
        </CardContent>
      </Card>
    );
  }

  async function enviar() {
    if (!nota) { mostrar({ tipo: 'erro', titulo: 'Escolha de 1 a 5 estrelas.' }); return; }
    setEnviando(true);
    try {
      await api('POST', `/api/cliente/pedidos/${pedidoId}/avaliar-entregador`, { nota, comentario });
      mostrar({ tipo: 'sucesso', titulo: 'Obrigado pela avaliação!' });
      onAvaliado();
    } catch (e) {
      if (e instanceof ApiError) mostrar({ tipo: 'erro', titulo: e.message });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Card>
      <CardContent className="p-5 space-y-3">
        <div className="text-center">
          <h2 className="font-bold">Como foi a entrega com {nomeEntregador}?</h2>
        </div>
        <div className="flex justify-center gap-2">
          {[1, 2, 3, 4, 5].map(n => (
            <button
              key={n}
              type="button"
              onClick={() => setNota(n)}
              onMouseEnter={() => setHover(n)}
              onMouseLeave={() => setHover(0)}
              className="p-0.5 transition-transform active:scale-90"
            >
              <Star className={cn('size-9 transition-all', n <= (hover || nota) ? 'text-amber-400 fill-amber-400 scale-110' : 'text-muted-foreground/30')} />
            </button>
          ))}
        </div>
        <textarea
          value={comentario}
          onChange={e => setComentario(e.target.value)}
          rows={2}
          maxLength={500}
          placeholder="Conte como foi (opcional)…"
          className="w-full px-3 py-2.5 rounded-xl border border-input bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <Button variant="outline" className="w-full rounded-2xl" size="lg" onClick={enviar} disabled={enviando || !nota}>
          {enviando ? 'Enviando…' : 'Avaliar entregador'}
        </Button>
      </CardContent>
    </Card>
  );
}
