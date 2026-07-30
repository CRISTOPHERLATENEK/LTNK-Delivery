/**
 * Áreas de entrega desenhadas no mapa (regiões + taxa de cada uma).
 *
 * Complementa a taxa por bairro: a área é geográfica, então não depende do nome
 * do bairro bater, não cobra igual em bairro que é perto de um lado e longe do
 * outro, e permite respeitar rio/morro/avenida que cortam a região.
 *
 * ⚠️ Desenhar a PRIMEIRA área liga o bloqueio: endereço fora de todas passa a ser
 * recusado no checkout. A tela avisa isso de forma explícita — é a consequência
 * que o lojista precisa entender antes de salvar.
 */
import { useEffect, useState } from 'react';
import { Map as MapaIcone, Plus, Trash2, Pencil, Check, X, AlertTriangle } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { brl } from '@/lib/format';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';
import { MapaAreas, type AreaMapa, type PontoMapa } from '@/components/mapa-areas';

interface Resposta {
  areas: AreaMapa[];
  loja_lat: number | null;
  loja_lon: number | null;
}

export function AreasEntrega({ taxaPadrao }: { taxaPadrao: number }) {
  const { mostrar } = useToast();
  const confirmar = useConfirm();
  const [dados, setDados] = useState<Resposta | null>(null);
  const [desenhando, setDesenhando] = useState(false);
  const [selecionada, setSelecionada] = useState<number | null>(null);
  const [enviando, setEnviando] = useState(false);

  // Rascunho recém-desenhado, aguardando nome/taxa antes de salvar.
  const [novo, setNovo] = useState<{ poligono: PontoMapa[]; nome: string; taxa: string } | null>(null);

  function carregar() {
    api<Resposta>('GET', '/api/lojista/areas')
      .then(setDados)
      .catch(() => mostrar({ tipo: 'erro', titulo: 'Não foi possível carregar as áreas de entrega.' }));
  }
  useEffect(() => { carregar(); }, []);

  async function salvarNovo() {
    if (!novo) return;
    setEnviando(true);
    try {
      await api('POST', '/api/lojista/areas', {
        nome: novo.nome.trim() || 'Área de entrega',
        taxa: novo.taxa === '' ? 0 : Number(novo.taxa),
        poligono: novo.poligono,
      });
      setNovo(null);
      setDesenhando(false);
      carregar();
      mostrar({ tipo: 'sucesso', titulo: 'Área salva!' });
    } catch (e) {
      if (e instanceof ApiError) mostrar({ tipo: 'erro', titulo: e.message });
    } finally { setEnviando(false); }
  }

  async function excluir(a: AreaMapa) {
    const ok = await confirmar({
      titulo: `Excluir "${a.nome || 'área'}"?`,
      descricao: dados && dados.areas.length === 1
        ? 'Esta é a última área. Sem nenhuma área desenhada, a loja volta a aceitar pedidos de qualquer endereço (cobrando a taxa por bairro ou a padrão).'
        : 'Endereços que só estavam nessa área deixarão de ser atendidos.',
      confirmar: 'Excluir',
      destrutivo: true,
    });
    if (!ok) return;
    try {
      await api('DELETE', `/api/lojista/areas/${a.id}`);
      carregar();
      mostrar({ tipo: 'sucesso', titulo: 'Área excluída.' });
    } catch (e) {
      if (e instanceof ApiError) mostrar({ tipo: 'erro', titulo: e.message });
    }
  }

  async function alterarTaxa(a: AreaMapa, valor: string) {
    try {
      await api('PUT', `/api/lojista/areas/${a.id}`, { taxa: valor === '' ? 0 : Number(valor) });
      carregar();
    } catch (e) {
      if (e instanceof ApiError) mostrar({ tipo: 'erro', titulo: e.message });
    }
  }

  if (!dados) return <Skeleton className="h-72" />;

  const semCoordenada = dados.loja_lat == null || dados.loja_lon == null;
  const centro: PontoMapa = semCoordenada
    ? [-14.235, -51.925]                            // centro do Brasil: só pra não abrir no oceano
    : [dados.loja_lat as number, dados.loja_lon as number];

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-5">
          <div className="mb-1 flex items-center gap-2">
            <MapaIcone className="size-5 text-primary" />
            <span className="font-bold">Áreas de entrega no mapa</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Desenhe as regiões que você atende e a taxa de cada uma. A área vale mais que a taxa
            por bairro: se o endereço cair dentro dela, é a taxa da área que é cobrada.
          </p>
        </CardContent>
      </Card>

      {/* A loja sem coordenada não tem como ancorar o mapa — avisa em vez de
          deixar o lojista desenhar no lugar errado. */}
      {semCoordenada && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="flex gap-3 p-4">
            <AlertTriangle className="size-5 shrink-0 text-amber-600" />
            <p className="text-sm">
              <b>Confirme o endereço da loja primeiro.</b> Ainda não localizamos sua loja no mapa,
              então ele abre sem referência. Salve o endereço em <b>Dados</b> e volte aqui.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Consequência de existir área: o checkout passa a recusar quem está fora. */}
      {dados.areas.length > 0 && (
        <Card className="border-primary/40 bg-primary/5">
          <CardContent className="flex gap-3 p-4">
            <AlertTriangle className="size-5 shrink-0 text-primary" />
            <p className="text-sm">
              Com área desenhada, <b>pedidos de endereço fora de todas as áreas são recusados</b> no
              checkout. Endereço sem localização identificada continua caindo na taxa por bairro/padrão.
            </p>
          </CardContent>
        </Card>
      )}

      <MapaAreas
        centro={centro}
        areas={dados.areas}
        areaSelecionada={selecionada}
        desenhando={desenhando}
        onSelecionar={setSelecionada}
        onCancelarDesenho={() => { setDesenhando(false); setNovo(null); }}
        onDesenhoConcluido={poligono => { setNovo({ poligono, nome: '', taxa: '' }); setDesenhando(false); }}
        // Contorno pronto do bairro buscado: entra como rascunho já nomeado, e o
        // lojista só define a taxa (pode redesenhar se quiser ajustar).
        onUsarContorno={(poligono, nome) => {
          setDesenhando(false);
          setNovo({ poligono, nome, taxa: '' });
        }}
      />

      {!desenhando && !novo && (
        <Button onClick={() => { setDesenhando(true); setSelecionada(null); }} className="w-full">
          <Plus className="size-4" /> Desenhar nova área
        </Button>
      )}

      {/* Nome + taxa do rascunho */}
      {novo && (
        <Card className="border-primary/50">
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center gap-2 text-sm font-bold">
              <Pencil className="size-4 text-primary" /> Nomeie a área ({novo.poligono.length} pontos)
            </div>
            <div className="grid gap-2 sm:grid-cols-[1fr_8rem]">
              <div>
                <Label>Nome</Label>
                <Input value={novo.nome} maxLength={80} placeholder="Ex.: Centro e arredores"
                  onChange={e => setNovo(n => n && { ...n, nome: e.target.value })} />
              </div>
              <div>
                <Label>Taxa (R$)</Label>
                <Input type="number" step="0.01" min="0" placeholder="0,00" value={novo.taxa}
                  onChange={e => setNovo(n => n && { ...n, taxa: e.target.value })} />
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={salvarNovo} disabled={enviando}>
                <Check className="size-4" /> {enviando ? 'Salvando…' : 'Salvar área'}
              </Button>
              <Button variant="ghost" onClick={() => setNovo(null)}>
                <X className="size-4" /> Descartar
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Áreas já salvas */}
      <Card>
        <CardContent className="p-3">
          {dados.areas.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nenhuma área desenhada. Todo endereço é aceito, cobrando a taxa por bairro
              ou a padrão ({brl(taxaPadrao)}).
            </p>
          ) : (
            <div className="divide-y divide-border/60">
              {dados.areas.map(a => (
                <div key={a.id}
                  className={`flex items-center gap-3 px-2 py-2.5 ${selecionada === a.id ? 'bg-accent/40' : ''}`}
                  onMouseEnter={() => setSelecionada(a.id)}>
                  <MapaIcone className="size-4 shrink-0 text-primary" />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{a.nome || 'Área de entrega'}</span>
                  <div className="relative w-24 shrink-0">
                    <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">R$</span>
                    <Input
                      type="number" step="0.01" min="0"
                      defaultValue={(a.taxa_centavos / 100).toFixed(2)}
                      onBlur={e => {
                        const novoValor = e.target.value;
                        if (Number(novoValor) * 100 !== a.taxa_centavos) alterarTaxa(a, novoValor);
                      }}
                      className="h-9 pl-7 text-sm"
                    />
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => excluir(a)} title="Excluir área">
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
