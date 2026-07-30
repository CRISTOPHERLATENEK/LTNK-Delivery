/**
 * Painel de COZINHA (KDS — Kitchen Display System).
 *
 * App isolado com login próprio (perfil 'cozinha', vinculado a uma loja).
 * Tela cheia pensada pra um tablet na cozinha: só os pedidos em preparo,
 * cards grandes, cor por tempo de espera e alerta sonoro em pedido novo.
 */
import { useEffect, useRef, useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChefHat, Clock, AlarmClock, Check, Play, Volume2, VolumeX, LogOut, Soup,
  Bike, UtensilsCrossed, ShoppingBag, Keyboard, WifiOff,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { api, ApiError, sessaoUsuario, salvarSessao, encerrarSessao } from '@/lib/api';
import { cn } from '@/lib/utils';

type FonteCozinha = 'delivery' | 'mesa' | 'balcao';

interface ItemCozinha {
  nome_produto: string;
  quantidade: number;
  detalhe: string;
}
interface PedidoCozinha {
  fonte: FonteCozinha;
  id: number;
  referencia: string;
  etapa: 'novo' | 'preparando';
  observacao: string;
  criado_em: string;
  itens: ItemCozinha[];
}

export function PainelCozinha() {
  const sessao = sessaoUsuario('cozinha');
  const ehCozinha = !!sessao && sessao.perfil === 'cozinha';

  if (!ehCozinha) return <LoginCozinha />;

  return (
    <Routes>
      <Route path="*" element={<TelaKDS />} />
    </Routes>
  );
}

/* ─────────────────────────── Login ─────────────────────────── */
function LoginCozinha() {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [enviando, setEnviando] = useState(false);
  const { mostrar } = useToast();

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    try {
      const r = await api<{ token: string; conta: any }>('POST', '/api/cozinha/login', { email, senha });
      salvarSessao(r.token, {
        id: r.conta.id, nome: r.conta.nome, email: r.conta.email,
        perfil: 'cozinha', loja_id: r.conta.loja_id, loja_nome: r.conta.loja_nome,
      }, 'cozinha');
      window.location.reload();
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="min-h-dvh bg-background text-foreground flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-2">
          <div className="mx-auto flex size-16 items-center justify-center rounded-3xl bg-primary text-primary-foreground">
            <ChefHat className="size-8" />
          </div>
          <h2 className="text-2xl font-extrabold">Cozinha</h2>
          <p className="text-sm text-muted-foreground">Entre com a conta da cozinha da sua loja.</p>
        </div>
        <Card>
          <CardContent className="p-6">
            <form onSubmit={enviar} className="space-y-4">
              <div>
                <Label htmlFor="email-cozinha">E-mail</Label>
                <Input id="email-cozinha" type="email" required placeholder="cozinha@sualoja.com"
                  value={email} onChange={e => setEmail(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="senha-cozinha">Senha</Label>
                <Input id="senha-cozinha" type="password" required placeholder="••••••••"
                  value={senha} onChange={e => setSenha(e.target.value)} />
              </div>
              <Button type="submit" size="lg" className="w-full" disabled={enviando}>
                {enviando ? 'Entrando…' : 'Entrar'}
              </Button>
            </form>
          </CardContent>
        </Card>
        <p className="text-center text-xs text-muted-foreground">
          A conta da cozinha é criada pelo lojista no painel da loja.
        </p>
      </div>
    </div>
  );
}

/* ─────────────────────────── KDS ─────────────────────────── */

const CHAVE_SOM = 'cozinha:som';

function TelaKDS() {
  const sessao = sessaoUsuario('cozinha');
  const qc = useQueryClient();
  const { mostrar } = useToast();
  const [som, setSom] = useState(() => localStorage.getItem(CHAVE_SOM) !== '0');
  const [agora, setAgora] = useState(() => Date.now());
  // IDs já vistos: base do alerta sonoro (ver efeito abaixo). `null` no primeiro
  // render pra não bipar a fila inteira ao abrir a tela.
  const idsVistos = useRef<Set<string> | null>(null);

  const pedidosQ = useQuery({
    queryKey: ['cozinha-pedidos'],
    queryFn: () => api<{ pedidos: PedidoCozinha[] }>('GET', '/api/cozinha/pedidos').then(r => r.pedidos),
    refetchInterval: 4000,
  });
  const pedidos = pedidosQ.data ?? [];

  // Quanto tempo desde a última resposta OK do servidor (o relógio de 1s acima
  // mantém isto vivo). `dataUpdatedAt` = 0 antes da primeira carga.
  const segundosDesatualizado = pedidosQ.dataUpdatedAt
    ? Math.floor((agora - pedidosQ.dataUpdatedAt) / 1000)
    : 0;
  const dadoVelho = pedidosQ.dataUpdatedAt > 0 && segundosDesatualizado >= 20;

  /**
   * POR QUE a fila parou de atualizar. Antes dizia sempre "Sem conexão com o
   * servidor", inclusive quando o servidor respondia perfeitamente com 401 —
   * a cozinha ficava olhando uma fila velha, sem ação possível, achando que o
   * problema era a internet. Sessão expirada tem conserto (entrar de novo), e
   * a tela precisa dizer isso.
   */
  const erroFila = pedidosQ.error;
  const statusErro = erroFila instanceof ApiError ? erroFila.status : 0;
  const sessaoCaiu = statusErro === 401 || statusErro === 403;
  const motivoParada = !navigator.onLine
    ? 'Este aparelho está sem internet — a fila pode estar desatualizada'
    : sessaoCaiu
    ? 'Sua sessão expirou — entre de novo para voltar a receber pedidos'
    : statusErro >= 500
    ? `O servidor respondeu com erro (${statusErro}) — a fila pode estar desatualizada`
    : 'Sem conexão com o servidor — a fila pode estar desatualizada';

  /**
   * DUAS RAIAS: "Novos" (ainda não começados) e "Em preparo".
   *
   * Antes tudo caía num grid só, com o estágio escrito em letra miúda no card.
   * Em cozinha movimentada isso obriga a LER cada ticket pra saber o que ainda
   * não foi começado. Separado em colunas, a resposta é a posição na tela.
   *
   * Cada raia preserva a ordem que vem do servidor (mais antigo primeiro), que é
   * a ordem em que se deve produzir.
   */
  const novos = pedidos.filter(p => p.etapa !== 'preparando');
  const emPreparo = pedidos.filter(p => p.etapa === 'preparando');
  const raias = [
    { chave: 'novos' as const, titulo: 'Novos', itens: novos, icone: ShoppingBag },
    { chave: 'preparo' as const, titulo: 'Em preparo', itens: emPreparo, icone: Soup },
  ];

  // Atalhos de teclado: ↑/↓ anda na coluna, ←/→ troca de coluna, Enter avança o
  // ticket selecionado. Pensado pro pico de movimento, quando ninguém quer ficar
  // mirando o mouse.
  const [sel, setSel] = useState<{ col: number; idx: number }>({ col: 0, idx: 0 });
  const selecionadoAtual = raias[sel.col]?.itens[sel.idx];

  // A fila muda embaixo do usuário (pedido novo entra, outro fica pronto): manter
  // o índice dentro do limite evita seleção "fantasma" apontando pro vazio.
  useEffect(() => {
    const max = Math.max(0, (raias[sel.col]?.itens.length ?? 0) - 1);
    if (sel.idx > max) setSel(s => ({ ...s, idx: max }));
  }, [novos.length, emPreparo.length, sel.col, sel.idx]);

  // Relógio de 1s: numa cozinha o cronômetro precisa PARECER vivo. Com 15s, um
  // ticket ficava mostrando "5 min" por um quarto de minuto e a tela parecia
  // congelada. O custo é um setState por segundo — irrelevante.
  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  /**
   * Alerta sonoro por PEDIDO NOVO — comparando IDs, não a quantidade.
   *
   * BUG QUE ISSO CORRIGE: antes era `qtd > ultimaQtd`. Se entre duas
   * atualizações um pedido saía (ficou pronto) e outro entrava, a contagem não
   * mudava e o bip NÃO tocava — justamente no pico de movimento, que é quando a
   * cozinha depende do som pra não perder pedido.
   */
  useEffect(() => {
    const ids = new Set(pedidos.map(p => `${p.fonte}-${p.id}`));
    const vistos = idsVistos.current;
    if (vistos) {
      const chegou = [...ids].some(id => !vistos.has(id));
      if (chegou && som) tocarBip();
    }
    idsVistos.current = ids;
  }, [pedidos, som]);

  /**
   * Mantém a tela acesa (Wake Lock). KDS vive num tablet preso na parede: se a
   * tela apaga, a cozinha perde pedido e ninguém percebe. Re-solicita ao voltar
   * de segundo plano, porque o bloqueio é perdido quando a aba fica oculta.
   * Navegador sem suporte simplesmente ignora.
   */
  useEffect(() => {
    type Lock = { release: () => Promise<void> };
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<Lock> } };
    if (!nav.wakeLock) return;
    let lock: Lock | null = null;
    let vivo = true;
    const pedir = async () => {
      try { lock = await nav.wakeLock!.request('screen'); } catch { /* negado/sem suporte */ }
    };
    pedir();
    const aoMudarVisibilidade = () => { if (vivo && document.visibilityState === 'visible') pedir(); };
    document.addEventListener('visibilitychange', aoMudarVisibilidade);
    return () => {
      vivo = false;
      document.removeEventListener('visibilitychange', aoMudarVisibilidade);
      lock?.release().catch(() => { /* já liberado */ });
    };
  }, []);

  function alternarSom() {
    setSom(s => {
      const novo = !s;
      localStorage.setItem(CHAVE_SOM, novo ? '1' : '0');
      if (novo) tocarBip();
      return novo;
    });
  }

  async function acao(p: PedidoCozinha, tipo: 'preparar' | 'pronto') {
    // Atualização otimista: tira/avança o card na hora.
    qc.setQueryData<PedidoCozinha[]>(['cozinha-pedidos'], old =>
      (old ?? []).flatMap(x => {
        if (!(x.fonte === p.fonte && x.id === p.id)) return [x];
        return tipo === 'pronto' ? [] : [{ ...x, etapa: 'preparando' as const }];
      }),
    );
    const url = p.fonte === 'delivery'
      ? `/api/cozinha/pedidos/${p.id}/acao`
      : `/api/cozinha/tickets/${p.id}/acao`;
    try {
      await api('POST', url, { acao: tipo });
    } catch (e) {
      if (e instanceof ApiError) mostrar({ tipo: 'erro', titulo: e.message });
      pedidosQ.refetch();
    }
  }

  // Setas navegam, Enter avança o ticket selecionado. Ignora quando o foco
  // está num campo de texto (não existe nenhum nesta tela hoje, mas evita
  // surpresa se algum dia aparecer um input aqui).
  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      const alvo = e.target as HTMLElement;
      if (alvo.tagName === 'INPUT' || alvo.tagName === 'TEXTAREA') return;
      if (pedidos.length === 0) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSel(s => ({ ...s, idx: Math.min((raias[s.col]?.itens.length ?? 1) - 1, s.idx + 1) }));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSel(s => ({ ...s, idx: Math.max(0, s.idx - 1) }));
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        // Troca de coluna mantendo a posição, limitada ao tamanho da coluna alvo.
        setSel(s => {
          const col = e.key === 'ArrowRight' ? Math.min(raias.length - 1, s.col + 1) : Math.max(0, s.col - 1);
          return { col, idx: Math.min(s.idx, Math.max(0, (raias[col]?.itens.length ?? 1) - 1)) };
        });
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const p = raias[sel.col]?.itens[sel.idx];
        if (p) acao(p, p.etapa === 'preparando' ? 'pronto' : 'preparar');
      }
    }
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [pedidos, sel, novos.length, emPreparo.length]);

  return (
    <div className="min-h-dvh bg-background text-foreground flex flex-col">
      {/* Top bar */}
      <header className="sticky top-0 z-20 border-b border-border/60 bg-background/90 backdrop-blur">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
              <ChefHat className="size-5" />
            </div>
            <div className="leading-tight">
              <div className="font-extrabold">Cozinha</div>
              <div className="text-xs text-muted-foreground">{sessao?.loja_nome}</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden sm:flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
              <Soup className="size-4" /> {pedidos.length} na fila
            </span>
            <span className="hidden lg:flex items-center gap-1.5 text-xs text-muted-foreground" title="↑/↓ anda na coluna · ←/→ troca de coluna · Enter avança o ticket selecionado">
              <Keyboard className="size-3.5" /> ↑↓ fila · ←→ coluna · Enter avança
            </span>
            <button onClick={alternarSom} title={som ? 'Som ligado' : 'Som desligado'}
              className="flex size-9 items-center justify-center rounded-xl hover:bg-accent text-muted-foreground">
              {som ? <Volume2 className="size-5" /> : <VolumeX className="size-5" />}
            </button>
            <button
              onClick={() => { encerrarSessao('cozinha'); window.location.href = '/cozinha'; }}
              title="Sair" className="flex size-9 items-center justify-center rounded-xl hover:bg-accent text-muted-foreground">
              <LogOut className="size-5" />
            </button>
          </div>
        </div>
      </header>

      {/*
        AVISO DE DADO VELHO — sem isto, perder a rede fazia o KDS seguir
        mostrando a fila antiga em silêncio: a cozinha acha que está tudo em dia
        enquanto pedido novo entra e ninguém vê. Aparece quando a última
        atualização bem-sucedida passou de 20s (o polling é de 4s, então 20s já
        significa 5 tentativas falhando).
      */}
      {dadoVelho && (
        <div className="flex flex-wrap items-center justify-center gap-2 bg-red-500/15 px-4 py-2 text-sm font-bold text-red-700 dark:text-red-300">
          <WifiOff className="size-4 shrink-0" />
          {motivoParada}
          <span className="tabular-nums font-normal opacity-80">({segundosDesatualizado}s)</span>
          {sessaoCaiu ? (
            <button
              onClick={() => { encerrarSessao('cozinha'); window.location.href = '/cozinha'; }}
              className="rounded-lg bg-red-600 px-3 py-1 text-xs font-bold text-white hover:bg-red-700"
            >
              Entrar de novo
            </button>
          ) : (
            <button
              onClick={() => { pedidosQ.refetch(); }}
              className="rounded-lg border border-current px-3 py-1 text-xs font-bold hover:bg-red-500/10"
            >
              Tentar agora
            </button>
          )}
        </div>
      )}

      {/* Fila */}
      <main className="flex-1 p-4">
        {pedidosQ.isLoading && (
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-48" />)}
          </div>
        )}

        {!pedidosQ.isLoading && pedidos.length === 0 && (
          <div className="flex flex-col items-center justify-center text-center py-24 text-muted-foreground">
            <ChefHat className="size-16 opacity-20 mb-4" />
            <p className="text-lg font-semibold">Nenhum pedido na cozinha agora</p>
            <p className="text-sm">Os pedidos aceitos aparecem aqui automaticamente.</p>
          </div>
        )}

        {pedidos.length > 0 && (
          // Cada raia rola por conta própria: fila longa de "Novos" não empurra
          // "Em preparo" pra fora da tela (num tablet fixo, rolar é o que se
          //  quer evitar).
          /* Orientação, não só largura: tablet de 800px em PÉ tem largura de "md"
             mas duas raias lado a lado ali ficam com ~380px cada e o ticket fica
             ilegível de longe. Em retrato as raias empilham (sobra altura), em
             paisagem ficam lado a lado. */
          <div className="grid gap-4 md:landscape:grid-cols-2 xl:grid-cols-2">
            {raias.map(raia => {
              const IconeRaia = raia.icone;
              return (
                <section key={raia.chave} className="flex min-h-0 flex-col">
                  <div className="mb-2 flex items-center gap-2 border-b border-border/60 pb-2">
                    <IconeRaia className="size-4 text-muted-foreground" />
                    <h2 className="text-sm font-extrabold uppercase tracking-wide">{raia.titulo}</h2>
                    <span className="ml-auto rounded-full bg-accent px-2 py-0.5 text-xs font-bold tabular-nums">
                      {raia.itens.length}
                    </span>
                  </div>

                  {raia.itens.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      {raia.chave === 'novos' ? 'Nada novo na fila.' : 'Nada em preparo.'}
                    </p>
                  ) : (
                    /* Em retrato a raia ocupa a largura toda, então cabem dois
                       tickets por linha bem antes do xl. */
                    <div className="grid gap-3 md:portrait:grid-cols-2 xl:grid-cols-2">
                      {raia.itens.map(p => (
                        <TicketCozinha
                          key={`${p.fonte}-${p.id}`}
                          pedido={p}
                          agora={agora}
                          onAcao={acao}
                          selecionado={selecionadoAtual === p}
                        />
                      ))}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </main>

      {/* Legenda */}
      {pedidos.length > 0 && (
        <footer className="border-t border-border/60 px-4 py-2 flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-green-500" /> Novo</span>
          <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-amber-500" /> +5 min</span>
          <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-red-500" /> +10 min atrasado</span>
        </footer>
      )}
    </div>
  );
}

/**
 * Cor e rótulo por tempo de espera.
 *
 * O rótulo é `m:ss` (cronômetro), não "5 min": com granularidade de minuto o
 * número ficava parado por 60s e a tela parecia travada — numa cozinha, ver o
 * tempo correndo é o que cria senso de urgência.
 *
 * As cores aqui são fixas (verde/âmbar/vermelho) de propósito: é semáforo,
 * convenção universal de urgência, não identidade visual da marca.
 */
function urgencia(criadoEm: string, agora: number) {
  const seg = Math.max(0, Math.floor((agora - new Date(criadoEm).getTime()) / 1000));
  const min = Math.floor(seg / 60);
  const rotulo = `${min}:${String(seg % 60).padStart(2, '0')}`;
  if (min >= 10) return {
    min, rotulo, atrasado: true,
    faixa: 'bg-red-500/15 text-red-700 dark:text-red-300',
    borda: 'border-red-500/50',
  };
  if (min >= 5) return {
    min, rotulo, atrasado: false,
    faixa: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
    borda: 'border-amber-500/40',
  };
  return {
    min, rotulo, atrasado: false,
    faixa: 'bg-green-500/15 text-green-700 dark:text-green-300',
    borda: 'border-green-500/40',
  };
}

const FONTE_INFO: Record<FonteCozinha, { icone: typeof Bike; rotulo: string }> = {
  delivery: { icone: Bike, rotulo: 'Delivery' },
  mesa:     { icone: UtensilsCrossed, rotulo: 'Salão' },
  balcao:   { icone: ShoppingBag, rotulo: 'Balcão' },
};

function TicketCozinha({
  pedido, agora, onAcao, selecionado,
}: {
  pedido: PedidoCozinha;
  agora: number;
  onAcao: (p: PedidoCozinha, tipo: 'preparar' | 'pronto') => void;
  selecionado?: boolean;
}) {
  const u = urgencia(pedido.criado_em, agora);
  const emPreparo = pedido.etapa === 'preparando';
  const Fonte = FONTE_INFO[pedido.fonte] ?? FONTE_INFO.delivery;
  const IconeFonte = Fonte.icone;

  // `animate-pulse` era aplicado no CARD INTEIRO quando atrasado — piscava o
  // texto dos itens, ou seja, atrapalhava a leitura exatamente do pedido mais
  // urgente. Agora só o relógio pisca: chama atenção sem prejudicar quem está
  // lendo o que precisa preparar.
  return (
    <Card className={cn(
      'overflow-hidden border-2 transition-shadow',
      u.borda,
      u.atrasado && 'shadow-lg shadow-red-500/20',
      selecionado && 'ring-4 ring-primary/50 shadow-lg',
    )}>
      <div className={cn('flex items-center justify-between px-3 py-2 font-bold', u.faixa)}>
        <span className="flex items-center gap-1.5 text-base">
          <IconeFonte className="size-4" /> {pedido.referencia}
        </span>
        <span className={cn(
          'flex items-center gap-1.5 tabular-nums',
          // Fonte maior no tempo: é o dado que se lê a 2 m de distância.
          u.atrasado ? 'text-lg animate-pulse' : 'text-base',
        )}>
          {u.atrasado ? <AlarmClock className="size-4" /> : <Clock className="size-4" />} {u.rotulo}
        </span>
      </div>
      <CardContent className="p-3">
        {/* O estágio (novo / em preparo) não é repetido aqui: a COLUNA já diz.
            Sobra só a origem (Delivery / Salão / Balcão), que a coluna não diz. */}
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">
          {Fonte.rotulo}
        </div>
        <div className="space-y-1.5">
          {pedido.itens.map((it, idx) => (
            <div key={idx} className="leading-tight">
              <div className="font-semibold">
                <span className="tabular-nums text-muted-foreground mr-1">{it.quantidade}×</span>
                {it.nome_produto}
              </div>
              {it.detalhe && (
                <div className="text-xs text-muted-foreground pl-5">{it.detalhe}</div>
              )}
            </div>
          ))}
        </div>
        {pedido.observacao && (
          <div className="mt-2 rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-700 dark:text-amber-300">
            📝 {pedido.observacao}
          </div>
        )}
        <Button
          size="lg"
          variant={emPreparo ? 'success' : 'default'}
          className="w-full mt-3"
          onClick={() => onAcao(pedido, emPreparo ? 'pronto' : 'preparar')}
        >
          {emPreparo
            ? (<><Check className="size-4" /> Marcar pronto</>)
            : (<><Play className="size-4" /> Iniciar preparo</>)}
        </Button>
      </CardContent>
    </Card>
  );
}

/* Bip curto via Web Audio (sem arquivo de áudio). */
function tocarBip() {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4);
    osc.start();
    osc.stop(ctx.currentTime + 0.42);
    osc.onended = () => ctx.close();
  } catch { /* navegador sem Web Audio — ignora */ }
}
