/**
 * Monitor ao vivo — pedidos em andamento de TODAS as lojas, atualizando sozinho.
 */
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AdminLayout } from './layout';
import { Cabecalho, Num, Botao } from './ui';
import { Falha } from '@/components/ui/estado';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { brl, tempoRelativo } from '@/lib/format';

interface PedidoMonitor {
  id: number;
  status: string;
  total_centavos: number;
  criado_em: string;
  loja_nome: string;
  cliente_nome: string;
  entregador_nome: string | null;
  /** Presente só na visão agregada do painel master. */
  tenant_id?: number;
  tenant_nome?: string;
}

const COLUNAS: Array<{ status: string; rotulo: string }> = [
  { status: 'pendente',   rotulo: 'Aguardando loja' },
  { status: 'aceito',     rotulo: 'Aceitos' },
  { status: 'preparando', rotulo: 'Em preparo' },
  { status: 'pronto',     rotulo: 'Prontos' },
  { status: 'em_entrega', rotulo: 'Em entrega' },
];

const CHAVE_SOM = 'admin:monitor:som';

/**
 * Minutos de espera que viram alerta.
 *
 * Só valem pra `pendente`: é o único estado em que ninguém está trabalhando no
 * pedido — ele está parado esperando a loja aceitar. "Em preparo" há 20 minutos
 * é uma pizza no forno, não um problema.
 */
const ALERTA_AMBAR = 10;
const ALERTA_VERMELHO = 20;

function minutosDesde(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
}

export function TelaMonitor() {
  const monitorQ = useQuery({
    queryKey: ['admin-monitor'],
    queryFn: () => api<{ pedidos: PedidoMonitor[] }>('GET', '/api/admin/monitor').then(r => r.pedidos),
    refetchInterval: 5000,
  });
  const pedidos = monitorQ.data ?? [];

  /*
   * Re-renderiza a cada 30s pra ESPERA envelhecer na tela.
   *
   * Os dados chegam a cada 5s, mas um pedido que ninguém mexe não vem alterado
   * — e sem este tick ele ficaria "há 9 min" pra sempre, nunca virando âmbar.
   */
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  const [som, setSom] = useState(() => localStorage.getItem(CHAVE_SOM) === '1');
  function alternarSom() {
    const novo = !som;
    setSom(novo);
    localStorage.setItem(CHAVE_SOM, novo ? '1' : '0');
  }

  /*
   * TOCA quando aparece pedido pendente NOVO — não a cada atualização.
   *
   * Guarda os ids já vistos: sem isso o som dispararia a cada 5 segundos
   * enquanto o pedido continuasse pendente, e alguém desligaria o recurso no
   * primeiro minuto.
   */
  const vistosRef = useRef<Set<number> | null>(null);
  useEffect(() => {
    const pendentes = pedidos.filter(p => p.status === 'pendente').map(p => p.id);
    // Primeira carga só memoriza: senão tocaria pra fila que já existia antes
    // de a tela abrir.
    if (vistosRef.current === null) {
      vistosRef.current = new Set(pendentes);
      return;
    }
    const novos = pendentes.filter(id => !vistosRef.current!.has(id));
    pendentes.forEach(id => vistosRef.current!.add(id));
    if (novos.length === 0 || !som) return;
    try {
      // Bipe gerado na hora: um arquivo de áudio seria mais um recurso pra
      // servir e pra falhar em silêncio se não carregasse.
      const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const vol = ctx.createGain();
      osc.frequency.value = 880;
      vol.gain.value = 0.06;
      osc.connect(vol); vol.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.18);
    } catch { /* navegador sem permissão de áudio: silêncio é melhor que erro */ }
  }, [pedidos, som]);

  return (
    <AdminLayout titulo="Monitor">
      <div>
        <Cabecalho
          titulo="Monitor"
          subtitulo={
            monitorQ.isLoading
              ? 'Carregando…'
              : `${pedidos.length} ${pedidos.length === 1 ? 'pedido' : 'pedidos'} em andamento · atualiza a cada 5s`
          }
          acoes={
            <Botao onClick={alternarSom}>
              {som ? 'Som ligado' : 'Som desligado'}
            </Botao>
          }
        />

        {monitorQ.isError && <Falha compacto erro={monitorQ.error} aoTentar={() => monitorQ.refetch()} />}

        {monitorQ.isLoading && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {COLUNAS.map(c => <Skeleton key={c.status} className="h-40" />)}
          </div>
        )}

        {!monitorQ.isLoading && pedidos.length === 0 && !monitorQ.isError && (
          <p className="py-16 text-center text-[13px]" style={{ color: 'var(--adm-dado)' }}>
            Nenhum pedido em andamento.
          </p>
        )}

        {!monitorQ.isLoading && pedidos.length > 0 && (
          <div className="grid items-start gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {COLUNAS.map(col => {
              const doStatus = pedidos.filter(p => p.status === col.status);
              return (
                <div key={col.status}>
                  <div className="flex items-baseline justify-between pb-1.5">
                    <span className="text-[11px] font-medium uppercase tracking-wider" style={{ color: 'var(--adm-rotulo)' }}>
                      {col.rotulo}
                    </span>
                    <Num className="text-[11px]" >{doStatus.length}</Num>
                  </div>

                  {/*
                    COLUNA VAZIA MOSTRA "nenhum", não some.
                    Sumir mudava a POSIÇÃO das outras colunas conforme a fila
                    andava — quem olha a tela o dia inteiro decora onde fica
                    "Em preparo", e a coluna pulando de lugar quebra isso. O
                    custo de manter é uma linha de 12px.
                  */}
                  {doStatus.length === 0 ? (
                    <div
                      className="px-2 py-3 text-[12px]"
                      style={{ color: 'var(--adm-dado)', border: '1px solid var(--adm-linha2)', borderRadius: 6 }}
                    >
                      nenhum
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {doStatus.map(p => {
                        const min = minutosDesde(p.criado_em);
                        const esperando = p.status === 'pendente';
                        const vermelho = esperando && min >= ALERTA_VERMELHO;
                        const ambar = esperando && !vermelho && min >= ALERTA_AMBAR;
                        return (
                          <div
                            key={`${p.tenant_id ?? 0}-${p.id}`}
                            style={{
                              border: '1px solid var(--adm-linha)',
                              /*
                               * A URGÊNCIA É UMA BORDA DE 2px À ESQUERDA, não o
                               * card inteiro pintado. Com quinze cards âmbares
                               * na tela, o fundo colorido vira o normal e para
                               * de significar urgência; a barra na lateral
                               * marca sem tingir o conteúdo.
                               */
                              borderLeft: `2px solid ${vermelho ? 'var(--adm-erro)'
                                : ambar ? 'var(--adm-atencao)'
                                : 'var(--adm-linha)'}`,
                              borderRadius: 4,
                              background: '#fff',
                            }}
                            className="px-2.5 py-2"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <Num className="text-[11px]" >#{p.id}</Num>
                              {/*
                                O TEMPO DE ESPERA é o dado central desta tela, e
                                fica em mono para as colunas alinharem: comparar
                                "há 4 min" com "há 21 min" de relance é a razão
                                de a tela existir.
                              */}
                              <Num
                                className="text-[11px]"
                                style={vermelho ? { color: 'var(--adm-erro)', fontWeight: 600 }
                                  : ambar ? { color: 'var(--adm-atencao)', fontWeight: 600 }
                                  : { color: 'var(--adm-dado)' }}
                              >
                                {esperando && min >= ALERTA_AMBAR ? `${min} min parado` : tempoRelativo(p.criado_em)}
                              </Num>
                            </div>
                            <div className="mt-0.5 truncate text-[13px] font-medium">{p.loja_nome}</div>
                            <div className="truncate text-[11.5px]" style={{ color: 'var(--adm-dado)' }}>
                              {p.cliente_nome}
                              {p.entregador_nome && ` · ${p.entregador_nome}`}
                            </div>
                            <div className="pt-0.5">
                              <Num className="text-[12px] font-medium">{brl(p.total_centavos)}</Num>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
