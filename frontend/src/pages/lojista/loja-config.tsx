import { useEffect, useState } from 'react';
import { Settings, Save, Power, Clock, Zap, Bike, Plus, Trash2, MapPin, CreditCard, Eye, EyeOff, CheckCircle2, XCircle, Link2, Wand2, Printer, RefreshCw, FileText, Download, Globe, ExternalLink, Copy, Check, FlaskConical, Rocket, ShieldCheck, Search, AlertCircle, ChevronDown, X } from 'lucide-react';
import { imprimirCupom, configImpressao } from '@/lib/impressao';
import { statusAgente, esquecerStatusAgente, listarImpressorasAgente, impressoraAgente, definirImpressoraAgente, impressoraSetor, definirImpressoraSetor, URL_EDITOR_FISCAL, VERSAO_INSTALADOR, URL_INSTALADOR } from '@/lib/agente';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';
import { api, ApiError, encerrarSessao } from '@/lib/api';
import { cn } from '@/lib/utils';
import { brl, dataLocal, tempoRelativo } from '@/lib/format';
import { buscarCep, formatarCep, cepDigitos } from '@/lib/cep';
import { AreasEntrega } from './areas-entrega';
import type { DiaHorario, Loja } from '@/types';

export function LojaConfiguracao() {
  const { mostrar } = useToast();
  const [loja, setLoja] = useState<Loja | null>(null);
  const [form, setForm] = useState({
    nome: '', descricao: '', categoria: '', endereco: '',
    taxa_entrega: '', tempo_estimado_min: '', horario_funcionamento: '', minimo_pedido: '',
    slug: '', dominio_personalizado: '',
  });
  const [enviando, setEnviando] = useState(false);
  const [alternando, setAlternando] = useState(false);
  // CEP não é salvo na loja: serve só pra montar o endereço (é o endereço que o
  // backend geocodifica). Guardar o CEP sem uso só criaria dois campos pra manter
  // em sincronia.
  const [cep, setCep] = useState('');
  const [buscandoCep, setBuscandoCep] = useState(false);

  /**
   * Monta o endereço a partir do CEP. Preserva o NÚMERO que o lojista já tenha
   * digitado — o ViaCEP não devolve número, e sobrescrever cegamente apagaria o
   * dado mais importante pra geocodificação achar o ponto certo.
   */
  async function puxarCep() {
    const d = cepDigitos(cep);
    if (d.length !== 8) { mostrar({ tipo: 'erro', titulo: 'CEP incompleto.' }); return; }
    setBuscandoCep(true);
    try {
      const e = await buscarCep(d);
      if (!e) { mostrar({ tipo: 'erro', titulo: 'CEP não encontrado.' }); return; }
      const numero = (form.endereco.match(/\b\d{1,6}\b/) || [])[0] || '';
      const partes = [
        [e.rua, numero].filter(Boolean).join(', '),
        e.bairro,
        [e.cidade, e.uf].filter(Boolean).join(' - '),
      ].filter(Boolean);
      setForm(f => ({ ...f, endereco: partes.join(', ') }));
      mostrar({
        tipo: 'sucesso',
        titulo: 'Endereço preenchido!',
        descricao: numero ? undefined : 'Complete o número e salve.',
      });
    } finally {
      setBuscandoCep(false);
    }
  }

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
        dominio_personalizado: (l as any).dominio_personalizado || '',
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
        dominio_personalizado: form.dominio_personalizado.trim() || null,
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

            {/*
              CEP primeiro, endereço depois: é a ordem em que se digita, e o CEP
              resolve rua/bairro/cidade/UF sozinho. Importa mais do que parece —
              o endereço é o que localiza a loja no mapa (geocodificação), e é
              dele que saem o marcador em Áreas de entrega e o cálculo por km.
              Endereço abreviado ou sem cidade não é encontrado, e a loja fica
              sem coordenada.
            */}
            <div>
              <Label>CEP</Label>
              <div className="flex gap-2 mt-1">
                <Input
                  value={cep}
                  onChange={e => setCep(formatarCep(e.target.value))}
                  onBlur={() => { if (cepDigitos(cep).length === 8) puxarCep(); }}
                  placeholder="00000-000"
                  inputMode="numeric"
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={puxarCep}
                  disabled={buscandoCep || cepDigitos(cep).length !== 8}
                >
                  {buscandoCep ? '…' : <><Search className="size-4" /> Buscar</>}
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">
                Preenche o endereço automaticamente. Depois só complete o número.
              </p>
            </div>

            <div>
              <Label>Endereço</Label>
              <Input value={form.endereco} onChange={campo('endereco')} placeholder="Rua, número, bairro, cidade - UF" />
              <p className="text-[11px] text-muted-foreground mt-1">
                Com número e cidade — é assim que a loja é localizada no mapa das áreas de entrega.
              </p>
            </div>

            <div className="sm:col-span-2">
              <Label className="flex items-center gap-1.5">
                <Link2 className="size-3.5" /> URL amigável (slug)
              </Label>
              <div className="flex gap-2 mt-1">
                <div className="relative flex-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none select-none">
                    /
                  </span>
                  <Input
                    value={form.slug}
                    onChange={e => setForm(f => ({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') }))}
                    placeholder="minha-loja"
                    className="pl-6 font-mono text-sm"
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
                  <span className="font-mono">{window.location.origin}/{form.slug}</span>
                </p>
              )}
              {!form.slug && (
                <p className="text-[11px] text-muted-foreground mt-1">Opcional. Permite acessar via URL amigável em vez de /123.</p>
              )}
            </div>

            <div className="sm:col-span-2">
              <Label className="flex items-center gap-1.5">
                <Globe className="size-3.5" /> Domínio próprio (opcional)
              </Label>
              <Input
                value={form.dominio_personalizado}
                onChange={e => setForm(f => ({ ...f, dominio_personalizado: e.target.value }))}
                placeholder="suaempresa.com.br"
                className="mt-1 font-mono text-sm"
                maxLength={200}
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Alternativa ao link acima: se você tem o próprio domínio, aponte o DNS dele (registro CNAME ou A) pro
                servidor da plataforma e cole aqui <b>sem</b> "https://" nem barras. Quando alguém acessar esse domínio,
                cai direto na sua loja — sem precisar do endereço padrão. Deixe em branco se for usar só o link de cima.
              </p>
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

      {/* Áreas desenhadas no mapa — precedência sobre a taxa por bairro acima
          (ver resolverFrete em src/backend/frete.ts). */}
      <div className="pt-2">
        <AreasEntrega taxaPadrao={taxaPadrao} />
      </div>
    </div>
  );
}

/* ───────────────────────── Entregadores (motoboys) ─────────────────────── */

interface EntregadorCadastro {
  id: number; nome: string; email: string; telefone: string; bloqueado: 0 | 1;
}

export function EntregadoresLoja() {
  const { mostrar } = useToast();
  const [lista, setLista] = useState<EntregadorCadastro[]>([]);
  const [carregado, setCarregado] = useState(false);
  const [nome, setNome] = useState('');
  const [telefone, setTelefone] = useState('');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [enviando, setEnviando] = useState(false);

  function carregar() {
    api<{ entregadores: EntregadorCadastro[] }>('GET', '/api/lojista/entregadores/cadastro')
      .then(r => { setLista(r.entregadores); setCarregado(true); })
      .catch(() => mostrar({ tipo: 'erro', titulo: 'Não foi possível carregar os entregadores.' }));
  }

  useEffect(() => { carregar(); }, []);

  async function cadastrar() {
    if (!nome.trim() || !email.trim() || senha.length < 6) return;
    setEnviando(true);
    try {
      await api('POST', '/api/lojista/entregadores/cadastro', {
        nome: nome.trim(), telefone: telefone.trim(), email: email.trim(), senha,
      });
      setNome(''); setTelefone(''); setEmail(''); setSenha('');
      mostrar({ tipo: 'sucesso', titulo: 'Entregador cadastrado!' });
      carregar();
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally {
      setEnviando(false);
    }
  }

  async function alternarBloqueio(e: EntregadorCadastro) {
    try {
      await api('PUT', `/api/lojista/entregadores/cadastro/${e.id}`, { bloqueado: !e.bloqueado });
      setLista(l => l.map(x => x.id === e.id ? { ...x, bloqueado: e.bloqueado ? 0 : 1 } : x));
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
            <span className="font-bold">Entregadores</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Cadastre o login dos seus motoboys aqui. Eles entram em <strong>/entregador</strong> com o
            e-mail e a senha definidos abaixo, pra ver e aceitar as entregas prontas desta loja.
          </p>
        </CardContent>
      </Card>

      {/* Cadastrar novo entregador */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <Label className="mb-0 block">Cadastrar entregador</Label>
          <div className="grid gap-2 sm:grid-cols-2">
            <Input placeholder="Nome" value={nome} onChange={e => setNome(e.target.value)} className="h-10" />
            <Input placeholder="Telefone" value={telefone} onChange={e => setTelefone(e.target.value)} className="h-10" />
            <Input placeholder="E-mail (login)" type="email" value={email} onChange={e => setEmail(e.target.value)} className="h-10" />
            <Input placeholder="Senha (mín. 6 caracteres)" type="password" value={senha} onChange={e => setSenha(e.target.value)} className="h-10" />
          </div>
          <Button
            onClick={cadastrar}
            disabled={enviando || !nome.trim() || !email.trim() || senha.length < 6}
          >
            <Plus className="size-4" /> Cadastrar entregador
          </Button>
        </CardContent>
      </Card>

      {/* Lista */}
      <Card>
        <CardContent className="p-3">
          {lista.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              Nenhum entregador cadastrado ainda.
            </p>
          ) : (
            <div className="divide-y divide-border/60">
              {lista.map(e => (
                <div key={e.id} className="flex items-center gap-3 py-2.5 px-1">
                  <Bike className="size-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{e.nome}</p>
                    <p className="text-[11px] text-muted-foreground truncate">{e.email} {e.telefone && `· ${e.telefone}`}</p>
                  </div>
                  <button
                    onClick={() => alternarBloqueio(e)}
                    className={cn(
                      'shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold transition-colors',
                      e.bloqueado
                        ? 'bg-muted text-muted-foreground hover:bg-destructive/10 hover:text-destructive'
                        : 'bg-green-500/15 text-green-600 hover:bg-amber-500/15 hover:text-amber-600',
                    )}
                  >
                    {e.bloqueado ? 'bloqueado' : 'ativo'}
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

interface EstadoPagamentos {
  /** Gateway do Pix online: Mercado Pago ou Pix via ONZ/Planner. */
  gateway: 'mercadopago' | 'onz';
  /** O Pix ONZ está utilizável (conta desta loja ou, na falta, da plataforma)? */
  onz_disponivel: boolean;
  /** Esta loja tem conta ONZ PRÓPRIA (dinheiro cai direto nela)? */
  onz_conta_propria: boolean;
  onz_client_id_mascarado: string | null;
  /** Client ID inteiro — identificador, não segredo (o secret nunca volta). */
  onz_client_id: string;
  /** Loja tem conta PRÓPRIA de Mercado Pago no modo ATIVO (recebedor do cartão). */
  cartao_online_ativo: boolean;
  onz_pix_key: string;
  /** Datas do 1º e do último pedido pago online — alimentam a linha do banner. */
  primeiro_pagamento_em: string | null;
  ultimo_pagamento_em: string | null;
  /** Esta loja já colou a assinatura secreta do webhook dela? */
  webhook_secret_configurado: boolean;
  /** Public key da loja — vai pro navegador montar o formulário de cartão. */
  public_key: string;
  /** URL do webhook JÁ com ?t=<banco>&loja=<id> — a nua não identifica a loja. */
  webhook_url: string;
  /** Recado do servidor (ex.: salvou mas não registrou a confirmação automática). */
  aviso?: string;
  modo: 'teste' | 'producao';
  ativo: boolean;
  token_teste_mascarado: string | null;
  token_producao_mascarado: string | null;
}

/**
 * Mostra as pontas e come o miolo (`crist•••••@gmail.com`).
 *
 * Por que as PONTAS e não os últimos dígitos: o lojista usa isso pra responder
 * "é essa credencial mesmo?", e quem reconhece uma credencial reconhece pelo
 * começo. O miolo é o que identificaria a conta pra quem estivesse olhando de
 * fora — e é exatamente ele que some.
 */
function mascararMeio(valor: string, inicio = 5, fim = 6): string {
  if (!valor) return '';
  if (valor.length <= inicio + fim) return '•'.repeat(Math.max(valor.length, 8));
  return `${valor.slice(0, inicio)}${'•'.repeat(8)}${valor.slice(-fim)}`;
}

/**
 * Linha de credencial já conectada: rótulo à esquerda, valor mascarado à direita.
 *
 * `jaMascarado` é pra valor que o SERVIDOR já entregou mascarado (os tokens do
 * Mercado Pago). Mascarar de novo produziria um valor que não existe — o lojista
 * compararia com o token dele e concluiria que salvamos errado.
 */
function LinhaCredencial({ rotulo, valor, revelavel = false, nunca = false, jaMascarado = false }: {
  rotulo: string; valor: string; revelavel?: boolean; nunca?: boolean; jaMascarado?: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  return (
    <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
      <span className="shrink-0 text-xs text-muted-foreground">{rotulo}</span>
      <div className="flex min-w-0 items-center gap-1.5">
        <code className="truncate font-mono text-xs text-foreground">
          {nunca ? '••••••••••••' : (jaMascarado || aberto ? valor : mascararMeio(valor))}
        </code>
        {revelavel && !nunca && (
          <button
            type="button"
            onClick={() => setAberto(v => !v)}
            title={aberto ? 'Ocultar' : 'Revelar'}
            className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
          >
            {aberto ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
          </button>
        )}
      </div>
    </div>
  );
}

/** Passo numerado do "onde pegar as credenciais". */
function Passo({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-bold text-primary">
        {n}
      </span>
      <span className="text-xs leading-relaxed text-muted-foreground">{children}</span>
    </li>
  );
}

export function PagamentosLoja() {
  const { mostrar } = useToast();
  const [estado, setEstado] = useState<EstadoPagamentos | null>(null);
  const [tokenTeste, setTokenTeste] = useState('');
  const [tokenProducao, setTokenProducao] = useState('');
  const [onzId, setOnzId] = useState('');
  const [onzSecret, setOnzSecret] = useState('');
  const [onzChave, setOnzChave] = useState('');
  const [mostrarTeste, setMostrarTeste] = useState(false);
  const [mostrarProducao, setMostrarProducao] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [urlWebhookCopiada, setUrlWebhookCopiada] = useState(false);
  const [webhookSecret, setWebhookSecret] = useState('');
  const [publicKey, setPublicKey] = useState('');
  const [testando, setTestando] = useState(false);
  /*
   * FORMULÁRIO FECHADO POR PADRÃO quando já há credencial conectada.
   *
   * A tela de pagamentos é visitada quase sempre pra CONFERIR ("o Pix tá certo?"),
   * quase nunca pra trocar. Um formulário aberto de campos vazios por cima de uma
   * conta que funciona convida a apagar o que estava certo — e o secret, uma vez
   * salvo, não volta pra ser recolado.
   */
  const [editandoCred, setEditandoCred] = useState(false);
  /*
   * ABA PADRÃO: Pix. É o meio que praticamente toda loja usa, e cartão é opcional
   * — abrir no que a maioria veio ver poupa um clique de quase todo mundo.
   */
  const [aba, setAba] = useState<'pix' | 'cartao'>('pix');
  const [webhookAberto, setWebhookAberto] = useState(false);

  // A URL vem PRONTA do servidor, com ?t=<banco>&loja=<id>: só ele sabe o nome
  // do banco do tenant, e sem esses dois a notificação chega sem dizer de quem é.
  const urlWebhook = estado?.webhook_url ?? '';

  function carregar() {
    api<EstadoPagamentos>('GET', '/api/lojista/pagamentos')
      .then(setEstado)
      .catch(() => mostrar({ tipo: 'erro', titulo: 'Não foi possível carregar configurações de pagamento.' }));
  }

  useEffect(() => { carregar(); }, []);

  /** Devolve `true` só quando salvou — quem chamou usa isso pra fechar o formulário. */
  async function enviar(corpo: Record<string, string>, mensagemSucesso: string): Promise<boolean> {
    setEnviando(true);
    try {
      const r = await api<EstadoPagamentos>('PUT', '/api/lojista/pagamentos', corpo);
      setEstado(r);
      setTokenTeste('');
      setTokenProducao('');
      setOnzId('');
      setOnzSecret('');
      // O servidor pode salvar e ainda assim avisar (ex.: não registrou a
      // confirmação automática) — nesse caso mostramos o aviso, não "sucesso".
      if (r.aviso) mostrar({ tipo: 'erro', titulo: r.aviso });
      else mostrar({ tipo: 'sucesso', titulo: mensagemSucesso });
      return true;
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
      return false;
    } finally {
      setEnviando(false);
    }
  }

  /**
   * Pergunta ao gateway se a credencial vale — de verdade, agora.
   *
   * O servidor faz uma consulta idempotente na conta do lojista e devolve DE QUEM
   * ela é. Esse é o ponto: token inválido dá erro na hora do pagamento e a gente
   * descobre; token válido da conta errada não dá erro nenhum — o dinheiro
   * simplesmente cai no lugar errado, e ninguém percebe até o fim do mês.
   */
  async function testarConexao() {
    setTestando(true);
    try {
      const r = await api<{ ok: boolean; detalhe: string }>('POST', '/api/lojista/pagamentos/testar');
      mostrar({
        tipo: r.ok ? 'sucesso' : 'erro',
        titulo: r.ok ? 'Conexão testada' : 'Não consegui conectar',
        descricao: r.detalhe,
      });
    } catch (err) {
      mostrar({
        tipo: 'erro',
        titulo: err instanceof ApiError ? err.message : 'Não consegui falar com o servidor.',
      });
    } finally {
      setTestando(false);
    }
  }

  async function salvarTokens(e: React.FormEvent) {
    e.preventDefault();
    const corpo: Record<string, string> = {};
    if (tokenTeste.trim()) corpo.token_teste = tokenTeste.trim();
    if (tokenProducao.trim()) corpo.token_producao = tokenProducao.trim();
    if (publicKey.trim() && publicKey.trim() !== estado?.public_key) corpo.mercadopago_public_key = publicKey.trim();
    if (Object.keys(corpo).length === 0) return;
    if (!(await enviar(corpo, 'Token salvo!'))) return;
    setEditandoCred(false);
    await testarConexao();
  }

  function trocarModo(modo: 'teste' | 'producao') {
    if (!estado || estado.modo === modo) return;
    enviar({ modo }, modo === 'teste' ? 'Modo teste ativado.' : 'Modo produção ativado.');
  }

  function trocarGateway(gateway: 'mercadopago' | 'onz') {
    if (!estado || estado.gateway === gateway) return;
    enviar({ gateway }, gateway === 'onz' ? 'Pix via Planner ativado.' : 'Sua conta do Mercado Pago ativada.');
  }

  async function salvarOnz(e: React.FormEvent) {
    e.preventDefault();
    const corpo: Record<string, string> = {};
    if (onzId.trim()) corpo.onz_client_id = onzId.trim();
    if (onzSecret.trim()) corpo.onz_client_secret = onzSecret.trim();
    if (onzChave.trim()) corpo.onz_pix_key = onzChave.trim();
    if (Object.keys(corpo).length === 0) return;
    const salvou = await enviar(corpo, 'Conta Planner conectada! A confirmação automática de pagamento já está ativa.');
    if (!salvou) return;
    setEditandoCred(false);
    // Testa logo depois de salvar: "Conectar e testar" promete as duas coisas, e
    // é aqui que um secret colado errado ainda pode ser corrigido de cabeça
    // quente — daqui a uma semana ninguém lembra mais onde pegou.
    await testarConexao();
  }

  async function salvarWebhookSecret(e: React.FormEvent) {
    e.preventDefault();
    const v = webhookSecret.trim();
    if (!v) return;
    if (await enviar({ mercadopago_webhook_secret: v }, 'Assinatura salva — as notificações passam a ser verificadas.')) {
      // Some da tela assim que salva: volta do servidor só como "configurada",
      // e segredo em claro na tela é convite pra ser lido por cima do ombro.
      setWebhookSecret('');
    }
  }

  function removerWebhookSecret() {
    setWebhookSecret('');
    enviar({ mercadopago_webhook_secret: '' }, 'Assinatura removida.');
  }

  function removerOnz() {
    setOnzChave('');
    enviar({ onz_client_id: '', onz_client_secret: '', onz_pix_key: '' }, 'Credenciais da conta Planner removidas.');
  }

  function removerToken(campo: 'token_teste' | 'token_producao') {
    enviar({ [campo]: '' }, 'Token removido.');
  }

  async function copiarUrlWebhook() {
    try {
      await navigator.clipboard.writeText(urlWebhook);
      setUrlWebhookCopiada(true);
      setTimeout(() => setUrlWebhookCopiada(false), 2000);
    } catch {
      mostrar({ tipo: 'erro', titulo: 'Não consegui copiar — selecione o texto manualmente.' });
    }
  }

  if (!estado) return <Skeleton className="h-64" />;
  const { modo, ativo, gateway, onz_disponivel } = estado;
  const viaOnz = gateway === 'onz';
  /** Token (mascarado) do modo que está VALENDO — é o que define se há credencial. */
  const tokenMpDoModo = modo === 'teste' ? estado.token_teste_mascarado : estado.token_producao_mascarado;
  /*
   * A MESMA CONTA COBRE OS DOIS quando o Pix não vai pela Planner. É o fato que
   * mais confunde nesta tela: as abas separam Pix e cartão, mas o token e o modo
   * são um só. Em vez de esconder isso, cada aba avisa — e os controles moram
   * num lugar só, na aba Cartão, pra não existirem dois botões pro mesmo campo.
   */
  const contaCompartilhada = !viaOnz;

  return (
    <div className="mx-auto max-w-[720px] space-y-4">
      <div>
        <h2 className="text-lg font-bold">Pagamentos</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          O dinheiro cai direto na sua conta — a plataforma não fica no meio.
        </p>
      </div>

      {/*
        ABAS EM FORMATO DE CARD, cada uma carregando o próprio status.

        O status fica NA aba de propósito: Pix e cartão podem estar em estados
        diferentes (Pix ativo pela Planner, cartão sem conta), e o lojista precisa
        ver os dois sem ter que clicar pra descobrir.
      */}
      <div className="flex gap-3 max-sm:flex-col">
        {([
          {
            id: 'pix' as const,
            titulo: 'Pix',
            Icone: Zap,
            ok: ativo,
            status: ativo ? `Ativo · ${viaOnz ? 'Planner' : 'Mercado Pago'}` : 'Não configurado',
          },
          {
            id: 'cartao' as const,
            titulo: 'Cartão de crédito',
            Icone: CreditCard,
            // Em modo teste o cartão até funciona, mas não recebe dinheiro de
            // verdade — por isso "ok" aqui é só produção com token salvo.
            ok: estado.cartao_online_ativo && modo === 'producao',
            status: !estado.cartao_online_ativo
              ? 'Não configurado'
              : `${modo === 'teste' ? 'Modo teste' : 'Produção'} · Mercado Pago`,
          },
        ]).map(a => {
          const atual = aba === a.id;
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => setAba(a.id)}
              aria-current={atual}
              className={cn(
                'flex flex-1 items-center gap-3 rounded-2xl border-2 p-4 text-left transition-colors',
                atual ? 'border-primary bg-card' : 'border-border bg-muted/40 hover:border-primary/40',
              )}
            >
              <a.Icone className={cn('size-5 shrink-0', atual ? 'text-primary' : 'text-muted-foreground')} />
              <span className="min-w-0">
                <span className="block text-sm font-bold">{a.titulo}</span>
                <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className={cn('size-1.5 shrink-0 rounded-full',
                    a.ok ? 'bg-emerald-600' : 'bg-amber-500')} />
                  {a.status}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {/* ─────────────────────────── ABA PIX ─────────────────────────── */}
      {aba === 'pix' && (<>
        <Card className={ativo ? 'border-emerald-600/25 bg-emerald-50/70 dark:bg-emerald-500/10' : undefined}>
          <CardContent className="flex flex-wrap items-center gap-4 p-5">
            <div className={cn('flex size-11 shrink-0 items-center justify-center rounded-2xl',
              ativo ? 'bg-emerald-600/10' : 'bg-muted')}>
              {ativo
                ? <CheckCircle2 className="size-5 text-emerald-700 dark:text-emerald-400" />
                : <XCircle className="size-5 text-muted-foreground" />}
            </div>
            <div className="min-w-[12rem] flex-1">
              <p className="font-bold">
                {ativo ? `Pix ativo pela ${viaOnz ? 'Planner' : 'sua conta do Mercado Pago'}` : 'Pix não configurado'}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {ativo
                  ? (estado.ultimo_pagamento_em
                      /* Não atribui os pagamentos a um provedor: as datas vêm de
                         TODOS os pedidos pagos, cartão incluído. */
                      ? `Recebendo pagamentos online${estado.primeiro_pagamento_em ? ` desde ${dataLocal(estado.primeiro_pagamento_em)}` : ''} · último ${tempoRelativo(estado.ultimo_pagamento_em)}`
                      : 'Tudo pronto — nenhum pagamento online ainda.')
                  : 'Conecte uma conta abaixo para aceitar Pix.'}
                {ativo && viaOnz && !estado.onz_conta_propria && (
                  <> — hoje pela conta da plataforma. Conecte a sua abaixo pra receber direto.</>
                )}
              </p>
            </div>
            {ativo && (
              <Button
                type="button" variant="outline" size="sm" disabled={testando} onClick={testarConexao}
                className="shrink-0 border-emerald-600/40 text-emerald-800 hover:bg-emerald-600/10 dark:text-emerald-400"
              >
                <RefreshCw className={cn('size-3.5', testando && 'animate-spin')} />
                {testando ? 'Testando…' : 'Testar conexão'}
              </Button>
            )}
          </CardContent>
        </Card>

        {onz_disponivel && (
          <Card>
            <CardContent className="space-y-3 p-5">
              <div className="flex items-center gap-2">
                <Zap className="size-4 text-primary" />
                <span className="text-sm font-bold">Por onde o Pix entra</span>
              </div>
              {/*
                RADIO VISÍVEL, não só a borda colorida. Dois cards em que só a cor
                da borda muda são lidos como dois botões, e "qual dos dois está
                ligado agora?" vira adivinhação — numa tela em que a resposta
                errada manda o dinheiro pra outra conta.
              */}
              <div className="grid gap-2 sm:grid-cols-2">
                {([
                  ['onz', 'Minha conta Planner', 'O dinheiro cai direto na sua conta Planner. Exige conta aberta e credenciais abaixo.', true],
                  ['mercadopago', 'Minha conta do Mercado Pago', 'Usa a mesma conta do cartão — o token fica na aba Cartão.', false],
                ] as const).map(([valor, titulo, descricao, recomendado]) => {
                  const marcado = valor === 'onz' ? viaOnz : !viaOnz;
                  return (
                    <button
                      key={valor}
                      type="button" role="radio" aria-checked={marcado}
                      disabled={enviando} onClick={() => trocarGateway(valor)}
                      className={cn('flex gap-3 rounded-2xl border-2 p-3.5 text-left transition-colors',
                        marcado ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40')}
                    >
                      <span className={cn('mt-0.5 flex size-[19px] shrink-0 items-center justify-center rounded-full border-2 transition-colors',
                        marcado ? 'border-primary' : 'border-muted-foreground/40')}>
                        {marcado && <span className="size-2.5 rounded-full bg-primary" />}
                      </span>
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className="text-sm font-bold">{titulo}</span>
                          {recomendado && (
                            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
                              recomendado
                            </span>
                          )}
                        </span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">{descricao}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Credenciais da Planner — só quando é ela que recebe o Pix */}
        {viaOnz ? (
          estado.onz_conta_propria && !editandoCred ? (
            /* ── CONECTADA: só o resumo. Nada de formulário por cima do que funciona. ── */
            <Card>
              <CardContent className="space-y-3 p-5">
                <div className="flex items-center gap-2">
                  <span className="size-2 rounded-full bg-emerald-600" />
                  <span className="text-sm font-bold">Credenciais da Planner</span>
                  <span className="text-xs text-muted-foreground">Conectada</span>
                </div>
                <div className="divide-y divide-border rounded-xl border border-border">
                  {estado.onz_client_id
                    ? <LinhaCredencial rotulo="Client ID" valor={estado.onz_client_id} revelavel />
                    : <LinhaCredencial rotulo="Client ID" valor={estado.onz_client_id_mascarado || ''} jaMascarado />}
                  <LinhaCredencial rotulo="Client Secret" valor="" nunca />
                  <LinhaCredencial rotulo="Chave Pix" valor={estado.onz_pix_key} />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => setEditandoCred(true)}>
                    Trocar credenciais
                  </Button>
                  <Button type="button" variant="ghost" size="sm" disabled={enviando} onClick={removerOnz}
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive">
                    Remover
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            /* ── EDITANDO / nunca conectou ── */
            <Card>
              <CardContent className="space-y-4 p-5">
                <div className="flex items-center gap-2">
                  <Zap className="size-4 text-primary" />
                  <span className="text-sm font-bold">Credenciais da Planner</span>
                </div>

                <div className="rounded-xl border border-border bg-muted/40 p-3.5">
                  <p className="mb-2.5 text-xs font-bold">Onde pegar as credenciais</p>
                  <ol className="space-y-2">
                    <Passo n={1}>
                      Abra sua conta na Planner e entre no portal Finance{' '}
                      <a href="https://finance.planner.com.br" target="_blank" rel="noreferrer"
                        className="inline-flex items-center gap-0.5 font-semibold text-primary hover:underline">
                        Abrir portal <ExternalLink className="size-3" />
                      </a>
                    </Passo>
                    <Passo n={2}><b>Configurações → API QRCODES → Gerar Credenciais</b></Passo>
                    <Passo n={3}>Cole aqui — o secret aparece uma única vez</Passo>
                  </ol>
                </div>

                <form onSubmit={salvarOnz} className="space-y-3">
                  <div>
                    <Label htmlFor="onz_id">Client ID</Label>
                    <Input id="onz_id" value={onzId} maxLength={120} autoComplete="off"
                      placeholder={estado.onz_client_id_mascarado || 'Cole o Client ID do portal'}
                      onChange={e => setOnzId(e.target.value)} className="h-[46px] font-mono text-sm" />
                  </div>
                  <div>
                    <Label htmlFor="onz_secret">Client Secret</Label>
                    <Input id="onz_secret" type="password" value={onzSecret} maxLength={200} autoComplete="off"
                      placeholder={estado.onz_conta_propria ? '•••••••• (já configurado)' : 'Cole o Client Secret'}
                      onChange={e => setOnzSecret(e.target.value)} className="h-[46px] font-mono text-sm" />
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Guardado criptografado — nunca aparece de novo depois de salvar.
                    </p>
                  </div>
                  <div>
                    <Label htmlFor="onz_chave">Chave Pix da conta</Label>
                    <Input id="onz_chave" value={onzChave || estado.onz_pix_key} maxLength={80} autoComplete="off"
                      placeholder="A chave que aparece junto das credenciais"
                      onChange={e => setOnzChave(e.target.value)} className="h-[46px] font-mono text-sm" />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button type="submit" size="sm" disabled={enviando || (!onzId.trim() && !onzSecret.trim() && !onzChave.trim())}>
                      <Save className="size-3.5" />
                      {enviando ? 'Salvando…' : 'Conectar e testar'}
                    </Button>
                    {estado.onz_conta_propria && (
                      <Button type="button" variant="outline" size="sm"
                        onClick={() => { setEditandoCred(false); setOnzId(''); setOnzSecret(''); setOnzChave(''); }}>
                        Cancelar
                      </Button>
                    )}
                  </div>
                </form>
              </CardContent>
            </Card>
          )
        ) : (
          /*
            Pix pelo Mercado Pago: as credenciais são as MESMAS do cartão. Repetir
            o formulário aqui criaria dois lugares gravando o mesmo campo — que é
            exatamente o problema que estas abas vieram resolver. Manda pra lá.
          */
          <Card className="border-dashed">
            <CardContent className="flex flex-wrap items-center gap-3 p-5">
              <CreditCard className="size-4 shrink-0 text-primary" />
              <p className="min-w-[14rem] flex-1 text-xs text-muted-foreground">
                O Pix desta loja entra pela sua <b>conta do Mercado Pago</b> — a mesma do cartão.
                O token e o modo (teste/produção) ficam na aba Cartão, num lugar só.
              </p>
              <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={() => setAba('cartao')}>
                Ver na aba Cartão
              </Button>
            </CardContent>
          </Card>
        )}
      </>)}

      {/* ────────────────────────── ABA CARTÃO ────────────────────────── */}
      {aba === 'cartao' && (<>
        {estado.cartao_online_ativo && modo === 'teste' && (
          <Card className="border-amber-300/60 bg-amber-50/70 dark:border-amber-500/30 dark:bg-amber-500/10">
            <CardContent className="flex items-start gap-3 p-4">
              <AlertCircle className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-400" />
              <div>
                <p className="text-sm font-bold text-amber-900 dark:text-amber-300">
                  Modo teste — pagamentos não são reais
                </p>
                <p className="mt-0.5 text-xs text-amber-800/90 dark:text-amber-400/90">
                  Salve o token de produção e mude a chave abaixo pra receber de verdade.
                  {contaCompartilhada && <> Isto vale também para o <b>Pix</b>, que entra por esta mesma conta.</>}
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="space-y-4 p-5">
            <div className="flex flex-wrap items-center gap-2">
              {estado.cartao_online_ativo && <span className="size-2 rounded-full bg-emerald-600" />}
              <span className="text-sm font-bold">Conta do Mercado Pago</span>
              {estado.cartao_online_ativo && <span className="text-xs text-muted-foreground">Conectada</span>}
              {contaCompartilhada && (
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
                  Recebe: Pix e cartão
                </span>
              )}
            </div>

            <p className="text-xs text-muted-foreground">
              O cartão é sempre pelo Mercado Pago, independente de como o Pix entra.
              Pegue o token em <b>Seu negócio → Configurações → Gestão e administração → Credenciais</b>.{' '}
              <a href="https://www.mercadopago.com.br/developers/panel/app" target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-0.5 font-semibold text-primary hover:underline">
                Abrir painel <ExternalLink className="size-3" />
              </a>
            </p>

            {/* Segmented: qual dos dois tokens está valendo */}
            <div>
              <p className="mb-1.5 text-xs font-semibold">Qual token está valendo agora?</p>
              <div className="flex gap-1 rounded-xl bg-muted p-1">
                {([['teste', 'Modo teste', FlaskConical], ['producao', 'Produção', Rocket]] as const).map(([v, txt, Icone]) => (
                  <button
                    key={v} type="button" disabled={enviando} onClick={() => trocarModo(v)}
                    className={cn('flex flex-1 items-center justify-center gap-2 rounded-lg py-2 text-sm font-semibold transition-colors',
                      modo === v ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
                  >
                    <Icone className="size-4" /> {txt}
                  </button>
                ))}
              </div>
              {contaCompartilhada && (
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  Esta chave vale para o cartão <b>e para o Pix</b> — os dois entram por esta conta.
                </p>
              )}
            </div>

            {tokenMpDoModo && !editandoCred ? (
              /* ── CONECTADO: as duas linhas, com "em uso" na que vale ── */
              <>
                <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
                  {([
                    ['teste', 'Token de teste', estado.token_teste_mascarado],
                    ['producao', 'Token de produção', estado.token_producao_mascarado],
                  ] as const).map(([qual, rotulo, valor]) => (
                    <div key={qual} className={cn('flex items-center justify-between gap-3 px-3.5 py-2.5',
                      modo === qual && (qual === 'teste'
                        ? 'bg-amber-50/70 dark:bg-amber-500/10'
                        : 'bg-emerald-50/70 dark:bg-emerald-500/10'))}>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="text-xs text-muted-foreground">{rotulo}</span>
                        {modo === qual && (
                          <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-bold',
                            qual === 'teste'
                              ? 'bg-amber-500/15 text-amber-800 dark:text-amber-400'
                              : 'bg-emerald-600/15 text-emerald-800 dark:text-emerald-400')}>
                            em uso
                          </span>
                        )}
                      </span>
                      <code className="truncate font-mono text-xs">{valor || '— não salvo —'}</code>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => setEditandoCred(true)}>
                    Trocar tokens
                  </Button>
                  <Button type="button" variant="ghost" size="sm" disabled={enviando}
                    onClick={() => removerToken(modo === 'teste' ? 'token_teste' : 'token_producao')}
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive">
                    Remover
                  </Button>
                </div>
              </>
            ) : (
              <form onSubmit={salvarTokens} className="space-y-4">
                <div>
                  <Label className="flex items-center gap-1.5"><FlaskConical className="size-3.5" /> Access Token de teste</Label>
                  <div className="relative mt-1">
                    <input
                      type={mostrarTeste ? 'text' : 'password'}
                      value={tokenTeste}
                      onChange={e => setTokenTeste(e.target.value)}
                      placeholder={estado.token_teste_mascarado || 'TEST-… ou APP_USR-… (conta de teste)'}
                      className="h-[46px] w-full rounded-lg border border-input bg-background px-3 pr-10 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                    <button type="button" onClick={() => setMostrarTeste(v => !v)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                      {mostrarTeste ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                </div>

                <div>
                  <Label className="flex items-center gap-1.5"><Rocket className="size-3.5" /> Access Token de produção</Label>
                  <div className="relative mt-1">
                    <input
                      type={mostrarProducao ? 'text' : 'password'}
                      value={tokenProducao}
                      onChange={e => setTokenProducao(e.target.value)}
                      placeholder={estado.token_producao_mascarado || 'APP_USR-…'}
                      className="h-[46px] w-full rounded-lg border border-input bg-background px-3 pr-10 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                    <button type="button" onClick={() => setMostrarProducao(v => !v)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                      {mostrarProducao ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Guardado criptografado — nunca aparece de novo depois de salvar. É a credencial que
                    autoriza cobranças na sua conta: trate como senha.
                  </p>
                </div>

                {/*
                  PUBLIC KEY: é ela que monta o formulário de cartão DENTRO da
                  loja. Sem ela o cartão não aparece pro cliente, mesmo com o
                  Access Token salvo — por isso o campo fica aqui do lado, e não
                  escondido em outro canto.

                  Não é senha: vai pro navegador de todo mundo e dá pra ler no
                  código da página. Por isso aparece em texto normal, sem olho de
                  revelar e sem o aviso de "trate como senha".
                */}
                <div>
                  <Label htmlFor="mp_pk" className="flex items-center gap-1.5">
                    <CreditCard className="size-3.5" /> Public Key
                  </Label>
                  <Input
                    id="mp_pk" value={publicKey || estado.public_key} maxLength={120} autoComplete="off"
                    placeholder="APP_USR-… (fica ao lado do Access Token, no painel)"
                    onChange={e => setPublicKey(e.target.value)}
                    className="mt-1 h-[46px] font-mono text-sm"
                  />
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    É o que permite o cliente digitar o cartão <b>sem sair da sua loja</b>. Não é segredo —
                    ela é feita pra ficar visível no navegador.
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button type="submit" size="sm" disabled={enviando || (!tokenTeste.trim() && !tokenProducao.trim() && !publicKey.trim())}>
                    <Save className="size-3.5" />
                    {enviando ? 'Salvando…' : 'Conectar e testar'}
                  </Button>
                  {tokenMpDoModo && (
                    <Button type="button" variant="outline" size="sm"
                      onClick={() => { setEditandoCred(false); setTokenTeste(''); setTokenProducao(''); }}>
                      Cancelar
                    </Button>
                  )}
                </div>
              </form>
            )}
          </CardContent>
        </Card>

        {/*
          Webhook em acordeão FECHADO: é informação de reforço, não tarefa. Aberto
          por padrão, ele competia com o que a tela pede de verdade (colar token) e
          dava a impressão de que faltava configurar alguma coisa.
        */}
        <Card className="border-dashed">
          <CardContent className="p-0">
            <button
              type="button"
              onClick={() => setWebhookAberto(v => !v)}
              className="flex w-full items-center gap-2 px-4 py-3.5 text-left"
            >
              <span className="flex-1 text-sm font-semibold">Confirmação automática de pagamento</span>
              <span className="shrink-0 rounded-full bg-emerald-600/10 px-2 py-0.5 text-[10px] font-bold text-emerald-800 dark:text-emerald-400">
                já funciona sozinha
              </span>
              <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground transition-transform',
                webhookAberto && 'rotate-180')} />
            </button>
            {webhookAberto && (
              <div className="space-y-2 border-t border-border px-4 py-3.5 text-xs text-muted-foreground">
                {/*
                  Não promete que "não precisa fazer nada". Na homologação apareceu
                  um pagamento aprovado, com a URL de notificação gravada certa
                  dentro do próprio pagamento, que mesmo assim nunca gerou chamada
                  nenhuma. Por isso o sistema confere sozinho — e por isso vale
                  dizer isso aqui.
                */}
                <p>
                  O sistema avisa o Mercado Pago pra onde mandar a confirmação a cada cobrança e ainda
                  <b> confere sozinho a cada 5 minutos</b> se algum pagamento foi aprovado sem aviso —
                  então nenhum pedido pago fica preso em "aguardando". Se quiser reforçar, cadastre a URL
                  abaixo como webhook no painel do Mercado Pago (opcional):
                </p>
                <div className="flex items-center gap-2">
                  <code className="block flex-1 break-all rounded bg-muted px-2 py-1.5 font-mono text-[11px]">
                    {urlWebhook}
                  </code>
                  <Button type="button" variant="outline" size="icon" className="shrink-0" onClick={copiarUrlWebhook} title="Copiar">
                    {urlWebhookCopiada ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
                  </Button>
                </div>
                <p className="text-[11px]">
                  Essa URL é <b>desta loja</b> — ela já identifica sua conta. Não use a de outro lojista.
                </p>

                {/*
                  ASSINATURA POR LOJA. O Mercado Pago emite uma por aplicação, e
                  cada lojista usa a conta dele — por isso o campo vive aqui, e
                  não numa variável do servidor. Um segredo global validaria uma
                  loja e descartaria em silêncio a notificação de todas as
                  outras: bug que só apareceria com o segundo cliente.
                */}
                <form onSubmit={salvarWebhookSecret} className="space-y-2 border-t border-border pt-3">
                  <Label htmlFor="wh_secret" className="text-xs">
                    Assinatura secreta {estado.webhook_secret_configurado && (
                      <span className="ml-1 font-normal text-emerald-700 dark:text-emerald-400">• configurada</span>
                    )}
                  </Label>
                  <p className="text-[11px]">
                    Aparece no painel do Mercado Pago logo depois de cadastrar a URL acima. Com ela, o
                    sistema confere que a notificação veio mesmo do Mercado Pago e descarta as forjadas.
                  </p>
                  <div className="flex items-center gap-2">
                    <Input
                      id="wh_secret" type="password" value={webhookSecret} maxLength={200} autoComplete="off"
                      placeholder={estado.webhook_secret_configurado ? '•••••••• (já configurada)' : 'Cole a assinatura secreta'}
                      onChange={e => setWebhookSecret(e.target.value)}
                      className="h-10 flex-1 font-mono text-sm"
                    />
                    <Button type="submit" size="sm" className="shrink-0" disabled={enviando || !webhookSecret.trim()}>
                      Salvar
                    </Button>
                    {estado.webhook_secret_configurado && (
                      <Button type="button" variant="ghost" size="sm" className="shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        disabled={enviando} onClick={removerWebhookSecret}>
                        Remover
                      </Button>
                    )}
                  </div>
                </form>
              </div>
            )}
          </CardContent>
        </Card>
      </>)}
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
  const [agVersao, setAgVersao] = useState('');
  // Setores de impressão (Cozinha, Bar...) — vínculo setor→impressora é local deste PC.
  const [setores, setSetores] = useState<{ id: number; nome: string; categorias: number }[]>([]);
  const [setorImpressoras, setSetorImpressoras] = useState<Record<number, string>>({});

  function escolherSetor(setorId: number, nome: string) {
    definirImpressoraSetor(setorId, nome);
    setSetorImpressoras(m => ({ ...m, [setorId]: nome }));
  }

  async function conectarAgente() {
    setAgEstado('buscando');
    // O resto do app consulta o status por um cache de 5s (ver agente.ts). Sem
    // limpar aqui, o lojista abriria o agente, veria "conectado" nesta tela, e a
    // próxima impressão ainda usaria o "fechado" de segundos atrás.
    esquecerStatusAgente();
    const status = await statusAgente();
    if (!status) { setAgEstado('off'); return; }
    setAgVersao(status.versao);
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
    api<{ setores: { id: number; nome: string; categorias: number }[] }>('GET', '/api/lojista/setores')
      .then(r => {
        setSetores(r.setores);
        const mapa: Record<number, string> = {};
        r.setores.forEach(s => { mapa[s.id] = impressoraSetor(s.id); });
        setSetorImpressoras(mapa);
      })
      .catch(() => {});
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
      mostrar({ tipo: 'sucesso', titulo: 'Impressão configurada!' });
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
              ? <span className="rounded-full bg-green-500/15 text-green-600 px-2 py-0.5 text-[10px] font-bold">
                  ativo{agVersao ? ` · v${agVersao}` : ''}
                </span>
              : agEstado === 'off'
                ? <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">não detectado</span>
                : null}
          </div>
          <p className="text-xs text-muted-foreground">
            Instale o <strong>Software de Impressão</strong> e mantenha-o aberto no computador do caixa.
            O cupom será enviado direto para a impressora térmica.
          </p>

          {agEstado === 'ok' && agVersao && agVersao !== VERSAO_INSTALADOR && (
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-700">
              Nova versão disponível ({VERSAO_INSTALADOR}) — baixe e instale por cima pra atualizar.
            </p>
          )}

          <a href={URL_INSTALADOR}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground shadow-sm shadow-primary/30 transition-opacity hover:opacity-90">
            <Download className="size-4" /> Baixar instalador (Windows) · v{VERSAO_INSTALADOR}
          </a>
          <p className="text-[11px] text-muted-foreground">
            Baixe no computador do caixa, instale e deixe aberto. Depois clique em <strong>Procurar impressoras</strong>.
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

      {/* Setor de impressão → impressora (vínculo local, deste PC) */}
      {agEstado === 'ok' && setores.length > 0 && (
        <Card>
          <CardContent className="p-5 space-y-3">
            <div className="flex items-center gap-2">
              <Printer className="size-4 text-primary" />
              <span className="font-bold text-sm">Setores → impressora</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Escolha qual impressora deste computador recebe o cupom de cada setor. Sem escolha, o setor usa a impressora padrão acima.
              Configure os setores e vincule categorias na aba Categorias.
            </p>
            <div className="grid gap-2.5">
              {setores.map(s => (
                <div key={s.id} className="flex items-center gap-2">
                  <span className="w-28 shrink-0 text-sm font-semibold truncate">{s.nome}</span>
                  <select
                    value={setorImpressoras[s.id] || ''}
                    onChange={e => escolherSetor(s.id, e.target.value)}
                    className="h-9 flex-1 rounded-lg border border-input bg-background px-2 text-sm"
                  >
                    <option value="">Usar impressora padrão</option>
                    {agImpressoras.map(nome => <option key={nome} value={nome}>{nome}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

    </form>
  );
}

/* ───────────────────────── Segurança (2FA) ───────────────────────── */

export function SegurancaLoja() {
  const { mostrar } = useToast();
  const [senha, setSenha] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function resetar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    try {
      await api('POST', '/api/lojista/2fa/resetar', { senha });
      mostrar({ tipo: 'sucesso', titulo: '2FA resetado. Faça login de novo para configurar um novo app.' });
      encerrarSessao();
      setTimeout(() => window.location.reload(), 1200);
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="max-w-lg space-y-4">
      <Card className="border-green-500/40 bg-green-500/5">
        <CardContent className="p-5 flex items-center gap-4">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-green-500/15">
            <ShieldCheck className="size-5 text-green-600" />
          </div>
          <div>
            <div className="font-bold">Verificação em duas etapas ativa</div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Obrigatória nesta conta — protege seu acesso mesmo se sua senha vazar.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-5">
          <div className="font-bold text-sm mb-1">Perdeu o celular ou trocou de aparelho?</div>
          <p className="text-xs text-muted-foreground mb-4">
            Resetar apaga o app autenticador atual e os códigos de backup — no próximo login você configura um novo, do zero.
          </p>
          <form onSubmit={resetar} className="space-y-3">
            <div>
              <Label htmlFor="senha-reset-2fa">Confirme sua senha</Label>
              <Input id="senha-reset-2fa" type="password" autoComplete="current-password" className="mt-1.5"
                value={senha} onChange={e => setSenha(e.target.value)} required />
            </div>
            <Button type="submit" variant="outline" disabled={enviando || !senha}>
              {enviando ? 'Resetando…' : 'Resetar 2FA'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

/* ─────────────────── Usuários da loja (equipe do painel) ─────────────────── */

interface UsuarioLoja {
  id: number; nome: string; email: string;
  bloqueado: number; criado_em: string; dono: boolean;
}

/**
 * Equipe com acesso ao painel.
 *
 * O PROBLEMA QUE ISTO RESOLVE: existia um login por loja, então caixa, gerente e
 * balconista dividiam a mesma senha. Ninguém sabia quem fez o quê, e tirar o
 * acesso de quem saiu obrigava a trocar a senha de todo mundo.
 */
export function UsuariosLoja() {
  const { mostrar } = useToast();
  const confirmar = useConfirm();
  const [estado, setEstado] = useState<{ sou_dono: boolean; meu_id: number; usuarios: UsuarioLoja[] } | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [criando, setCriando] = useState(false);
  const [form, setForm] = useState({ nome: '', email: '', senha: '' });
  /** Id de quem está com o campo de nova senha aberto. */
  const [trocandoSenha, setTrocandoSenha] = useState<number | null>(null);
  const [senhaNova, setSenhaNova] = useState('');

  function carregar() {
    api<{ sou_dono: boolean; meu_id: number; usuarios: UsuarioLoja[] }>('GET', '/api/lojista/usuarios')
      .then(setEstado)
      .catch(() => mostrar({ tipo: 'erro', titulo: 'Não foi possível carregar os usuários.' }));
  }
  useEffect(() => { carregar(); }, []);

  async function criar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    try {
      await api('POST', '/api/lojista/usuarios', form);
      mostrar({ tipo: 'sucesso', titulo: `${form.nome} já pode entrar no painel.` });
      setForm({ nome: '', email: '', senha: '' });
      setCriando(false);
      carregar();
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally { setEnviando(false); }
  }

  async function alternarBloqueio(u: UsuarioLoja) {
    try {
      await api('PUT', `/api/lojista/usuarios/${u.id}`, { bloqueado: !u.bloqueado });
      carregar();
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    }
  }

  async function salvarSenha(u: UsuarioLoja) {
    if (senhaNova.length < 6) {
      mostrar({ tipo: 'erro', titulo: 'A senha precisa ter pelo menos 6 caracteres.' });
      return;
    }
    try {
      await api('PUT', `/api/lojista/usuarios/${u.id}`, { senha: senhaNova });
      mostrar({ tipo: 'sucesso', titulo: `Senha de ${u.nome} trocada.` });
      setTrocandoSenha(null);
      setSenhaNova('');
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    }
  }

  async function remover(u: UsuarioLoja) {
    const ok = await confirmar({
      titulo: `Remover ${u.nome}?`,
      descricao: 'A conta é apagada e a pessoa perde o acesso na hora. Não dá pra desfazer.',
      confirmar: 'Remover', destrutivo: true,
    });
    if (!ok) return;
    try {
      await api('DELETE', `/api/lojista/usuarios/${u.id}`);
      carregar();
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    }
  }

  if (!estado) return <Skeleton className="h-48" />;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold">Usuários</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Quem pode entrar no painel desta loja.
        </p>
      </div>

      {/*
        DIZ O QUE O ACESSO É, em vez de deixar descobrir depois. Hoje não existe
        nível de permissão: quem entra vê tudo. Deixar isso implícito faria o
        lojista criar um login pro balconista achando que criou acesso limitado —
        e descobrir o contrário no dia em que alguém mexesse no preço.
      */}
      <div className="flex items-start gap-2 rounded-xl border border-amber-300/60 bg-amber-50/70 px-3.5 py-3 dark:border-amber-500/30 dark:bg-amber-500/10">
        <AlertCircle className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-400" />
        <p className="text-xs text-amber-900 dark:text-amber-300">
          <b>Todo usuário criado aqui vê o painel inteiro</b> — pedidos, produtos, preços e relatórios.
          Ainda não existe acesso limitado por área. Só <b>você</b>, como dono, pode criar e remover
          usuários.
        </p>
      </div>

      <Card>
        <CardContent className="p-5">
          <div className="divide-y divide-border">
            {estado.usuarios.map(u => (
              <div key={u.id} className="py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                    {u.nome.trim().slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">
                      {u.nome}
                      {u.dono && (
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">dono</span>
                      )}
                      {u.id === estado.meu_id && (
                        <span className="text-[11px] font-normal text-muted-foreground">(você)</span>
                      )}
                      {!!u.bloqueado && (
                        <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-bold text-destructive">bloqueado</span>
                      )}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                  </div>

                  {/* O dono não tem ações: bloquear ou remover a única conta que
                      administra as outras deixaria a loja sem saída. */}
                  {estado.sou_dono && !u.dono && (
                    <div className="flex shrink-0 gap-1">
                      <Button type="button" variant="ghost" size="sm"
                        onClick={() => { setTrocandoSenha(trocandoSenha === u.id ? null : u.id); setSenhaNova(''); }}>
                        Trocar senha
                      </Button>
                      <Button type="button" variant="ghost" size="sm" onClick={() => alternarBloqueio(u)}>
                        {u.bloqueado ? 'Desbloquear' : 'Bloquear'}
                      </Button>
                      <Button type="button" variant="ghost" size="icon" title="Remover"
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => remover(u)}>
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  )}
                </div>

                {trocandoSenha === u.id && (
                  <div className="mt-2.5 flex flex-wrap items-center gap-2 pl-12">
                    <Input
                      type="password" autoFocus value={senhaNova} maxLength={72}
                      placeholder="Nova senha (mín. 6)" autoComplete="new-password"
                      onChange={e => setSenhaNova(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); salvarSenha(u); } }}
                      className="h-9 w-56 text-sm"
                    />
                    <Button type="button" size="sm" onClick={() => salvarSenha(u)}>Salvar</Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => setTrocandoSenha(null)}>Cancelar</Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {estado.sou_dono && (
        criando ? (
          <Card className="border-primary/40">
            <CardContent className="p-5">
              <form onSubmit={criar} className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold">Novo usuário</span>
                  <button type="button" onClick={() => setCriando(false)} className="rounded-lg p-1 hover:bg-accent">
                    <X className="size-4" />
                  </button>
                </div>
                <div>
                  <Label htmlFor="u_nome">Nome</Label>
                  <Input id="u_nome" autoFocus value={form.nome} maxLength={120}
                    placeholder="Ex.: Maria (caixa)"
                    onChange={e => setForm(f => ({ ...f, nome: e.target.value }))} />
                </div>
                <div>
                  <Label htmlFor="u_email">E-mail (será o login)</Label>
                  <Input id="u_email" type="email" value={form.email} maxLength={200} autoComplete="off"
                    placeholder="maria@exemplo.com"
                    onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
                </div>
                <div>
                  <Label htmlFor="u_senha">Senha inicial</Label>
                  <Input id="u_senha" type="password" value={form.senha} maxLength={72} autoComplete="new-password"
                    placeholder="Mínimo 6 caracteres"
                    onChange={e => setForm(f => ({ ...f, senha: e.target.value }))} />
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Combine com a pessoa e peça pra ela trocar depois, em Conta.
                  </p>
                </div>
                <Button type="submit" size="sm" disabled={enviando}>
                  <Plus className="size-3.5" />
                  {enviando ? 'Criando…' : 'Criar usuário'}
                </Button>
              </form>
            </CardContent>
          </Card>
        ) : (
          <Button type="button" variant="outline" className="w-full" onClick={() => setCriando(true)}>
            <Plus className="size-4" /> Adicionar usuário
          </Button>
        )
      )}
    </div>
  );
}
