import { useEffect, useState } from 'react';
import { Ajuda } from '@/components/ui/ajuda';
import { CabecalhoSecao } from '@/components/ui/cabecalho-secao';
import { Settings, Save, Power, Clock, Zap, Bike, Plus, Trash2, MapPin, CreditCard, Eye, EyeOff, CheckCircle2, XCircle, Link2, Wand2, Printer, RefreshCw, FileText, Download, Globe, ExternalLink, Copy, Check, FlaskConical, Rocket, ShieldCheck, Search, AlertCircle, ChevronDown, X, Smartphone } from 'lucide-react';
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
import type { DiaHorario, Turno, Loja } from '@/types';
import { useRascunho, useAvisoNaoSalvo } from '@/lib/nao-salvo';

export function LojaConfiguracao() {
  const { mostrar } = useToast();
  const [loja, setLoja] = useState<Loja | null>(null);
  const [form, setForm] = useState({
    nome: '', descricao: '', categoria: '', endereco: '',
    taxa_entrega: '', tempo_estimado_min: '', horario_funcionamento: '', minimo_pedido: '',
    aceita_retirada: false,
    slug: '', dominio_personalizado: '',
  });
  const [enviando, setEnviando] = useState(false);
  const [alternando, setAlternando] = useState(false);
  /* O ponto salvo é fixado ao CARREGAR e ao GRAVAR. Sem a chamada no
     carregamento a tela nasceria suja e avisaria sobre edição inexistente. */
  const { sujo, marcarSalvo } = useRascunho(form);
  useAvisoNaoSalvo(sujo);
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
        aceita_retirada: !!(l as { aceita_retirada?: number }).aceita_retirada,
      });
      marcarSalvo();
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
        aceita_retirada: form.aceita_retirada,
        slug: form.slug.trim() || null,
        dominio_personalizado: form.dominio_personalizado.trim() || null,
      });
      setLoja(r.loja);
      marcarSalvo();
      mostrar({ tipo: 'sucesso', titulo: 'Loja atualizada!' });
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally {
      setEnviando(false);
    }
  }

  /**
   * Abre/fecha a loja. `ate` só vale ao FECHAR no modo automático.
   *
   * No automático, fechar é pausar: o tick de horário reabre quando a pausa
   * vence. A tela dizia só "Loja fechada." — e o lojista que fechava numa noite
   * fraca e ia embora tinha a loja reaberta sozinha duas horas depois,
   * aceitando pedido que ninguém ia preparar. Agora a hora da reabertura vem na
   * resposta e é DITA.
   */
  async function alternarAberta(ate?: 'expediente') {
    if (!loja) return;
    setAlternando(true);
    try {
      const r = await api<{ aberta: boolean; reabre_em: string | null; automatico: boolean }>(
        'POST', '/api/lojista/loja/abrir-fechar', ate ? { ate } : undefined);
      setLoja(l => l ? { ...l, aberta: r.aberta ? 1 : 0 } : l);
      if (r.aberta) {
        mostrar({ tipo: 'sucesso', titulo: 'Loja aberta para pedidos!' });
      } else if (r.reabre_em) {
        const q = new Date(r.reabre_em);
        const hoje = q.toDateString() === new Date().toDateString();
        const hora = q.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        const dia = hoje ? '' : ` de ${q.toLocaleDateString('pt-BR', { weekday: 'short' })}`;
        mostrar({
          tipo: 'sucesso',
          titulo: 'Loja fechada.',
          descricao: `No horário automático, ela reabre sozinha às ${hora}${dia}.`,
        });
      } else {
        mostrar({ tipo: 'sucesso', titulo: 'Loja fechada.' });
      }
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally {
      setAlternando(false);
    }
  }

  if (!loja) return <Skeleton className="h-96" />;

  return (
    <div className="space-y-5">
      {/* O título é o rótulo do menu, letra por letra: clicar em "Dados" e
          chegar em "Loja" faz a pessoa duvidar se clicou certo. */}
      <CabecalhoSecao titulo="Dados" />

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
          {/* `() => alternarAberta()` e não `alternarAberta`: passado direto, o
              React entrega o evento do clique como primeiro argumento, e ele
              cairia no parâmetro `ate`. */}
          {/* O `?` fica JUNTO dos botões, não no título da seção: a dúvida
              ("fechei, e agora?") nasce no instante do clique. */}
          <Ajuda chave="horario-fechar" />
          <Button
            variant={loja.aberta ? 'destructive' : 'success'}
            onClick={() => alternarAberta()}
            disabled={alternando || loja.status_aprovacao !== 'aprovada'}
          >
            <Power className="size-4" />
            {alternando ? '…' : loja.aberta ? 'Fechar agora' : 'Abrir agora'}
          </Button>
          {/*
            FECHAR PELO RESTO DO DIA — só faz sentido aberta e no automático.
            "Fechar agora" pausa por 2h porque o caso comum é a pausa curta
            (fila cheia, faltou insumo). Quem encerrou o dia mais cedo quer a
            loja fechada ATÉ A PRÓXIMA ABERTURA da agenda, e sem esta opção
            precisava desligar o horário automático e lembrar de religar.
          */}
          {!!loja.aberta && !!loja.auto_horario && loja.status_aprovacao === 'aprovada' && (
            <Button variant="outline" onClick={() => alternarAberta('expediente')} disabled={alternando}>
              Encerrar o dia
            </Button>
          )}
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

            {/*
              RETIRADA NO LOCAL — desligada por padrão.
              Só a loja sabe se tem balcão pra receber gente. Ligada sem querer,
              o cliente aparece na porta de uma cozinha que não atende público.
            */}
            <button
              type="button"
              onClick={() => setForm(f => ({ ...f, aceita_retirada: !f.aceita_retirada }))}
              className="flex w-full items-start gap-3 rounded-xl border border-border p-3 text-left transition-colors hover:bg-accent/40"
            >
              <span className={cn('relative mt-0.5 h-[22px] w-[38px] shrink-0 rounded-full transition-colors',
                form.aceita_retirada ? 'bg-primary' : 'bg-muted-foreground/30')}>
                <span className={cn('absolute top-[3px] size-4 rounded-full bg-white shadow-sm transition-all',
                  form.aceita_retirada ? 'left-[19px]' : 'left-[3px]')} />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold">Aceitar retirada no local</span>
                <span className="block text-xs text-muted-foreground">
                  {form.aceita_retirada
                    ? 'O cliente pode escolher buscar na loja, sem taxa de entrega.'
                    : 'Só entrega. O cliente não vê a opção de retirar.'}
                </span>
              </span>
            </button>

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
  const { sujo, marcarSalvo } = useRascunho({ auto, agenda });
  useAvisoNaoSalvo(sujo);

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
      marcarSalvo();
    }).catch(() => mostrar({ tipo: 'erro', titulo: 'Não foi possível carregar o horário.' }));
  }, []);

  function atualizarDia(dia: number, patch: Partial<DiaHorario>) {
    setAgenda(a => a.map(d => d.dia === dia ? { ...d, ...patch } : d));
  }

  /*
   * OS TURNOS SÃO A FONTE ÚNICA NA TELA.
   *
   * `abre`/`fecha` continuam viajando pro servidor (agenda antiga depende
   * deles), mas quem edita aqui é sempre a lista — deixar os dois editáveis em
   * paralelo é onde eles divergem, e o sintoma seria a loja abrindo num horário
   * que a tela não mostra.
   */
  const turnosDe = (d: DiaHorario): Turno[] =>
    d.turnos && d.turnos.length > 0 ? d.turnos : [{ abre: d.abre, fecha: d.fecha }];

  function porTurnos(dia: number, novos: Turno[]) {
    const lista = novos.length > 0 ? novos : [{ abre: '18:00', fecha: '23:00' }];
    atualizarDia(dia, { turnos: lista, abre: lista[0].abre, fecha: lista[0].fecha });
  }

  function mudarTurno(d: DiaHorario, i: number, patch: Partial<Turno>) {
    porTurnos(d.dia, turnosDe(d).map((t, j) => (j === i ? { ...t, ...patch } : t)));
  }

  function adicionarTurno(d: DiaHorario) {
    const atuais = turnosDe(d);
    /* O novo turno começa DEPOIS do último: quem adiciona intervalo está
       abrindo a janta, e nascer em 18:00 sobre um turno que vai até 23:00
       criaria sobreposição já no clique. */
    const ultimo = atuais[atuais.length - 1];
    const inicio = ultimo.fecha >= '22:00' ? '23:00' : ultimo.fecha;
    porTurnos(d.dia, [...atuais, { abre: inicio, fecha: '23:00' }]);
  }

  function removerTurno(d: DiaHorario, i: number) {
    porTurnos(d.dia, turnosDe(d).filter((_, j) => j !== i));
  }

  function copiarParaTodos(origem: DiaHorario) {
    setAgenda(a => a.map(d => ({
      ...d, aberto: origem.aberto, abre: origem.abre, fecha: origem.fecha,
      /* Cópia da LISTA, não da referência: sem isso os sete dias passariam a
         apontar pro mesmo array, e editar a terça mexeria na quinta. */
      turnos: origem.turnos ? origem.turnos.map(t => ({ ...t })) : undefined,
    })));
    mostrar({ tipo: 'info', titulo: 'Horário copiado para todos os dias.' });
  }

  async function salvar() {
    setEnviando(true);
    try {
      await api('PUT', '/api/lojista/loja', {
        auto_horario: auto,
        horario_json: JSON.stringify(agenda),
      });
      marcarSalvo();
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
      <CabecalhoSecao titulo="Horário" />

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
              <div key={d.dia} className="flex items-start gap-2 rounded-xl border border-border/60 p-2.5">
                {/* toggle aberto */}
                <button
                  type="button"
                  disabled={!auto}
                  onClick={() => atualizarDia(d.dia, { aberto: !d.aberto })}
                  className={cn('relative h-5 w-9 rounded-full transition-colors shrink-0', d.aberto ? 'bg-primary' : 'bg-muted-foreground/30')}
                >
                  <span className={cn('absolute top-0.5 size-4 rounded-full bg-white shadow transition-all', d.aberto ? 'left-[18px]' : 'left-0.5')} />
                </button>
                <span className="w-20 shrink-0 pt-2 text-sm font-semibold">{nome}</span>
                {d.aberto ? (
                  <div className="flex-1 space-y-1.5">
                    {/*
                      UMA LINHA POR TURNO — é o que permite fechar entre o
                      almoço e a janta. Com um par só, quem serve os dois tinha
                      que declarar 11:00–23:00 e ficava "aberta" às 16h,
                      recebendo pedido com a cozinha vazia.
                    */}
                    {turnosDe(d).map((t, i) => (
                      <div key={i} className="flex items-center gap-1.5">
                        <Input
                          type="time" disabled={!auto}
                          value={t.abre}
                          onChange={e => mudarTurno(d, i, { abre: e.target.value })}
                          className="h-9 text-sm px-2 flex-1 min-w-0"
                        />
                        <span className="text-muted-foreground text-xs">às</span>
                        <Input
                          type="time" disabled={!auto}
                          value={t.fecha}
                          onChange={e => mudarTurno(d, i, { fecha: e.target.value })}
                          className="h-9 text-sm px-2 flex-1 min-w-0"
                        />
                        {i === 0 ? (
                          <button
                            type="button" disabled={!auto}
                            onClick={() => copiarParaTodos(d)}
                            title="Copiar este horário para todos os dias"
                            className="shrink-0 px-1 text-[11px] font-semibold text-primary hover:underline disabled:opacity-40"
                          >
                            todos
                          </button>
                        ) : (
                          <button
                            type="button" disabled={!auto}
                            onClick={() => removerTurno(d, i)}
                            title="Remover este turno"
                            aria-label="Remover turno"
                            className="shrink-0 px-1 text-muted-foreground hover:text-destructive disabled:opacity-40"
                          >
                            <X className="size-3.5" />
                          </button>
                        )}
                      </div>
                    ))}
                    {/* Dois turnos cobrem almoço e janta; mais que isso é raro e
                        vira uma coluna de campos difícil de conferir. */}
                    {turnosDe(d).length < 2 && (
                      <button
                        type="button" disabled={!auto}
                        onClick={() => adicionarTurno(d)}
                        className="text-[11px] font-semibold text-primary hover:underline disabled:opacity-40"
                      >
                        + fechar no intervalo
                      </button>
                    )}
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

interface Zona { id: number; bairro: string; taxa_centavos: number; tempo_min?: number; }

/**
 * Resumo do que está valendo + teste de endereço.
 *
 * O PROBLEMA QUE ISTO RESOLVE: a tela tinha três blocos (taxa padrão, taxa por
 * bairro, áreas no mapa) e nenhum respondia a pergunta que o lojista tem —
 * "quem eu atendo, e por quanto?". Pior, davam respostas que pareciam se
 * contradizer: "nenhuma zona cadastrada, todos pagam a taxa padrão" logo acima
 * de "pedidos fora das áreas são recusados".
 *
 * As duas frases estavam certas e falavam de coisas diferentes. Juntas, sem
 * hierarquia, viravam ruído.
 */
function ResumoEntrega({
  taxaPadrao, qtdZonas, qtdAreas,
}: { taxaPadrao: number; qtdZonas: number; qtdAreas: number }) {
  const { mostrar } = useToast();
  const [endereco, setEndereco] = useState('');
  const [testando, setTestando] = useState(false);
  const [resultado, setResultado] = useState<{
    atende: boolean; taxa_centavos: number | null; fonte: string | null;
    zona: string; localizado: boolean; bairro_usado: string;
  } | null>(null);

  async function testar(e: React.FormEvent) {
    e.preventDefault();
    if (endereco.trim().length < 5) return;
    setTestando(true);
    setResultado(null);
    try {
      setResultado(await api('POST', '/api/lojista/frete/testar', { endereco: endereco.trim() }));
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally { setTestando(false); }
  }

  const soAreas = qtdAreas > 0;

  return (
    <div className="space-y-4">
      <CabecalhoSecao titulo="Entrega" ajuda="entrega-taxa" />

      {/* ── O que está valendo agora ── */}
      <Card>
        <CardContent className="space-y-3 p-5">
          <p className="text-[11px] font-extrabold uppercase tracking-[.11em] text-muted-foreground">
            O que está valendo agora
          </p>

          <div className="flex items-start gap-2.5">
            <Bike className="mt-0.5 size-4 shrink-0 text-primary" />
            <p className="text-sm">
              {soAreas ? (
                <>Você atende <b>somente dentro das {qtdAreas === 1 ? 'áreas desenhadas' : `${qtdAreas} áreas desenhadas`}</b> no mapa. Endereço fora delas é recusado no checkout.</>
              ) : (
                <>Você atende <b>qualquer endereço</b>. Nenhuma área foi desenhada, então nada é recusado por localização.</>
              )}
            </p>
          </div>

          <div className="flex items-start gap-2.5">
            <MapPin className="mt-0.5 size-4 shrink-0 text-primary" />
            <p className="text-sm">
              {qtdZonas > 0
                ? <>{qtdZonas} bairro{qtdZonas > 1 ? 's' : ''} com taxa própria. O resto paga a taxa padrão de <b>{brl(taxaPadrao)}</b>.</>
                : <>Nenhum bairro com taxa própria — todo mundo paga a taxa padrão de <b>{brl(taxaPadrao)}</b>.</>}
            </p>
          </div>

          {/*
            TAXA PADRÃO ZERADA é quase sempre esquecimento, não decisão: o campo
            nasce em 0 e a tela nunca disse o que isso significa. Frete grátis
            pra todo endereço que não caiu numa regra é dinheiro saindo em
            silêncio — daí o aviso, e não só o número.
          */}
          {taxaPadrao === 0 && (
            <div className="flex items-start gap-2.5 rounded-xl border border-amber-300/60 bg-amber-50/70 px-3 py-2.5 dark:border-amber-500/30 dark:bg-amber-500/10">
              <AlertCircle className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-400" />
              <p className="text-xs text-amber-900 dark:text-amber-300">
                A taxa padrão está em <b>R$ 0,00</b>: quem não cair numa área nem num bairro cadastrado
                ganha <b>frete grátis</b>. Se não for de propósito, ajuste em <b>Dados da loja</b>.
              </p>
            </div>
          )}

          {/*
            A ORDEM DE PRECEDÊNCIA estava escondida numa frase no meio de um
            parágrafo. É a regra que decide o dinheiro — vira lista numerada.
          */}
          <div className="rounded-xl border border-border bg-muted/40 px-3.5 py-3">
            <p className="mb-1.5 text-xs font-bold">Qual taxa vale, em ordem</p>
            <ol className="space-y-1 text-xs text-muted-foreground">
              <li><b>1.</b> Caiu dentro de uma área do mapa → taxa daquela área</li>
              <li><b>2.</b> Senão, o bairro tem taxa própria → taxa do bairro</li>
              <li><b>3.</b> Senão → taxa padrão ({brl(taxaPadrao)})</li>
            </ol>
          </div>
        </CardContent>
      </Card>

      {/* ── Testar um endereço ── */}
      <Card>
        <CardContent className="space-y-3 p-5">
          <div className="flex items-center gap-2">
            <Search className="size-4 text-primary" />
            <span className="text-sm font-bold">Testar um endereço</span>
          </div>
          {/*
            Roda o MESMO código do checkout (resolverFrete). Simulação por
            caminho paralelo mente justamente quando mais importa.
          */}
          <p className="text-xs text-muted-foreground">
            Descubra se um cliente consegue pedir e qual taxa ele veria — sem precisar fazer um
            pedido de mentira. Usa exatamente a mesma regra do checkout.
          </p>
          <form onSubmit={testar} className="flex flex-wrap items-center gap-2">
            <Input
              value={endereco}
              onChange={e => setEndereco(e.target.value)}
              placeholder="Rua Rio do Braço, 207, Jardim Sofia"
              maxLength={200}
              className="h-10 min-w-[14rem] flex-1"
            />
            <Button type="submit" size="sm" className="h-10 shrink-0" disabled={testando || endereco.trim().length < 5}>
              {testando ? 'Testando…' : 'Testar'}
            </Button>
          </form>

          {resultado && (
            <div className={cn('space-y-1.5 rounded-xl border px-3.5 py-3',
              resultado.atende
                ? 'border-emerald-600/25 bg-emerald-50/70 dark:bg-emerald-500/10'
                : 'border-destructive/30 bg-destructive/5')}>
              <p className="flex items-center gap-2 text-sm font-bold">
                {resultado.atende
                  ? <><CheckCircle2 className="size-4 text-emerald-700 dark:text-emerald-400" /> Atende — taxa de {brl(resultado.taxa_centavos || 0)}</>
                  : <><XCircle className="size-4 text-destructive" /> Não atende esse endereço</>}
              </p>
              {resultado.atende && (
                <p className="text-xs text-muted-foreground">
                  {resultado.fonte === 'area' && <>Caiu na área <b>{resultado.zona}</b>.</>}
                  {resultado.fonte === 'bairro' && <>Pelo bairro <b>{resultado.zona}</b>.</>}
                  {resultado.fonte === 'padrao' && <>Nenhuma regra específica — taxa padrão.</>}
                </p>
              )}
              {/*
                Sem coordenada, a checagem por ÁREA nem chega a rodar. Dizer só
                "atende" seria mentir por omissão: o teste foi parcial.
              */}
              {!resultado.localizado && (
                <p className="flex items-start gap-1.5 text-xs text-amber-800 dark:text-amber-400">
                  <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                  Não consegui localizar esse endereço no mapa, então as <b>áreas não foram
                  verificadas</b> — o resultado acima considerou só o bairro
                  {resultado.bairro_usado ? <> (<b>{resultado.bairro_usado}</b>)</> : null}. Tente
                  com rua, número e bairro.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function ZonasEntrega() {
  const { mostrar } = useToast();
  const [zonas, setZonas] = useState<Zona[]>([]);
  const [carregado, setCarregado] = useState(false);
  const [bairro, setBairro] = useState('');
  const [taxa, setTaxa] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [taxaPadrao, setTaxaPadrao] = useState(0);
  /** Só a CONTAGEM: o resumo precisa saber se existe área; o mapa cuida do resto. */
  const [qtdAreas, setQtdAreas] = useState(0);
  /** Tempo padrão da loja — vira placeholder do campo por bairro. */  const [taxaPadraoTempo, setTaxaPadraoTempo] = useState(40);
  const [tempoZona, setTempoZona] = useState('');
  /*
   * AQUI O "NÃO SALVO" É OUTRA COISA.
   *
   * Não há formulário da tela inteira: cada bairro grava na hora. O que se
   * perde é o bairro DIGITADO e ainda não adicionado — e ele custa caro, porque
   * vem junto da distância consultada. Por isso `useRascunho` não serve: não
   * existe ponto salvo a comparar, e sim campo preenchido pendente.
   */
  useAvisoNaoSalvo(
    bairro.trim() !== '' || taxa.trim() !== '' || tempoZona.trim() !== '',
    'Você digitou um bairro que ainda não foi adicionado. Sair e perder?',
  );
  /** Distância e sugestão do bairro digitado — o número que ninguém tem de cabeça. */
  const [sugestao, setSugestao] = useState<{ km: number; sugestao_centavos: number; explicacao: string } | null>(null);
  const [sugerindo, setSugerindo] = useState(false);

  function carregar() {
    api<{ zonas: Zona[] }>('GET', '/api/lojista/zonas')
      .then(r => { setZonas(r.zonas); setCarregado(true); })
      .catch(() => mostrar({ tipo: 'erro', titulo: 'Não foi possível carregar as zonas.' }));
  }

  useEffect(() => {
    carregar();
    api<{ loja: Loja }>('GET', '/api/lojista/loja')
      .then(r => { setTaxaPadrao(r.loja.taxa_entrega_centavos); setTaxaPadraoTempo(r.loja.tempo_estimado_min || 40); })
      .catch(() => { });
    api<{ areas: unknown[] }>('GET', '/api/lojista/areas')
      .then(r => setQtdAreas(r.areas.length))
      .catch(() => { });
  }, []);

  /*
   * Mede a distância assim que o lojista termina de digitar o bairro. Não é
   * automático no preço: preenche a sugestão e ele decide — quem cobra sabe do
   * combustível e do concorrente, o sistema só sabe a distância.
   */
  async function sugerir() {
    if (bairro.trim().length < 2) return;
    setSugerindo(true);
    setSugestao(null);
    try {
      const r = await api<{ ok: boolean; km?: number; sugestao_centavos?: number; explicacao?: string }>(
        'POST', '/api/lojista/frete/sugerir', { bairro: bairro.trim() });
      if (r.ok && r.km !== undefined) {
        setSugestao({ km: r.km, sugestao_centavos: r.sugestao_centavos!, explicacao: r.explicacao! });
      }
    } catch { /* sugestão é conveniência: falhar aqui não atrapalha o cadastro */ }
    finally { setSugerindo(false); }
  }

  async function adicionar() {
    if (!bairro.trim()) return;
    setEnviando(true);
    try {
      await api('POST', '/api/lojista/zonas', {
        bairro: bairro.trim(),
        taxa: taxa === '' ? 0 : Number(taxa),
        // 0 = usa o tempo padrão da loja.
        tempo_min: tempoZona === '' ? 0 : Number(tempoZona),
      });
      setBairro(''); setTaxa(''); setTempoZona(''); setSugestao(null);
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
      <ResumoEntrega taxaPadrao={taxaPadrao} qtdZonas={zonas.length} qtdAreas={qtdAreas} />

      <Card>
        <CardContent className="p-5">
          <div className="mb-1 flex items-center gap-2">
            <Bike className="size-5 text-primary" />
            <span className="font-bold">Taxa por bairro</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Frete diferente conforme o bairro do cliente. Vale quando o endereço não cai em
            nenhuma área do mapa.
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
                onBlur={sugerir}
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
            {/* Tempo DESTE bairro. Vazio = usa o padrão da loja — não é o mesmo
                que zero, e por isso o placeholder mostra o padrão. */}
            <div className="relative w-24 shrink-0">
              <Input
                type="number" min="0" placeholder={`${taxaPadraoTempo} min`}
                value={tempoZona}
                onChange={e => setTempoZona(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), adicionar())}
                className="h-10 pr-8 text-sm"
                title="Tempo de entrega deste bairro"
              />
              <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">min</span>
            </div>
            <Button className="h-10 shrink-0" onClick={adicionar} disabled={enviando || !bairro.trim()}>
              <Plus className="size-4" />
            </Button>
          </div>

          {sugerindo && (
            <p className="mt-2 text-xs text-muted-foreground">Medindo a distância…</p>
          )}
          {/*
            A DISTÂNCIA é o que o sistema sabe; o preço é palpite fundamentado.
            Por isso a conta aparece por extenso — sugestão sem mostrar a conta
            vira número mágico, e ninguém decide preço confiando em número mágico.
          */}
          {sugestao && (
            <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2">
              <MapPin className="size-3.5 shrink-0 text-primary" />
              <span className="text-xs">
                <b>{String(sugestao.km).replace('.', ',')} km</b> em linha reta da loja.
                {' '}Sugestão: <b>{brl(sugestao.sugestao_centavos)}</b>
              </span>
              <span className="text-[11px] text-muted-foreground">({sugestao.explicacao})</span>
              <Button type="button" size="sm" variant="outline" className="ml-auto h-7 shrink-0"
                onClick={() => setTaxa(String(sugestao.sugestao_centavos / 100))}>
                Usar
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Lista */}
      <Card>
        <CardContent className="p-3">
          {zonas.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              Nenhum bairro com taxa própria — o resto das regras continua valendo (veja o resumo acima).
            </p>
          ) : (
            <div className="divide-y divide-border/60">
              {zonas.map(z => (
                <div key={z.id} className="flex items-center gap-3 py-2.5 px-1">
                  <MapPin className="size-4 text-muted-foreground shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{z.bairro}</span>
                    {/* Só mostra quando a zona define o próprio tempo — repetir
                        o padrão da loja em toda linha viraria ruído. */}
                    {!!z.tempo_min && (
                      <span className="text-[11px] text-muted-foreground">~{z.tempo_min} min</span>
                    )}
                  </span>
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
      <CabecalhoSecao titulo="Entregadores" />

      <Card>
        <CardContent className="p-5">
          <div className="flex items-center gap-2 mb-1">
            <Bike className="size-5 text-primary" />
            <span className="font-bold">Acesso do entregador</span>
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

/**
 * O que a rota /tef devolve. Os tokens vêm SEMPRE mascarados (`****abcd1234`) —
 * o valor em claro nunca sai do servidor, igual ao token do Mercado Pago.
 */
interface EstadoTef {
  ativo: boolean;
  base_url: string;
  serial_pos: string;
  token: string | null;
  gateway_token: string | null;
  configurado: boolean;
  pendencias: string[];
}

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
  /*
   * Os campos de credencial são de ESCRITA: o servidor devolve versão
   * mascarada, então não há valor carregado pra comparar — o que existe é
   * "colou e não salvou". Perder um access token colado do portal do Mercado
   * Pago significa voltar lá e gerar outro.
   */
  useAvisoNaoSalvo(
    [tokenTeste, tokenProducao, onzId, onzSecret, onzChave].some(v => v.trim() !== ''),
    'Você colou uma credencial que ainda não foi salva. Sair e perder?',
  );
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
  const [aba, setAba] = useState<'pix' | 'cartao' | 'maquininha'>('pix');
  const [tef, setTef] = useState<EstadoTef | null>(null);
  const [webhookAberto, setWebhookAberto] = useState(false);

  // A URL vem PRONTA do servidor, com ?t=<banco>&loja=<id>: só ele sabe o nome
  // do banco do tenant, e sem esses dois a notificação chega sem dizer de quem é.
  const urlWebhook = estado?.webhook_url ?? '';

  function carregar() {
    /* Falha aqui não pode derrubar a tela: Pix e cartão online não dependem do
       TEF, e uma loja sem maquininha é a maioria. Sem resposta, a aba mostra o
       estado vazio e o lojista configura do zero. */
    api<EstadoTef>('GET', '/api/lojista/tef').then(setTef).catch(() => {});
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
      <CabecalhoSecao titulo="Pagamentos" ajuda="pagamentos" />

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
          /*
            MAQUININHA é outro assunto dos dois primeiros, e por isso aba
            própria: Pix e cartão online são dinheiro que cai pela internet, sem
            ninguém presente. Esta é a máquina em cima do balcão, com o cliente
            na frente — quem configura, quando configura e o que dá errado são
            outros.
          */
          {
            id: 'maquininha' as const,
            titulo: 'Maquininha (TEF)',
            Icone: Smartphone,
            ok: !!tef?.configurado,
            status: !tef?.ativo
              ? 'Desligado'
              : tef.configurado ? 'Ligado · Smart TEF' : 'Falta configurar',
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

      {/* ───────────────────── ABA MAQUININHA (TEF) ───────────────────── */}
      {aba === 'maquininha' && <PainelTef estado={tef} aoMudar={setTef} />}
    </div>
  );
}

/**
 * CONFIGURAÇÃO DO TEF.
 *
 * O que esta tela liga: em vez de o operador digitar o valor na maquininha, o
 * sistema manda a cobrança e recebe de volta se aprovou, se foi crédito ou
 * débito, a bandeira e o NSU.
 *
 * A última parte é a que vale: hoje TODO cartão do PDV sai na nota declarado
 * como crédito por palpite. É código válido, a SEFAZ autoriza, e o erro só
 * aparece em fiscalização.
 *
 * As três credenciais NÃO são inventáveis nem descobríveis — vêm do
 * credenciamento na POS Controle. Por isso a tela explica de onde saem em vez de
 * só mostrar três campos vazios: campo sem procedência é campo que fica vazio
 * para sempre.
 */
function PainelTef({ estado, aoMudar }: {
  estado: EstadoTef | null;
  aoMudar: (e: EstadoTef) => void;
}) {
  const { mostrar } = useToast();
  const [enviando, setEnviando] = useState(false);
  const [baseUrl, setBaseUrl] = useState('');
  const [token, setToken] = useState('');
  const [gatewayToken, setGatewayToken] = useState('');
  const [serialPos, setSerialPos] = useState('');
  const [carregado, setCarregado] = useState(false);

  /*
   * Os campos de segredo nascem com a MÁSCARA que veio do servidor, não vazios.
   *
   * Vazio pareceria "nunca configurado" numa loja que está configurada, e o
   * primeiro reflexo seria colar tudo de novo. O backend ignora qualquer valor
   * que comece com `****`, então deixar a máscara no campo é seguro: só grava o
   * que a pessoa realmente reescrever.
   */
  useEffect(() => {
    if (!estado || carregado) return;
    setBaseUrl(estado.base_url);
    setToken(estado.token || '');
    setGatewayToken(estado.gateway_token || '');
    setSerialPos(estado.serial_pos);
    setCarregado(true);
  }, [estado, carregado]);

  async function salvar(campos: Record<string, unknown>) {
    setEnviando(true);
    try {
      const r = await api<EstadoTef>('PUT', '/api/lojista/tef', campos);
      aoMudar(r);
      /* Recarrega os campos do que o servidor gravou: a base URL volta
         normalizada (sem barra sobrando, sem o caminho colado junto), e mostrar
         o texto original faria a tela discordar do banco. */
      setBaseUrl(r.base_url);
      setToken(r.token || '');
      setGatewayToken(r.gateway_token || '');
      setSerialPos(r.serial_pos);
      return r;
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
      return null;
    } finally {
      setEnviando(false);
    }
  }

  if (!estado) {
    return (
      <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">
        Carregando…
      </CardContent></Card>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-6 py-6">
        <div>
          <h3 className="text-[15px] font-bold">Maquininha integrada</h3>
          <p className="mt-1 max-w-[620px] text-[13px] leading-relaxed text-muted-foreground">
            Com isto ligado, o valor da venda vai direto para a maquininha — o
            operador só confirma e o cliente passa o cartão. O sistema passa a
            saber se aprovou, se foi <b>crédito ou débito</b>, a bandeira e o NSU.
          </p>
          <p className="mt-2 max-w-[620px] rounded-xl border border-dashed border-border px-3.5 py-2.5 text-[12.5px] leading-relaxed text-muted-foreground">
            <b className="text-foreground">Por que isso importa na nota:</b> sem a
            maquininha integrada, todo cartão sai na NFC-e declarado como crédito
            — inclusive quando foi débito. A SEFAZ aceita, porque é um código
            válido; o problema só aparece numa fiscalização.
          </p>
        </div>

        {/* Interruptor desenhado à mão, como o resto desta tela — não existe
            componente Switch no projeto, e criar um só aqui deixaria dois
            interruptores diferentes na mesma página. */}
        <button
          type="button"
          disabled={enviando}
          onClick={() => void salvar({ ativo: !estado.ativo })}
          aria-pressed={estado.ativo}
          className="flex w-full items-center justify-between gap-4 rounded-xl border border-border p-4 text-left disabled:opacity-60"
        >
          <span className="min-w-0">
            <span className="block text-sm font-bold">Usar a maquininha integrada</span>
            <span className="mt-0.5 block text-[12.5px] text-muted-foreground">
              Desligado, o PDV segue como hoje: o operador digita o valor na máquina.
            </span>
          </span>
          <span className={cn('relative h-6 w-11 shrink-0 rounded-full transition-colors',
            estado.ativo ? 'bg-primary' : 'bg-muted-foreground/30')}>
            <span className={cn('absolute top-0.5 size-5 rounded-full bg-white shadow transition-all',
              estado.ativo ? 'left-[22px]' : 'left-0.5')} />
          </span>
        </button>

        {/*
          As pendências aparecem só com o TEF LIGADO. Com ele desligado a loja
          decidiu não usar, e cobrar credencial de quem não pediu é alarme sobre
          uma decisão dela.
        */}
        {estado.ativo && estado.pendencias.length > 0 && (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/[0.06] p-4">
            <p className="text-[13px] font-bold text-amber-700 dark:text-amber-500">
              Ainda não vai funcionar
            </p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
              Falta {estado.pendencias.join(', ')}. Enquanto isso, o cartão no PDV
              continua funcionando do jeito antigo.
            </p>
          </div>
        )}

        <form
          className="space-y-4"
          onSubmit={async e => {
            e.preventDefault();
            const r = await salvar({
              base_url: baseUrl,
              token,
              gateway_token: gatewayToken,
              serial_pos: serialPos,
            });
            if (r) {
              mostrar(r.ativo && !r.configurado
                ? { tipo: 'erro', titulo: 'Salvo, mas ainda falta algo', descricao: 'Falta ' + r.pendencias.join(', ') + '.' }
                : { tipo: 'sucesso', titulo: 'Dados da maquininha salvos' });
            }
          }}
        >
          <div>
            <Label htmlFor="tef-url">Endereço da API</Label>
            <Input
              id="tef-url" value={baseUrl} onChange={e => setBaseUrl(e.target.value)}
              placeholder="https://..." className="mt-1 font-mono text-sm" disabled={enviando}
            />
            <p className="mt-1 text-[12px] text-muted-foreground">
              Vem no seu credenciamento. Precisa começar com <b>https://</b> — pode
              colar o endereço completo que a gente corta o resto.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="tef-token">Token da loja</Label>
              <Input
                id="tef-token" value={token} onChange={e => setToken(e.target.value)}
                placeholder="Bearer token" className="mt-1 font-mono text-sm" disabled={enviando}
              />
            </div>
            <div>
              <Label htmlFor="tef-gw">Gateway token</Label>
              <Input
                id="tef-gw" value={gatewayToken} onChange={e => setGatewayToken(e.target.value)}
                placeholder="Subscription key" className="mt-1 font-mono text-sm" disabled={enviando}
              />
            </div>
          </div>
          <p className="-mt-1 text-[12px] text-muted-foreground">
            Guardados cifrados. Depois de salvos aparecem só os últimos dígitos —
            deixe como está para não mexer neles.
          </p>

          <div>
            <Label htmlFor="tef-serial">
              Serial da maquininha <span className="text-xs font-normal text-muted-foreground">(opcional)</span>
            </Label>
            <Input
              id="tef-serial" value={serialPos} onChange={e => setSerialPos(e.target.value)}
              placeholder="Deixe vazio se tiver só uma" className="mt-1 font-mono text-sm" disabled={enviando}
            />
            <p className="mt-1 text-[12px] text-muted-foreground">
              Em branco, a cobrança aparece em qualquer maquininha da loja. Com
              várias, preencha — senão a cobrança pode aparecer no balcão errado.
            </p>
          </div>

          <Button type="submit" disabled={enviando}>
            <Save className="size-4" /> Salvar dados da maquininha
          </Button>
        </form>

        <p className="border-t border-border pt-4 text-[12px] leading-relaxed text-muted-foreground">
          Nem toda maquininha aceita: depende da adquirente (Rede, Cielo, Getnet,
          Stone, PagBank e outras) <b>e do modelo</b>. Confirme a sua com a POS
          Controle antes de contar com isso.
        </p>
      </CardContent>
    </Card>
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
  const { sujo, marcarSalvo } = useRascunho({ largura, auto, rodape });
  useAvisoNaoSalvo(sujo);
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
      marcarSalvo();
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
      marcarSalvo();
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
      <CabecalhoSecao titulo="Impressão" />

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
      <CabecalhoSecao titulo="Segurança" />

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
  permissoes: string[];
}
interface AreaPainel { chave: string; rotulo: string; }

/** Marca/desmarca uma área numa lista de permissões. */
function alternarArea(lista: string[], chave: string): string[] {
  return lista.includes(chave) ? lista.filter(c => c !== chave) : [...lista, chave];
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
  const [estado, setEstado] = useState<{ sou_dono: boolean; meu_id: number; areas: AreaPainel[]; usuarios: UsuarioLoja[] } | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [criando, setCriando] = useState(false);
  const [form, setForm] = useState({ nome: '', email: '', senha: '' });
  /*
   * NASCE SÓ COM 'pedidos', não com tudo marcado. Quem cria um usuário está
   * quase sempre criando um ajudante — o padrão tem que ser o menor acesso que
   * ainda serve, e não o maior. Marcar o resto é um clique; descobrir que o
   * balconista viu o relatório de faturamento não tem desfazer.
   */
  const [permsNovo, setPermsNovo] = useState<string[]>(['pedidos']);
  /** Id de quem está com as permissões abertas pra editar. */
  const [editandoPerms, setEditandoPerms] = useState<number | null>(null);
  /** Id de quem está com o campo de nova senha aberto. */
  const [trocandoSenha, setTrocandoSenha] = useState<number | null>(null);
  const [senhaNova, setSenhaNova] = useState('');

  function carregar() {
    api<{ sou_dono: boolean; meu_id: number; areas: AreaPainel[]; usuarios: UsuarioLoja[] }>('GET', '/api/lojista/usuarios')
      .then(setEstado)
      .catch(() => mostrar({ tipo: 'erro', titulo: 'Não foi possível carregar os usuários.' }));
  }
  useEffect(() => { carregar(); }, []);

  async function criar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    try {
      await api('POST', '/api/lojista/usuarios', { ...form, permissoes: permsNovo });
      mostrar({ tipo: 'sucesso', titulo: `${form.nome} já pode entrar no painel.` });
      setForm({ nome: '', email: '', senha: '' });
      setPermsNovo(['pedidos']);
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

  async function salvarPermissoes(u: UsuarioLoja, permissoes: string[]) {
    try {
      await api('PUT', `/api/lojista/usuarios/${u.id}`, { permissoes });
      setEstado(e => e && ({ ...e, usuarios: e.usuarios.map(x => x.id === u.id ? { ...x, permissoes } : x) }));
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
      carregar(); // desfaz o otimismo se o servidor recusou
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
      <CabecalhoSecao titulo="Usuários" ajuda="usuarios" />

      {/*
        DIZ O QUE O ACESSO É, em vez de deixar descobrir depois. Hoje não existe
        nível de permissão: quem entra vê tudo. Deixar isso implícito faria o
        lojista criar um login pro balconista achando que criou acesso limitado —
        e descobrir o contrário no dia em que alguém mexesse no preço.
      */}
      <div className="flex items-start gap-2 rounded-xl border border-amber-300/60 bg-amber-50/70 px-3.5 py-3 dark:border-amber-500/30 dark:bg-amber-500/10">
        <AlertCircle className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-400" />
        <p className="text-xs text-amber-900 dark:text-amber-300">
          Você marca <b>quais áreas cada pessoa acessa</b>. O bloqueio vale também na API, não é só o
          menu sumindo. Só <b>você</b>, como dono, cria, remove e muda permissões — a sua conta tem
          acesso a tudo e não pode ser bloqueada.
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
                    {!u.dono && (
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                        {u.permissoes.length === estado.areas.length
                          ? 'Acesso a tudo'
                          : u.permissoes.length === 0
                            ? 'Sem acesso a nenhuma área'
                            : estado.areas.filter(a => u.permissoes.includes(a.chave)).map(a => a.rotulo.split(' (')[0]).join(' · ')}
                      </p>
                    )}
                  </div>

                  {/* O dono não tem ações: bloquear ou remover a única conta que
                      administra as outras deixaria a loja sem saída. */}
                  {estado.sou_dono && !u.dono && (
                    <div className="flex shrink-0 gap-1">
                      <Button type="button" variant="ghost" size="sm"
                        onClick={() => setEditandoPerms(editandoPerms === u.id ? null : u.id)}>
                        Permissões
                      </Button>
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

                {editandoPerms === u.id && (
                  <div className="mt-2.5 rounded-xl border border-border bg-muted/30 p-3 sm:ml-12">
                    <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                      Áreas que {u.nome} acessa
                    </p>
                    <div className="grid gap-1.5 sm:grid-cols-2">
                      {estado.areas.map(a => (
                        <label key={a.chave} className="flex cursor-pointer items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            className="size-4 shrink-0 rounded accent-primary"
                            checked={u.permissoes.includes(a.chave)}
                            onChange={() => salvarPermissoes(u, alternarArea(u.permissoes, a.chave))}
                          />
                          <span>{a.rotulo}</span>
                        </label>
                      ))}
                    </div>
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      Salva a cada clique. Quem já estiver logado perde o acesso na próxima ação.
                    </p>
                  </div>
                )}

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
                <div className="rounded-xl border border-border bg-muted/30 p-3">
                  <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                    Áreas que esta pessoa acessa
                  </p>
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    {estado.areas.map(a => (
                      <label key={a.chave} className="flex cursor-pointer items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="size-4 shrink-0 rounded accent-primary"
                          checked={permsNovo.includes(a.chave)}
                          onChange={() => setPermsNovo(p => alternarArea(p, a.chave))}
                        />
                        <span>{a.rotulo}</span>
                      </label>
                    ))}
                  </div>
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
