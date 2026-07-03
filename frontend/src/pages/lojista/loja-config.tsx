import { useEffect, useState } from 'react';
import { Settings, Save, Power, Clock, Zap, Bike, Plus, Trash2, MapPin, CreditCard, Eye, EyeOff, CheckCircle2, XCircle, Link2, Wand2, Printer, RefreshCw, FileText } from 'lucide-react';
import { imprimirCupom, configImpressao } from '@/lib/impressao';
import { agenteAtivo, listarImpressorasAgente, impressoraAgente, definirImpressoraAgente, URL_EDITOR_FISCAL } from '@/lib/agente';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { brl } from '@/lib/format';
import type { DiaHorario, Loja } from '@/types';

export function LojaConfiguracao() {
  const { mostrar } = useToast();
  const [loja, setLoja] = useState<Loja | null>(null);
  const [form, setForm] = useState({
    nome: '', descricao: '', categoria: '', endereco: '',
    taxa_entrega: '', tempo_estimado_min: '', horario_funcionamento: '', minimo_pedido: '',
    slug: '',
  });
  const [enviando, setEnviando] = useState(false);
  const [alternando, setAlternando] = useState(false);

  useEffect(() => {
    api<{ loja: Loja }>('GET', '/api/lojista/loja').then(r => {
      const l = r.loja;
      setLoja(l);
      setForm({
        nome: l.nome,
        descricao: l.descricao || '',
        categoria: l.categoria || '',
        endereco: l.endereco || '',
        taxa_entrega: String((l.taxa_entrega_centavos / 100).toFixed(2)),
        tempo_estimado_min: String(l.tempo_estimado_min),
        horario_funcionamento: l.horario_funcionamento || '',
        minimo_pedido: l.minimo_pedido_centavos ? String((l.minimo_pedido_centavos / 100).toFixed(2)) : '',
        slug: (l as any).slug || '',
      });
    }).catch(() => mostrar({ tipo: 'erro', titulo: 'Não foi possível carregar os dados da loja.' }));
  }, []);

  function campo(k: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm(f => ({ ...f, [k]: e.target.value }));
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    try {
      const r = await api<{ loja: Loja }>('PUT', '/api/lojista/loja', {
        nome: form.nome,
        descricao: form.descricao,
        categoria: form.categoria,
        endereco: form.endereco,
        taxa_entrega: form.taxa_entrega === '' ? 0 : Number(form.taxa_entrega),
        tempo_estimado_min: Number(form.tempo_estimado_min),
        horario_funcionamento: form.horario_funcionamento,
        minimo_pedido: form.minimo_pedido === '' ? 0 : Number(form.minimo_pedido),
        slug: form.slug.trim() || null,
      });
      setLoja(r.loja);
      mostrar({ tipo: 'sucesso', titulo: 'Loja atualizada!' });
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally {
      setEnviando(false);
    }
  }

  async function alternarAberta() {
    if (!loja) return;
    setAlternando(true);
    try {
      const r = await api<{ aberta: boolean }>('POST', '/api/lojista/loja/abrir-fechar');
      setLoja(l => l ? { ...l, aberta: r.aberta ? 1 : 0 } : l);
      mostrar({ tipo: 'sucesso', titulo: r.aberta ? 'Loja aberta para pedidos!' : 'Loja fechada.' });
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally {
      setAlternando(false);
    }
  }

  if (!loja) return <Skeleton className="h-96" />;

  return (
    <div className="space-y-5">
      {/* Status + botão abrir/fechar */}
      <Card>
        <CardContent className="p-5 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className={`flex size-10 items-center justify-center rounded-xl ${loja.aberta ? 'bg-green-500/10' : 'bg-muted'}`}>
              <Power className={`size-5 ${loja.aberta ? 'text-green-600' : 'text-muted-foreground'}`} />
            </div>
            <div>
              <div className="font-semibold">Status da loja</div>
              <div className="flex gap-2 mt-0.5">
                <Badge variant={
                  loja.status_aprovacao === 'aprovada' ? 'success'
                    : loja.status_aprovacao === 'suspensa' ? 'danger'
                      : 'warning'
                }>
                  {loja.status_aprovacao}
                </Badge>
                {loja.aberta
                  ? <Badge variant="success">Aberta</Badge>
                  : <Badge variant="secondary">Fechada</Badge>
                }
                {!!loja.auto_horario && (
                  <Badge variant="outline" className="gap-1"><Zap className="size-3" /> automático</Badge>
                )}
              </div>
            </div>
          </div>
          <Button
            variant={loja.aberta ? 'destructive' : 'success'}
            onClick={alternarAberta}
            disabled={alternando || loja.status_aprovacao !== 'aprovada'}
          >
            <Power className="size-4" />
            {alternando ? '…' : loja.aberta ? 'Fechar agora' : 'Abrir agora'}
          </Button>
          {loja.status_aprovacao !== 'aprovada' && (
            <p className="w-full text-xs text-muted-foreground">
              ⚠️ A loja precisa estar aprovada pelo administrador antes de abrir.
            </p>
          )}
          {!!loja.auto_horario && (
            <p className="w-full text-xs text-muted-foreground">
              Em modo automático, fechar agora pausa a loja por ~2h; ela reabre sozinha no próximo horário.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Formulário de dados */}
      <Card>
        <CardContent className="p-6">
          <form onSubmit={salvar} className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label>Nome da loja *</Label>
              <Input required value={form.nome} onChange={campo('nome')} placeholder="Nome visível para os clientes" />
            </div>

            <div>
              <Label>Categoria</Label>
              <Input value={form.categoria} onChange={campo('categoria')} placeholder="Ex.: Pizzaria, Hamburguer, Sushi" />
            </div>

            <div>
              <Label>Endereço</Label>
              <Input value={form.endereco} onChange={campo('endereco')} placeholder="Rua, número, bairro" />
            </div>

            <div className="sm:col-span-2">
              <Label className="flex items-center gap-1.5">
                <Link2 className="size-3.5" /> URL amigável (slug)
              </Label>
              <div className="flex gap-2 mt-1">
                <div className="relative flex-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none select-none">
                    /loja/
                  </span>
                  <Input
                    value={form.slug}
                    onChange={e => setForm(f => ({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') }))}
                    placeholder="minha-loja"
                    className="pl-12 font-mono text-sm"
                    maxLength={60}
                  />
                </div>
                <button
                  type="button"
                  title="Gerar a partir do nome"
                  onClick={() => {
                    const slug = form.nome
                      .toLowerCase()
                      .normalize('NFD').replace(/[̀-ͯ]/g, '')
                      .replace(/[^a-z0-9]+/g, '-')
                      .replace(/^-|-$/g, '')
                      .slice(0, 60);
                    setForm(f => ({ ...f, slug }));
                  }}
                  className="shrink-0 flex items-center gap-1.5 h-10 px-3 rounded-lg border border-input bg-muted text-xs font-semibold hover:bg-muted/80 transition-colors"
                >
                  <Wand2 className="size-3.5" /> Gerar
                </button>
              </div>
              {form.slug && (
                <p className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1">
                  <Link2 className="size-3" />
                  <span className="font-mono">{window.location.origin}/loja/{form.slug}</span>
                </p>
              )}
              {!form.slug && (
                <p className="text-[11px] text-muted-foreground mt-1">Opcional. Permite acessar via URL amigável em vez de /loja/123.</p>
              )}
            </div>

            <div className="sm:col-span-2">
              <Label>Descrição</Label>
              <textarea
                value={form.descricao}
                onChange={campo('descricao')}
                rows={3}
                placeholder="Conte um pouco sobre sua loja…"
                className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            <div>
              <Label>Taxa de entrega padrão (R$)</Label>
              <Input
                type="number" step="0.01" min="0"
                value={form.taxa_entrega}
                onChange={campo('taxa_entrega')}
                placeholder="0.00 para grátis"
              />
              <p className="text-[11px] text-muted-foreground mt-1">Usada quando o bairro não está nas zonas de entrega.</p>
            </div>

            <div>
              <Label>Pedido mínimo (R$)</Label>
              <Input
                type="number" step="0.01" min="0"
                value={form.minimo_pedido}
                onChange={campo('minimo_pedido')}
                placeholder="0.00 para sem mínimo"
              />
            </div>

            <div>
              <Label>Tempo estimado (minutos)</Label>
              <Input
                type="number" min="1"
                value={form.tempo_estimado_min}
                onChange={campo('tempo_estimado_min')}
                placeholder="Ex.: 40"
              />
            </div>

            <div>
              <Label>Horário (texto exibido)</Label>
              <Input
                value={form.horario_funcionamento}
                onChange={campo('horario_funcionamento')}
                placeholder="Ex.: Seg–Sex 18h–23h"
              />
              <p className="text-[11px] text-muted-foreground mt-1">Só informativo. A abertura automática usa a aba "Horário".</p>
            </div>

            <div className="sm:col-span-2">
              <Button type="submit" size="lg" className="w-full" disabled={enviando}>
                <Save className="size-4" />
                {enviando ? 'Salvando…' : 'Salvar configurações'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

/* ───────────────────────── Horário automático ───────────────────────── */

const DIAS = [
  { dia: 1, nome: 'Segunda' },
  { dia: 2, nome: 'Terça' },
  { dia: 3, nome: 'Quarta' },
  { dia: 4, nome: 'Quinta' },
  { dia: 5, nome: 'Sexta' },
  { dia: 6, nome: 'Sábado' },
  { dia: 0, nome: 'Domingo' },
];

function agendaPadrao(): DiaHorario[] {
  return DIAS.map(d => ({ dia: d.dia, aberto: d.dia !== 0, abre: '18:00', fecha: '23:00' }));
}

export function HorarioLoja() {
  const { mostrar } = useToast();
  const [auto, setAuto] = useState(false);
  const [agenda, setAgenda] = useState<DiaHorario[]>(agendaPadrao());
  const [carregado, setCarregado] = useState(false);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    api<{ loja: Loja }>('GET', '/api/lojista/loja').then(r => {
      const l = r.loja;
      setAuto(!!l.auto_horario);
      let parsed: DiaHorario[] = [];
      try { parsed = JSON.parse(l.horario_json || '[]'); } catch { /* vazio */ }
      // Garante os 7 dias na ordem certa, preenchendo faltantes.
      const mapa = new Map(parsed.map(d => [d.dia, d]));
      setAgenda(DIAS.map(d => mapa.get(d.dia) ?? { dia: d.dia, aberto: d.dia !== 0, abre: '18:00', fecha: '23:00' }));
      setCarregado(true);
    }).catch(() => mostrar({ tipo: 'erro', titulo: 'Não foi possível carregar o horário.' }));
  }, []);

  function atualizarDia(dia: number, patch: Partial<DiaHorario>) {
    setAgenda(a => a.map(d => d.dia === dia ? { ...d, ...patch } : d));
  }

  function copiarParaTodos(origem: DiaHorario) {
    setAgenda(a => a.map(d => ({ ...d, abre: origem.abre, fecha: origem.fecha, aberto: origem.aberto })));
    mostrar({ tipo: 'info', titulo: 'Horário copiado para todos os dias.' });
  }

  async function salvar() {
    setEnviando(true);
    try {
      await api('PUT', '/api/lojista/loja', {
        auto_horario: auto,
        horario_json: JSON.stringify(agenda),
      });
      mostrar({ tipo: 'sucesso', titulo: auto ? 'Horário automático ativado!' : 'Horário salvo.' });
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally {
      setEnviando(false);
    }
  }

  if (!carregado) return <Skeleton className="h-96" />;

  return (
    <div className="space-y-4">
      {/* Toggle automático */}
      <Card className={cn(auto && 'border-primary/40 bg-primary/5')}>
        <CardContent className="p-5">
          <button
            type="button"
            onClick={() => setAuto(v => !v)}
            className="flex w-full items-center gap-3 text-left"
          >
            <div className={cn('flex size-11 items-center justify-center rounded-2xl shrink-0', auto ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>
              <Zap className="size-5" />
            </div>
            <div className="flex-1">
              <div className="font-bold">Abrir e fechar automaticamente</div>
              <p className="text-xs text-muted-foreground">
                A loja abre e fecha sozinha conforme a agenda abaixo. Você não precisa lembrar de clicar.
              </p>
            </div>
            <div className={cn('relative h-6 w-11 rounded-full transition-colors shrink-0', auto ? 'bg-primary' : 'bg-muted-foreground/30')}>
              <span className={cn('absolute top-0.5 size-5 rounded-full bg-white shadow transition-all', auto ? 'left-[22px]' : 'left-0.5')} />
            </div>
          </button>
        </CardContent>
      </Card>

      {/* Editor da agenda */}
      <Card className={cn(!auto && 'opacity-60')}>
        <CardContent className="p-4 space-y-2">
          <div className="flex items-center gap-2 mb-1">
            <Clock className="size-4 text-primary" />
            <span className="font-bold text-sm">Agenda semanal</span>
          </div>
          {agenda.map(d => {
            const nome = DIAS.find(x => x.dia === d.dia)?.nome ?? '';
            return (
              <div key={d.dia} className="flex items-center gap-2 rounded-xl border border-border/60 p-2.5">
                {/* toggle aberto */}
                <button
                  type="button"
                  disabled={!auto}
                  onClick={() => atualizarDia(d.dia, { aberto: !d.aberto })}
                  className={cn('relative h-5 w-9 rounded-full transition-colors shrink-0', d.aberto ? 'bg-primary' : 'bg-muted-foreground/30')}
                >
                  <span className={cn('absolute top-0.5 size-4 rounded-full bg-white shadow transition-all', d.aberto ? 'left-[18px]' : 'left-0.5')} />
                </button>
                <span className="w-20 text-sm font-semibold shrink-0">{nome}</span>
                {d.aberto ? (
                  <div className="flex items-center gap-1.5 flex-1">
                    <Input
                      type="time" disabled={!auto}
                      value={d.abre}
                      onChange={e => atualizarDia(d.dia, { abre: e.target.value })}
                      className="h-9 text-sm px-2 flex-1 min-w-0"
                    />
                    <span className="text-muted-foreground text-xs">às</span>
                    <Input
                      type="time" disabled={!auto}
                      value={d.fecha}
                      onChange={e => atualizarDia(d.dia, { fecha: e.target.value })}
                      className="h-9 text-sm px-2 flex-1 min-w-0"
                    />
                    <button
                      type="button" disabled={!auto}
                      onClick={() => copiarParaTodos(d)}
                      title="Copiar este horário para todos os dias"
                      className="shrink-0 text-[11px] font-semibold text-primary hover:underline disabled:opacity-40 px-1"
                    >
                      todos
                    </button>
                  </div>
                ) : (
                  <span className="flex-1 text-sm text-muted-foreground">Fechado</span>
                )}
              </div>
            );
          })}
          <p className="text-[11px] text-muted-foreground pt-1">
            Para virar a madrugada, coloque o fechamento depois da meia-noite (ex.: abre 19:00, fecha 02:00).
          </p>
        </CardContent>
      </Card>

      <Button size="lg" className="w-full" onClick={salvar} disabled={enviando}>
        <Save className="size-4" />
        {enviando ? 'Salvando…' : 'Salvar horário'}
      </Button>
    </div>
  );
}

/* ───────────────────────── Zonas de entrega ───────────────────────── */

interface Zona { id: number; bairro: string; taxa_centavos: number; }

export function ZonasEntrega() {
  const { mostrar } = useToast();
  const [zonas, setZonas] = useState<Zona[]>([]);
  const [carregado, setCarregado] = useState(false);
  const [bairro, setBairro] = useState('');
  const [taxa, setTaxa] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [taxaPadrao, setTaxaPadrao] = useState(0);

  function carregar() {
    api<{ zonas: Zona[] }>('GET', '/api/lojista/zonas')
      .then(r => { setZonas(r.zonas); setCarregado(true); })
      .catch(() => mostrar({ tipo: 'erro', titulo: 'Não foi possível carregar as zonas.' }));
  }

  useEffect(() => {
    carregar();
    api<{ loja: Loja }>('GET', '/api/lojista/loja')
      .then(r => setTaxaPadrao(r.loja.taxa_entrega_centavos))
      .catch(() => { });
  }, []);

  async function adicionar() {
    if (!bairro.trim()) return;
    setEnviando(true);
    try {
      await api('POST', '/api/lojista/zonas', { bairro: bairro.trim(), taxa: taxa === '' ? 0 : Number(taxa) });
      setBairro(''); setTaxa('');
      carregar();
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally {
      setEnviando(false);
    }
  }

  async function excluir(id: number) {
    try {
      await api('DELETE', `/api/lojista/zonas/${id}`);
      setZonas(z => z.filter(x => x.id !== id));
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    }
  }

  if (!carregado) return <Skeleton className="h-80" />;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-5">
          <div className="flex items-center gap-2 mb-1">
            <Bike className="size-5 text-primary" />
            <span className="font-bold">Taxa de entrega por bairro</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Cobre frete diferente conforme o bairro do cliente. Bairros sem zona cadastrada
            pagam a taxa padrão ({brl(taxaPadrao)}).
          </p>
        </CardContent>
      </Card>

      {/* Adicionar zona */}
      <Card>
        <CardContent className="p-4">
          <Label className="mb-2 block">Adicionar bairro</Label>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <MapPin className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                placeholder="Nome do bairro"
                value={bairro}
                onChange={e => setBairro(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), adicionar())}
                className="h-10 pl-8"
              />
            </div>
            <div className="relative w-28 shrink-0">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground pointer-events-none">R$</span>
              <Input
                type="number" step="0.01" min="0" placeholder="0,00"
                value={taxa}
                onChange={e => setTaxa(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), adicionar())}
                className="h-10 pl-7 text-sm"
              />
            </div>
            <Button className="h-10 shrink-0" onClick={adicionar} disabled={enviando || !bairro.trim()}>
              <Plus className="size-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Lista */}
      <Card>
        <CardContent className="p-3">
          {zonas.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              Nenhuma zona cadastrada. Todos os bairros pagam a taxa padrão ({brl(taxaPadrao)}).
            </p>
          ) : (
            <div className="divide-y divide-border/60">
              {zonas.map(z => (
                <div key={z.id} className="flex items-center gap-3 py-2.5 px-1">
                  <MapPin className="size-4 text-muted-foreground shrink-0" />
                  <span className="flex-1 text-sm font-medium truncate">{z.bairro}</span>
                  <span className="text-sm font-bold tabular-nums shrink-0">
                    {z.taxa_centavos === 0 ? <span className="text-success">grátis</span> : brl(z.taxa_centavos)}
                  </span>
                  <button
                    onClick={() => excluir(z.id)}
                    className="shrink-0 p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ───────────────────────── Pagamentos (Mercado Pago) ───────────────────── */

export function PagamentosLoja() {
  const { mostrar } = useToast();
  const [ativo, setAtivo] = useState(false);
  const [tokenMascarado, setTokenMascarado] = useState<string | null>(null);
  const [novoToken, setNovoToken] = useState('');
  const [mostrarToken, setMostrarToken] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [carregado, setCarregado] = useState(false);

  function carregar() {
    api<{ ativo: boolean; token_mascarado: string | null }>('GET', '/api/lojista/pagamentos')
      .then(r => { setAtivo(r.ativo); setTokenMascarado(r.token_mascarado); setCarregado(true); })
      .catch(() => mostrar({ tipo: 'erro', titulo: 'Não foi possível carregar configurações de pagamento.' }));
  }

  useEffect(() => { carregar(); }, []);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    try {
      const r = await api<{ ok: boolean; ativo: boolean; token_mascarado: string | null }>(
        'PUT', '/api/lojista/pagamentos', { token: novoToken }
      );
      setAtivo(r.ativo);
      setTokenMascarado(r.token_mascarado);
      setNovoToken('');
      mostrar({ tipo: 'sucesso', titulo: r.ativo ? 'Token salvo! Pix online ativado.' : 'Token removido. Pix online desativado.' });
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally {
      setEnviando(false);
    }
  }

  if (!carregado) return <Skeleton className="h-64" />;

  return (
    <div className="space-y-4">
      {/* Status atual */}
      <Card className={ativo ? 'border-green-500/40 bg-green-500/5' : undefined}>
        <CardContent className="p-5 flex items-center gap-4">
          <div className={`flex size-11 shrink-0 items-center justify-center rounded-2xl ${ativo ? 'bg-green-500/15' : 'bg-muted'}`}>
            {ativo
              ? <CheckCircle2 className="size-5 text-green-600" />
              : <XCircle className="size-5 text-muted-foreground" />
            }
          </div>
          <div>
            <div className="font-bold">
              {ativo ? 'Pix online ativo' : 'Pix online inativo'}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {ativo
                ? `Token configurado: ${tokenMascarado}`
                : 'Configure o Access Token do Mercado Pago para aceitar Pix.'}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Formulário para salvar token */}
      <Card>
        <CardContent className="p-5">
          <div className="flex items-center gap-2 mb-4">
            <CreditCard className="size-4 text-primary" />
            <span className="font-bold text-sm">{ativo ? 'Trocar token' : 'Configurar token'}</span>
          </div>
          <form onSubmit={salvar} className="space-y-3">
            <div>
              <Label>Access Token do Mercado Pago</Label>
              <div className="relative mt-1">
                <input
                  type={mostrarToken ? 'text' : 'password'}
                  value={novoToken}
                  onChange={e => setNovoToken(e.target.value)}
                  placeholder={ativo ? 'Cole o novo token para substituir' : 'APP_USR-xxxx...'}
                  className="w-full h-10 rounded-lg border border-input bg-background px-3 pr-10 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <button
                  type="button"
                  onClick={() => setMostrarToken(v => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {mostrarToken ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">
                Obtenha em{' '}
                <span className="font-medium text-foreground">mercadopago.com.br → Desenvolvedores → Credenciais</span>.
                Use o token de <strong>produção</strong> (APP_USR-...) ou <strong>teste</strong> (TEST-...) para sandbox.
              </p>
            </div>

            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={enviando || !novoToken.trim()}>
                <Save className="size-3.5" />
                {enviando ? 'Salvando…' : 'Salvar token'}
              </Button>
              {ativo && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={enviando}
                  onClick={() => { setNovoToken(''); salvar({ preventDefault: () => { } } as React.FormEvent); }}
                >
                  Remover Pix
                </Button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Info webhook */}
      {ativo && (
        <Card className="border-dashed">
          <CardContent className="p-4 text-xs text-muted-foreground space-y-1">
            <p className="font-semibold text-foreground text-sm">Configurar webhook no Mercado Pago</p>
            <p>
              Para o Pix ser confirmado automaticamente, adicione a URL abaixo no painel de
              Notificações (IPN) do Mercado Pago:
            </p>
            <code className="block bg-muted px-2 py-1.5 rounded text-[11px] font-mono break-all">
              https://SEUDOMINIO/api/pagamentos/webhook/mercadopago
            </code>
            <p>Exige HTTPS. Em localhost use o token de teste + aprove manualmente pelo painel do MP.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ───────────────────────── Impressão térmica ───────────────────────── */

export function ImpressaoLoja() {
  const { mostrar } = useToast();
  const [loja, setLoja] = useState<Loja | null>(null);
  const [largura, setLargura] = useState<'80' | '58'>('80');
  const [auto, setAuto] = useState(true);
  const [rodape, setRodape] = useState('');
  const [enviando, setEnviando] = useState(false);
  // Nosso Agente de Impressão (preferido) — impressora salva neste PC.
  const [agImpressoras, setAgImpressoras] = useState<string[]>([]);
  const [agSelecionada, setAgSelecionada] = useState(impressoraAgente());
  const [agEstado, setAgEstado] = useState<'idle' | 'buscando' | 'ok' | 'off'>('idle');

  async function conectarAgente() {
    setAgEstado('buscando');
    if (!(await agenteAtivo())) { setAgEstado('off'); return; }
    try {
      const lista = await listarImpressorasAgente();
      setAgImpressoras(lista);
      setAgEstado('ok');
      if (!agSelecionada) {
        const term = lista.find(n => /elgin|bematech|epson|pos|term|58|80|i[789]/i.test(n));
        if (term) { setAgSelecionada(term); definirImpressoraAgente(term); }
      }
    } catch { setAgEstado('off'); }
  }
  function escolherAgente(nome: string) {
    setAgSelecionada(nome);
    definirImpressoraAgente(nome);
    mostrar({ tipo: 'sucesso', titulo: 'Impressora definida', descricao: nome });
  }


  useEffect(() => {
    api<{ loja: Loja }>('GET', '/api/lojista/loja').then(r => {
      setLoja(r.loja);
      setLargura(r.loja.impressora_largura === '58' ? '58' : '80');
      setAuto(r.loja.impressora_auto === undefined ? true : !!r.loja.impressora_auto);
      setRodape(r.loja.cupom_rodape || '');
    }).catch(() => mostrar({ tipo: 'erro', titulo: 'Não foi possível carregar a configuração.' }));
    conectarAgente(); // detecta o nosso agente automaticamente ao abrir
  }, []);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    try {
      const r = await api<{ loja: Loja }>('PUT', '/api/lojista/loja', {
        impressora_largura: largura,
        impressora_auto: auto,
        cupom_rodape: rodape,
      });
      setLoja(r.loja);
      mostrar({ tipo: 'sucesso', titulo: 'Impressão configurada! 🖨️' });
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally {
      setEnviando(false);
    }
  }

  function imprimirTeste() {
    imprimirCupom({
      titulo: 'CUPOM DE TESTE',
      linhas: [
        { qtd: '2', nome: 'Produto exemplo', valor: 'R$ 49,80' },
        { qtd: '0,350 kg', nome: 'Item por peso', valor: 'R$ 13,97', detalhe: '0,350 kg × R$ 39,90/kg' },
      ],
      totais: [
        { rotulo: 'Subtotal', valor: 'R$ 63,77' },
        { rotulo: 'TOTAL', valor: 'R$ 63,77', forte: true },
      ],
      extras: [{ rotulo: 'Pagamento', valor: 'Dinheiro' }],
    }, { largura, auto, loja_nome: loja?.nome || 'Sua loja', rodape });
  }

  if (!loja) return <Skeleton className="h-72" />;

  return (
    <form onSubmit={salvar} className="space-y-4">
      <Card>
        <CardContent className="p-5 space-y-5">
          <div className="flex items-center gap-2">
            <Printer className="size-4 text-primary" />
            <span className="font-bold text-sm">Impressora térmica</span>
          </div>

          {/* Largura do papel */}
          <div>
            <Label>Largura do papel</Label>
            <div className="mt-1.5 flex gap-2">
              {([['80', '80mm (padrão)'], ['58', '58mm (compacta)']] as const).map(([v, txt]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setLargura(v)}
                  className={cn(
                    'flex-1 rounded-xl border-2 px-3 py-2.5 text-sm font-semibold transition-colors',
                    largura === v ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-primary/40',
                  )}
                >
                  {txt}
                </button>
              ))}
            </div>
          </div>

          {/* Auto imprimir */}
          <button
            type="button"
            onClick={() => setAuto(v => !v)}
            className="flex w-full items-center gap-3 text-left"
          >
            <div className={cn('relative h-6 w-11 rounded-full transition-colors shrink-0', auto ? 'bg-primary' : 'bg-muted-foreground/30')}>
              <span className={cn('absolute top-0.5 size-5 rounded-full bg-white shadow transition-all', auto ? 'left-[22px]' : 'left-0.5')} />
            </div>
            <div>
              <div className="text-sm font-semibold">Imprimir automático ao finalizar</div>
              <p className="text-xs text-muted-foreground">Dispara o cupom assim que a venda do PDV é concluída.</p>
            </div>
          </button>

          {/* Rodapé */}
          <div>
            <Label>Mensagem no rodapé do cupom</Label>
            <textarea
              value={rodape}
              onChange={e => setRodape(e.target.value)}
              rows={2}
              maxLength={160}
              placeholder="Ex.: Obrigado pela preferência! Volte sempre 😊"
              className="mt-1 w-full px-3 py-2 rounded-lg border border-input bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={enviando}>
              <Save className="size-3.5" /> {enviando ? 'Salvando…' : 'Salvar'}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={imprimirTeste}>
              <Printer className="size-3.5" /> Imprimir cupom de teste
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Impressão direta via NOSSO Agente (preferido) */}
      <Card>
        <CardContent className="p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Printer className="size-4 text-primary" />
            <span className="font-bold text-sm">Software de Impressão</span>
            {agEstado === 'ok'
              ? <span className="rounded-full bg-green-500/15 text-green-600 px-2 py-0.5 text-[10px] font-bold">ativo</span>
              : agEstado === 'off'
                ? <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">não detectado</span>
                : null}
          </div>
          <p className="text-xs text-muted-foreground">
            Instale o <strong>Software de Impressão</strong> e mantenha-o aberto no computador do caixa.
            O cupom será enviado direto para a impressora térmica.
          </p>

          {agEstado === 'ok' && agSelecionada && (
            <div className="rounded-xl border border-green-500/40 bg-green-500/5 p-3 text-sm">
              Impressora detectada: <strong>{agSelecionada}</strong>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" onClick={conectarAgente} disabled={agEstado === 'buscando'}>
              <RefreshCw className={cn('size-3.5', agEstado === 'buscando' && 'animate-spin')} />
              {agEstado === 'buscando' ? 'Procurando…' : 'Procurar impressoras'}
            </Button>
            {agEstado === 'ok' && (
              <Button type="button" size="sm" variant="outline" onClick={() => window.open(URL_EDITOR_FISCAL, '_blank')}>
                <FileText className="size-3.5" /> Editar cupom fiscal
              </Button>
            )}
          </div>

          {agImpressoras.length > 0 && (
            <div className="grid gap-1.5">
              {agImpressoras.map(nome => (
                <button key={nome} type="button" onClick={() => escolherAgente(nome)}
                  className={cn('flex items-center justify-between rounded-lg border px-3 py-2 text-sm text-left transition-colors',
                    agSelecionada === nome ? 'border-primary bg-primary/10 text-primary font-semibold' : 'border-border hover:border-primary/40')}>
                  <span className="truncate">{nome}</span>
                  {agSelecionada === nome && <CheckCircle2 className="size-4 shrink-0" />}
                </button>
              ))}
            </div>
          )}

          {agEstado === 'off' && (
            <p className="text-xs text-amber-600">
              Nenhum software encontrado. Faça o download e instale o Software de Impressão no computador do caixa e clique em <strong>Procurar</strong>.
            </p>
          )}
        </CardContent>
      </Card>

    </form>
  );
}
