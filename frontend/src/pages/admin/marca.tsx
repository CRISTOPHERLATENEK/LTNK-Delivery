/**
 * "Marca da plataforma" (white label nível altíssimo) — o super admin define
 * a identidade visual completa: nome, slogan, logo, favicon, imagem de
 * compartilhamento, cores (primária + secundária), cantos, tipografia e SEO.
 * Tudo com preview ao vivo aplicado na própria interface.
 */
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Palette, Save, Eye, Type, SquareDashedBottom, Image as ImageIcon, Megaphone, Store, LifeBuoy, MessageCircle, CheckCircle2, DatabaseBackup, Download, Loader2, LayoutTemplate, Plus, Trash2, Check, Users, Star, Tag, HelpCircle, RefreshCw, CreditCard, FlaskConical, Rocket } from 'lucide-react';
import { AdminLayout } from './layout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ImageUpload } from '@/components/ui/image-upload';
import { useToast } from '@/components/ui/toast';
import { api, ApiError, tokenSessao } from '@/lib/api';
import { useTema, FONTES, foregroundContraste } from '@/lib/tema';
import { cn } from '@/lib/utils';
import { ICONES_LANDING } from '@/pages/cliente/landing';
import type { TemaMarca, RaioMarca, FonteMarca, LandingRecurso, LandingIcone, LandingDepoimento, LandingDestaque, LandingPlano, LandingFaq } from '@/types';

const RAIO_OPCOES: { valor: RaioMarca; label: string; classe: string }[] = [
  { valor: 'reto', label: 'Reto', classe: 'rounded-[3px]' },
  { valor: 'suave', label: 'Suave', classe: 'rounded-xl' },
  { valor: 'redondo', label: 'Redondo', classe: 'rounded-[1.4rem]' },
];

export function TelaMarca() {
  const { marca, previsualizar, recarregar } = useTema();
  const { mostrar } = useToast();
  const [form, setForm] = useState<TemaMarca>(marca);
  const [enviando, setEnviando] = useState(false);

  // Lojas para o seletor de "loja única" (white label)
  const lojasQ = useQuery({
    queryKey: ['admin-lojas-marca'],
    queryFn: () => api<{ lojas: { id: number; nome: string; status_aprovacao: string }[] }>('GET', '/api/admin/lojas').then(r => r.lojas),
  });

  useEffect(() => { setForm(marca); }, [marca]);

  // Preview ao vivo de TODA a marca enquanto edita
  useEffect(() => { previsualizar(form); }, [form, previsualizar]);

  // Ao sair sem salvar, reverte o preview para o tema persistido
  useEffect(() => () => { recarregar(); }, [recarregar]);

  function up<K extends keyof TemaMarca>(k: K, v: TemaMarca[K]) {
    setForm(f => ({ ...f, [k]: v }));
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    try {
      await api('PUT', '/api/admin/tema', form);
      await recarregar();
      mostrar({ tipo: 'sucesso', titulo: 'Marca atualizada!', descricao: 'O visual aplicou em toda a plataforma.' });
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally {
      setEnviando(false);
    }
  }

  const corFg = foregroundContraste(form.cor_primaria);
  const contrasteClaro = corFg === '0 0% 100%';

  return (
    <AdminLayout titulo="Marca">
    <div className="space-y-5 pb-4 max-w-5xl mx-auto">
      {/* Cabeçalho */}
      <div className="flex items-center gap-3">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
          <Palette className="size-6" />
        </div>
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Marca da plataforma</h1>
          <p className="text-sm text-muted-foreground">White label — identidade que todos os clientes vão ver.</p>
        </div>
      </div>

      <form onSubmit={salvar} className="grid gap-5 lg:grid-cols-[1fr_360px]">
        {/* ───────────── Coluna de edição ───────────── */}
        <div className="space-y-5 order-2 lg:order-1">
          {/* Identidade */}
          <Secao icone={Store} titulo="Identidade">
            <div>
              <Label htmlFor="nome">Nome da marca</Label>
              <Input id="nome" required maxLength={60} value={form.nome}
                onChange={e => up('nome', e.target.value)} />
            </div>
            <div>
              <Label htmlFor="slogan">Slogan</Label>
              <Input id="slogan" maxLength={120} value={form.slogan}
                onChange={e => up('slogan', e.target.value)}
                placeholder="Ex.: Peça das melhores lojas da sua região" />
            </div>
          </Secao>

          {/* Imagens */}
          <Secao icone={ImageIcon} titulo="Imagens">
            <ImageUpload label="Logo" value={form.logo_url}
              onChange={v => up('logo_url', v)} aspectRatio="square" />
            <ImageUpload label="Favicon (ícone da aba)" value={form.favicon_url}
              onChange={v => up('favicon_url', v)} aspectRatio="square" />
            <div>
              <ImageUpload label="Banner da tela de login" value={form.login_banner_url}
                onChange={v => up('login_banner_url', v)} aspectRatio="wide" />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Aparece no topo do card de login (/conta). Vazio = usa a ilustração padrão. Ideal ~1200×480px.
              </p>
            </div>
          </Secao>

          {/* Cores */}
          <Secao icone={Palette} titulo="Cores">
            <CampoCor label="Cor primária" valor={form.cor_primaria}
              onChange={v => up('cor_primaria', v)} />
            <div className={cn(
              'rounded-lg px-3 py-2 text-xs flex items-center gap-2',
              contrasteClaro ? 'bg-foreground text-background' : 'bg-foreground/5'
            )}>
              <span className="inline-flex size-4 items-center justify-center rounded-full"
                style={{ background: form.cor_primaria, color: `hsl(${corFg})` }}>A</span>
              Texto sobre a cor será <b>{contrasteClaro ? 'branco' : 'escuro'}</b> (contraste automático).
            </div>
            <CampoCor label="Cor secundária (opcional)" valor={form.cor_secundaria}
              onChange={v => up('cor_secundaria', v)} permiteVazio />
          </Secao>

          {/* Cantos */}
          <Secao icone={SquareDashedBottom} titulo="Cantos">
            <div className="flex gap-2">
              {RAIO_OPCOES.map(op => (
                <button key={op.valor} type="button" onClick={() => up('raio', op.valor)}
                  className={cn(
                    'flex-1 flex flex-col items-center gap-2 border-2 p-3 transition-colors',
                    op.classe,
                    form.raio === op.valor ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'
                  )}>
                  <span className={cn('size-9 bg-primary', op.classe)} />
                  <span className="text-xs font-semibold">{op.label}</span>
                </button>
              ))}
            </div>
          </Secao>

          {/* Tipografia */}
          <Secao icone={Type} titulo="Tipografia">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {(Object.keys(FONTES) as FonteMarca[]).map(f => (
                <button key={f} type="button" onClick={() => up('fonte', f)}
                  style={{ fontFamily: FONTES[f].stack }}
                  className={cn(
                    'rounded-xl border-2 px-3 py-2.5 text-left transition-colors',
                    form.fonte === f ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'
                  )}>
                  <div className="text-base font-bold leading-none">Aa</div>
                  <div className="mt-1 text-xs text-muted-foreground">{FONTES[f].label}</div>
                </button>
              ))}
            </div>
          </Secao>

          {/* SEO / Compartilhamento */}
          <Secao icone={Megaphone} titulo="SEO e compartilhamento">
            <div>
              <Label htmlFor="descricao">Descrição (Google e redes sociais)</Label>
              <textarea id="descricao" rows={2} maxLength={200} value={form.descricao}
                onChange={e => up('descricao', e.target.value)}
                placeholder="Uma frase que descreve a plataforma. Aparece no Google e ao compartilhar o link."
                className="w-full px-3 py-2.5 rounded-xl border border-input bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring" />
              <p className="text-xs text-muted-foreground mt-1">{form.descricao.length}/200</p>
            </div>
            <ImageUpload label="Imagem de compartilhamento (Open Graph)"
              value={form.og_image} onChange={v => up('og_image', v)} aspectRatio="wide" />
          </Secao>

          {/* Modo de exibição: loja única (white label) ou marketplace */}
          <Secao icone={Eye} titulo="Modo de exibição">
            <div className="space-y-2">
              {/* Landing page do produto */}
              <button type="button" onClick={() => up('loja_id', 0)}
                className={cn('w-full flex items-start gap-3 rounded-xl border-2 p-3 text-left transition-colors',
                  form.loja_id === 0 ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40')}>
                <Store className="size-5 text-primary shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold text-sm">Landing page do produto</div>
                  <div className="text-xs text-muted-foreground">A home vende a plataforma (recursos + botão "Ver demonstração"), sem listar lojas de terceiros.</div>
                </div>
              </button>
              {/* Loja única */}
              <div className={cn('rounded-xl border-2 p-3 transition-colors',
                form.loja_id > 0 ? 'border-primary bg-primary/5' : 'border-border')}>
                <div className="flex items-start gap-3">
                  <Eye className="size-5 text-primary shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <div className="font-semibold text-sm">Loja única (white label)</div>
                    <div className="text-xs text-muted-foreground mb-2">
                      Este link abre direto <b>uma loja</b>, sem listar as outras.
                    </div>
                    <select
                      value={form.loja_id || ''}
                      onChange={e => up('loja_id', Number(e.target.value))}
                      className="w-full h-10 px-3 rounded-xl border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      <option value="">Selecione a loja deste link…</option>
                      {(lojasQ.data ?? []).map(l => (
                        <option key={l.id} value={l.id}>
                          {l.nome}{l.status_aprovacao !== 'aprovada' ? ' (não aprovada)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            </div>
          </Secao>

          <Button type="submit" size="lg" className="w-full" disabled={enviando}>
            <Save className="size-4" />
            {enviando ? 'Salvando…' : 'Salvar marca'}
          </Button>
        </div>

        {/* ───────────── Preview fixo ───────────── */}
        <div className="order-1 lg:order-2">
          <div className="lg:sticky lg:top-4 space-y-2">
            <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Eye className="size-3.5" /> Pré-visualização ao vivo
            </div>
            <PreviewApp form={form} />
          </div>
        </div>
      </form>

      <SecaoLanding />
      <SecaoConfiguracoesGerais />
      <SecaoBackup />
    </div>
    </AdminLayout>
  );
}

interface ConfiguracoesGerais {
  suporte_email: string;
  suporte_telefone: string;
  termos_url: string;
  wbapi_server: string;
  wbapi_session_id: string;
  wbapi_configurado: boolean;
  mercadopago_modo: 'teste' | 'producao';
  mercadopago_token_teste_mascarado: string | null;
  mercadopago_token_producao_mascarado: string | null;
}

/**
 * Independente do form de marca (endpoint/salvamento próprios) — contato de
 * suporte e link dos termos de uso, hoje sem nenhum lugar editável no admin.
 */
function SecaoConfiguracoesGerais() {
  const { mostrar } = useToast();
  const consulta = useQuery({
    queryKey: ['admin-configuracoes-gerais'],
    queryFn: () => api<ConfiguracoesGerais>('GET', '/api/admin/configuracoes-gerais'),
  });
  const [form, setForm] = useState<ConfiguracoesGerais>({
    suporte_email: '', suporte_telefone: '', termos_url: '', wbapi_server: '', wbapi_session_id: '', wbapi_configurado: false,
    mercadopago_modo: 'producao', mercadopago_token_teste_mascarado: null, mercadopago_token_producao_mascarado: null,
  });
  const [wbapiApiKey, setWbapiApiKey] = useState(''); // write-only: nunca vem preenchido do servidor
  const [tokenTeste, setTokenTeste] = useState('');
  const [tokenProducao, setTokenProducao] = useState('');
  const [enviando, setEnviando] = useState(false);

  useEffect(() => { if (consulta.data) setForm(consulta.data); }, [consulta.data]);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    try {
      await api('PUT', '/api/admin/configuracoes-gerais', {
        suporte_email: form.suporte_email,
        suporte_telefone: form.suporte_telefone,
        termos_url: form.termos_url,
        wbapi_server: form.wbapi_server,
        wbapi_session_id: form.wbapi_session_id,
        ...(wbapiApiKey.trim() ? { wbapi_api_key: wbapiApiKey.trim() } : {}),
        mercadopago_modo: form.mercadopago_modo,
        ...(tokenTeste.trim() ? { mercadopago_token_teste: tokenTeste.trim() } : {}),
        ...(tokenProducao.trim() ? { mercadopago_token_producao: tokenProducao.trim() } : {}),
      });
      setWbapiApiKey('');
      setTokenTeste('');
      setTokenProducao('');
      mostrar({ tipo: 'sucesso', titulo: 'Configurações gerais salvas!' });
      consulta.refetch();
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-4">
    <form onSubmit={salvar}>
      <Secao icone={LifeBuoy} titulo="Suporte e termos de uso">
        <div>
          <Label htmlFor="suporte_email">E-mail de suporte</Label>
          <Input id="suporte_email" type="email" maxLength={200} value={form.suporte_email}
            onChange={e => setForm(f => ({ ...f, suporte_email: e.target.value }))}
            placeholder="suporte@suaempresa.com.br" />
        </div>
        <div>
          <Label htmlFor="suporte_telefone">Telefone/WhatsApp de suporte</Label>
          <Input id="suporte_telefone" maxLength={30} value={form.suporte_telefone}
            onChange={e => setForm(f => ({ ...f, suporte_telefone: e.target.value }))}
            placeholder="(11) 99999-9999" />
        </div>
        <div>
          <Label htmlFor="termos_url">Link dos termos de uso</Label>
          <Input id="termos_url" maxLength={500} value={form.termos_url}
            onChange={e => setForm(f => ({ ...f, termos_url: e.target.value }))}
            placeholder="https://…" />
          <p className="mt-1 text-[11px] text-muted-foreground">
            Vazio = a plataforma não exibe link de termos de uso.
          </p>
        </div>
      </Secao>

      <Secao icone={MessageCircle} titulo="WhatsApp não-oficial (WBAPI)">
        <p className="text-xs text-muted-foreground -mt-2">
          Uma sessão única de WhatsApp, compartilhada por toda a plataforma (o plano contratado não permite
          criar uma sessão por loja) — as lojas com esse método liberado usam esse mesmo número pra confirmar
          pedidos. Sem isso configurado, só o método oficial (Meta) fica disponível.
        </p>
        <div>
          <Label htmlFor="wbapi_server">URL do servidor WBAPI</Label>
          <Input id="wbapi_server" maxLength={300} value={form.wbapi_server}
            onChange={e => setForm(f => ({ ...f, wbapi_server: e.target.value }))}
            placeholder="https://api.deeliv.app" />
        </div>
        <div>
          <Label htmlFor="wbapi_session_id">Session ID</Label>
          <Input id="wbapi_session_id" maxLength={100} value={form.wbapi_session_id}
            onChange={e => setForm(f => ({ ...f, wbapi_session_id: e.target.value }))}
            placeholder="ID da sessão fornecido pelo provedor" className="font-mono" />
        </div>
        <div>
          <Label htmlFor="wbapi_api_key">X-Api-Key</Label>
          <Input id="wbapi_api_key" type="password" maxLength={300} value={wbapiApiKey}
            onChange={e => setWbapiApiKey(e.target.value)}
            placeholder={form.wbapi_configurado ? '•••••••••••••• (preenchido — deixe em branco pra manter)' : 'Cole a chave aqui'} />
          {form.wbapi_configurado && (
            <p className="mt-1 flex items-center gap-1 text-[11px] text-success">
              <CheckCircle2 className="size-3" /> Uma chave já está configurada.
            </p>
          )}
        </div>
      </Secao>

      <Secao icone={CreditCard} titulo="Mercado Pago (token da plataforma)">
        <p className="text-xs text-muted-foreground -mt-2">
          Token usado como fallback do Pix pras lojas que não configuraram o próprio token. Guarde um token de
          teste (sandbox) e um de produção lado a lado, e escolha qual dos dois vale agora — dá pra testar o
          checkout sem risco de gerar cobrança real, e trocar pra produção só apertando o botão abaixo.
        </p>

        <div className="flex overflow-hidden rounded-lg border">
          <button type="button"
            onClick={() => setForm(f => ({ ...f, mercadopago_modo: 'teste' }))}
            className={cn(
              'flex flex-1 items-center justify-center gap-2 py-2 text-sm font-semibold transition-colors',
              form.mercadopago_modo === 'teste' ? 'bg-warning/15 text-warning' : 'text-muted-foreground hover:bg-muted/50',
            )}>
            <FlaskConical className="size-4" /> Modo teste
          </button>
          <button type="button"
            onClick={() => setForm(f => ({ ...f, mercadopago_modo: 'producao' }))}
            className={cn(
              'flex flex-1 items-center justify-center gap-2 py-2 text-sm font-semibold transition-colors',
              form.mercadopago_modo === 'producao' ? 'bg-success/15 text-success' : 'text-muted-foreground hover:bg-muted/50',
            )}>
            <Rocket className="size-4" /> Produção
          </button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          {form.mercadopago_modo === 'teste'
            ? 'Ativo agora: token de TESTE — nenhum Pix gerado nessas lojas move dinheiro de verdade.'
            : 'Ativo agora: token de PRODUÇÃO — Pix gerado nessas lojas é uma cobrança real.'}
        </p>

        <div>
          <Label htmlFor="mp_token_teste">Access Token de teste (TEST-…)</Label>
          <Input id="mp_token_teste" type="password" maxLength={300} value={tokenTeste}
            onChange={e => setTokenTeste(e.target.value)}
            placeholder={form.mercadopago_token_teste_mascarado || 'Cole o token TEST-… aqui'} className="font-mono" />
          {form.mercadopago_token_teste_mascarado && (
            <p className="mt-1 flex items-center gap-1 text-[11px] text-success">
              <CheckCircle2 className="size-3" /> Configurado: {form.mercadopago_token_teste_mascarado}
            </p>
          )}
        </div>
        <div>
          <Label htmlFor="mp_token_producao">Access Token de produção (APP_USR-…)</Label>
          <Input id="mp_token_producao" type="password" maxLength={300} value={tokenProducao}
            onChange={e => setTokenProducao(e.target.value)}
            placeholder={form.mercadopago_token_producao_mascarado || 'Cole o token APP_USR-… aqui'} className="font-mono" />
          {form.mercadopago_token_producao_mascarado && (
            <p className="mt-1 flex items-center gap-1 text-[11px] text-success">
              <CheckCircle2 className="size-3" /> Configurado: {form.mercadopago_token_producao_mascarado}
            </p>
          )}
        </div>
      </Secao>

      <Button type="submit" disabled={enviando}>
        <Save className="size-4" />
        {enviando ? 'Salvando…' : 'Salvar configurações gerais'}
      </Button>
    </form>

      {form.wbapi_configurado && form.wbapi_session_id && <ConexaoWbapi />}
    </div>
  );
}

/** Conecta/desconecta a sessão única de WhatsApp (WBAPI) da plataforma — QR code ou pareamento por número. */
function ConexaoWbapi() {
  const { mostrar } = useToast();
  const consulta = useQuery({
    queryKey: ['admin-wbapi-status'],
    queryFn: () => api<{ status: 'conectado' | 'desconectado'; numero: string | null }>('GET', '/api/admin/whatsapp-nao-oficial/status'),
    refetchInterval: 5000,
  });
  const [aba, setAba] = useState<'qr' | 'codigo'>('qr');
  const [qr, setQr] = useState<string | null>(null);
  const [codigo, setCodigo] = useState<string | null>(null);
  const [telefone, setTelefone] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [desconectando, setDesconectando] = useState(false);

  async function conectarComQr() {
    setCarregando(true);
    setCodigo(null);
    try {
      const r = await api<{ qr: string }>('POST', '/api/admin/whatsapp-nao-oficial/conectar');
      setQr(r.qr);
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally { setCarregando(false); }
  }

  async function conectarComCodigo(e: React.FormEvent) {
    e.preventDefault();
    setCarregando(true);
    setQr(null);
    try {
      const r = await api<{ codigo?: string }>('POST', '/api/admin/whatsapp-nao-oficial/codigo', { telefone });
      setCodigo(r.codigo || null);
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally { setCarregando(false); }
  }

  async function desconectar() {
    setDesconectando(true);
    try {
      await api('POST', '/api/admin/whatsapp-nao-oficial/desconectar');
      mostrar({ tipo: 'info', titulo: 'WhatsApp desconectado.' });
      consulta.refetch();
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally { setDesconectando(false); }
  }

  const conectado = consulta.data?.status === 'conectado';

  useEffect(() => {
    if (conectado) { setQr(null); setCodigo(null); }
  }, [conectado]);

  return (
    <Card className="max-w-2xl">
      <CardContent className="p-5 space-y-4">
        <div className="flex items-center gap-2">
          <MessageCircle className="size-4 text-muted-foreground" />
          <h2 className="font-bold text-sm">Conexão do WhatsApp (WBAPI)</h2>
          {conectado
            ? <Badge variant="success" className="text-[10px]"><CheckCircle2 className="size-3" /> conectado {consulta.data?.numero ? `· ${consulta.data.numero}` : ''}</Badge>
            : <Badge variant="secondary" className="text-[10px]">desconectado</Badge>}
        </div>

        {conectado ? (
          <Button type="button" variant="outline" onClick={desconectar} disabled={desconectando}>
            {desconectando ? 'Desconectando…' : 'Desconectar'}
          </Button>
        ) : (
          <>
            <div className="flex gap-2 p-1 rounded-2xl bg-accent w-fit">
              {(['qr', 'codigo'] as const).map(a => (
                <button key={a} type="button" onClick={() => setAba(a)}
                  className={cn('px-4 py-1.5 rounded-xl text-sm font-bold transition-all',
                    aba === a ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
                  {a === 'qr' ? 'QR code' : 'Código'}
                </button>
              ))}
            </div>

            {aba === 'qr' && (
              qr ? (
                <div className="flex flex-col items-center gap-3">
                  <img src={qr} alt="QR code do WhatsApp" className="size-56 rounded-2xl border border-border bg-white p-2" />
                  <p className="text-xs text-muted-foreground text-center max-w-xs">
                    Abra o WhatsApp no celular → Aparelhos conectados → Conectar um aparelho, e escaneie este código.
                  </p>
                  <Button type="button" variant="outline" size="sm" onClick={conectarComQr} disabled={carregando}>
                    Gerar novo QR code
                  </Button>
                </div>
              ) : (
                <Button type="button" onClick={conectarComQr} disabled={carregando}>
                  {carregando ? 'Gerando…' : 'Gerar QR code'}
                </Button>
              )
            )}

            {aba === 'codigo' && (
              <form onSubmit={conectarComCodigo} className="space-y-3">
                {codigo ? (
                  <div className="flex flex-col items-center gap-3 py-2">
                    <div className="text-3xl font-mono font-extrabold tracking-[0.3em]">{codigo}</div>
                    <p className="text-xs text-muted-foreground text-center max-w-xs">
                      No WhatsApp do celular: Aparelhos conectados → Conectar um aparelho → Conectar com número de
                      telefone, e digite esse código.
                    </p>
                    <Button type="button" variant="outline" size="sm" onClick={() => setCodigo(null)}>
                      Solicitar outro
                    </Button>
                  </div>
                ) : (
                  <div className="flex gap-2 items-end">
                    <div className="flex-1">
                      <Label>Número do WhatsApp (com DDD)</Label>
                      <Input value={telefone} onChange={e => setTelefone(e.target.value.replace(/\D/g, ''))}
                        placeholder="11999999999" className="font-mono" />
                    </div>
                    <Button type="submit" disabled={carregando || !telefone}>
                      {carregando ? 'Gerando…' : 'Gerar código'}
                    </Button>
                  </div>
                )}
              </form>
            )}

            {(qr || codigo) && (
              <p className="text-xs text-muted-foreground">Aguardando você conectar no celular… (atualiza sozinho)</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

interface LandingConfig {
  cta_texto: string;
  recursos: LandingRecurso[];
  beneficios: string[];
  comparativo_sem: string[];
  comparativo_com: string[];
  segmentos: string[];
  depoimentos: LandingDepoimento[];
  destaques: LandingDestaque[];
  planos: LandingPlano[];
  faq: LandingFaq[];
  hero_eyebrow: string;
  hero_titulo: string;
  hero_subtitulo: string;
  hero_imagem: string;
  hero_imagem_mobile: string;
  whatsapp: string;
  demo_url: string;
}

const ICONES_DISPONIVEIS = Object.keys(ICONES_LANDING) as LandingIcone[];

/** Cabeçalho de uma aba do editor: título + explicação curta do que ela controla. */
function SecaoTituloEditor({ titulo, desc }: { titulo: string; desc: string }) {
  return (
    <div className="-mt-1">
      <h3 className="text-sm font-bold">{titulo}</h3>
      <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
    </div>
  );
}

/** Editor genérico de uma lista de textos curtos (benefícios, comparativo, segmentos). */
function ListaTextoEditavel({ titulo, itens, onChange, max, placeholder }: {
  titulo: string; itens: string[]; onChange: (itens: string[]) => void; max: number; placeholder?: string;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="mb-0">{titulo}</Label>
        <Button type="button" variant="outline" size="sm"
          onClick={() => itens.length < max && onChange([...itens, ''])} disabled={itens.length >= max}>
          <Plus className="size-3.5" /> Adicionar
        </Button>
      </div>
      {itens.map((v, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input value={v} maxLength={80} placeholder={placeholder}
            onChange={e => onChange(itens.map((x, idx) => idx === i ? e.target.value : x))} />
          <Button type="button" variant="ghost" size="icon" onClick={() => onChange(itens.filter((_, idx) => idx !== i))}>
            <Trash2 className="size-4 text-destructive" />
          </Button>
        </div>
      ))}
      {itens.length === 0 && <p className="text-xs text-muted-foreground">Nenhum item — usando os padrões embutidos.</p>}
    </div>
  );
}

/**
 * Conteúdo editável da landing page do produto (domínio principal quando não
 * há loja padrão — ver "Modo de exibição" acima e frontend/src/pages/cliente/landing.tsx).
 */
function SecaoLanding() {
  const { mostrar } = useToast();
  const consulta = useQuery({
    queryKey: ['admin-landing'],
    queryFn: () => api<LandingConfig>('GET', '/api/admin/landing'),
  });
  const [form, setForm] = useState<LandingConfig>({
    cta_texto: 'Ver demonstração', recursos: [], beneficios: [],
    comparativo_sem: [], comparativo_com: [], segmentos: [], depoimentos: [], destaques: [], planos: [], faq: [],
    hero_eyebrow: '', hero_titulo: '', hero_subtitulo: '', hero_imagem: '', hero_imagem_mobile: '', whatsapp: '', demo_url: '',
  });
  const [enviando, setEnviando] = useState(false);

  useEffect(() => { if (consulta.data) setForm(consulta.data); }, [consulta.data]);

  function upRecurso(i: number, campo: keyof LandingRecurso, valor: string) {
    setForm(f => ({ ...f, recursos: f.recursos.map((r, idx) => idx === i ? { ...r, [campo]: valor } as LandingRecurso : r) }));
  }

  function adicionarRecurso() {
    if (form.recursos.length >= 9) return;
    setForm(f => ({ ...f, recursos: [...f.recursos, { icone: 'store', titulo: '', desc: '' }] }));
  }

  function removerRecurso(i: number) {
    setForm(f => ({ ...f, recursos: f.recursos.filter((_, idx) => idx !== i) }));
  }

  function upDepoimento(i: number, campo: keyof LandingDepoimento, valor: string) {
    setForm(f => ({ ...f, depoimentos: f.depoimentos.map((d, idx) => idx === i ? { ...d, [campo]: valor } : d) }));
  }

  function adicionarDepoimento() {
    if (form.depoimentos.length >= 12) return;
    setForm(f => ({ ...f, depoimentos: [...f.depoimentos, { texto: '', nome: '', negocio: '' }] }));
  }

  function removerDepoimento(i: number) {
    setForm(f => ({ ...f, depoimentos: f.depoimentos.filter((_, idx) => idx !== i) }));
  }

  function upDestaque(i: number, campo: keyof LandingDestaque, valor: string) {
    setForm(f => ({ ...f, destaques: f.destaques.map((d, idx) => idx === i ? { ...d, [campo]: valor } as LandingDestaque : d) }));
  }

  function adicionarDestaque() {
    if (form.destaques.length >= 4) return;
    setForm(f => ({ ...f, destaques: [...f.destaques, { imagem_url: '', titulo: '', desc: '', formato: 'navegador' }] }));
  }

  function removerDestaque(i: number) {
    setForm(f => ({ ...f, destaques: f.destaques.filter((_, idx) => idx !== i) }));
  }

  function upPlano(i: number, campo: keyof LandingPlano, valor: unknown) {
    setForm(f => ({ ...f, planos: f.planos.map((p, idx) => idx === i ? { ...p, [campo]: valor } as LandingPlano : p) }));
  }
  function adicionarPlano() {
    if (form.planos.length >= 6) return;
    setForm(f => ({ ...f, planos: [...f.planos, { nome: '', preco: '', destaque: false, cta: 'Falar no WhatsApp', recursos: [] }] }));
  }
  function removerPlano(i: number) {
    setForm(f => ({ ...f, planos: f.planos.filter((_, idx) => idx !== i) }));
  }

  function upFaq(i: number, campo: keyof LandingFaq, valor: string) {
    setForm(f => ({ ...f, faq: f.faq.map((d, idx) => idx === i ? { ...d, [campo]: valor } : d) }));
  }
  function adicionarFaq() {
    if (form.faq.length >= 15) return;
    setForm(f => ({ ...f, faq: [...f.faq, { pergunta: '', resposta: '' }] }));
  }
  function removerFaq(i: number) {
    setForm(f => ({ ...f, faq: f.faq.filter((_, idx) => idx !== i) }));
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (form.recursos.some(r => !r.titulo.trim())) {
      mostrar({ tipo: 'erro', titulo: 'Todo recurso precisa de um título.' });
      return;
    }
    if (form.depoimentos.some(d => !d.texto.trim() || !d.nome.trim())) {
      mostrar({ tipo: 'erro', titulo: 'Todo depoimento precisa de texto e nome.' });
      return;
    }
    if (form.destaques.some(d => !d.titulo.trim())) {
      mostrar({ tipo: 'erro', titulo: 'Todo destaque precisa de um título.' });
      return;
    }
    if (form.planos.some(p => !p.nome.trim())) {
      mostrar({ tipo: 'erro', titulo: 'Todo plano precisa de um nome.' });
      return;
    }
    if (form.faq.some(f => !f.pergunta.trim())) {
      mostrar({ tipo: 'erro', titulo: 'Toda dúvida precisa de uma pergunta.' });
      return;
    }
    setEnviando(true);
    try {
      await api('PUT', '/api/admin/landing', {
        cta_texto: form.cta_texto,
        recursos: form.recursos,
        beneficios: form.beneficios.filter(b => b.trim()),
        comparativo_sem: form.comparativo_sem.filter(b => b.trim()),
        comparativo_com: form.comparativo_com.filter(b => b.trim()),
        segmentos: form.segmentos.filter(b => b.trim()),
        depoimentos: form.depoimentos,
        destaques: form.destaques,
        planos: form.planos.map(p => ({ ...p, recursos: p.recursos.filter(r => r.trim()) })),
        faq: form.faq,
        hero_eyebrow: form.hero_eyebrow,
        hero_titulo: form.hero_titulo,
        hero_subtitulo: form.hero_subtitulo,
        hero_imagem: form.hero_imagem,
        hero_imagem_mobile: form.hero_imagem_mobile,
        whatsapp: form.whatsapp,
        demo_url: form.demo_url,
      });
      mostrar({ tipo: 'sucesso', titulo: 'Landing page atualizada!' });
      consulta.refetch();
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally {
      setEnviando(false);
    }
  }

  const ABAS_LANDING = [
    { key: 'hero' as const, label: 'Topo', icone: LayoutTemplate },
    { key: 'geral' as const, label: 'Botão & benefícios', icone: Check },
    { key: 'recursos' as const, label: 'Recursos', icone: Store, count: form.recursos.length },
    { key: 'destaques' as const, label: 'Destaques', icone: ImageIcon, count: form.destaques.length },
    { key: 'comparativo' as const, label: 'Comparativo', icone: Users, count: form.comparativo_sem.filter(s => s.trim()).length + form.comparativo_com.filter(s => s.trim()).length },
    { key: 'segmentos' as const, label: 'Segmentos', icone: Store, count: form.segmentos.filter(s => s.trim()).length },
    { key: 'planos' as const, label: 'Planos', icone: Tag, count: form.planos.length },
    { key: 'faq' as const, label: 'Dúvidas', icone: HelpCircle, count: form.faq.length },
    { key: 'depoimentos' as const, label: 'Depoimentos', icone: Star, count: form.depoimentos.length },
  ];
  type AbaLanding = typeof ABAS_LANDING[number]['key'];
  const [aba, setAba] = useState<AbaLanding>('hero');

  return (
    <form onSubmit={salvar} className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="space-y-4 order-2 lg:order-1 min-w-0">
        <p className="text-xs text-muted-foreground rounded-lg bg-accent/50 px-3 py-2">
          Esta é a página que aparece no domínio principal (quando o "Modo de exibição" está em "Landing page do produto").
          O botão principal leva pra loja de demonstração automaticamente.
        </p>

        {/* Abas de navegação das seções */}
        <div className="flex flex-wrap gap-2">
          {ABAS_LANDING.map(a => (
            <button key={a.key} type="button" onClick={() => setAba(a.key)}
              className={cn(
                'flex shrink-0 items-center gap-2 rounded-xl border px-3.5 py-2 text-sm font-bold transition-all',
                aba === a.key
                  ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                  : 'border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground',
              )}>
              <a.icone className="size-4" />
              {a.label}
              {a.count !== undefined && a.count > 0 && (
                <span className={cn(
                  'rounded-full px-1.5 text-[10px] font-extrabold',
                  aba === a.key ? 'bg-primary-foreground/20' : 'bg-accent',
                )}>{a.count}</span>
              )}
            </button>
          ))}
        </div>

        <Card>
          <CardContent className="p-5 space-y-4">
            {aba === 'hero' && (
              <div className="space-y-4">
                <SecaoTituloEditor titulo="Topo da página (hero)" desc="A primeira coisa que o visitante vê: chamada grande, subtítulo e a imagem do produto." />
                <div>
                  <Label htmlFor="hero_eyebrow">Selo (texto pequeno acima do título)</Label>
                  <Input id="hero_eyebrow" maxLength={80} value={form.hero_eyebrow}
                    onChange={e => setForm(f => ({ ...f, hero_eyebrow: e.target.value }))}
                    placeholder="Sistema para deliveries e restaurantes" />
                </div>
                <div>
                  <Label htmlFor="hero_titulo">Título principal (chamada grande)</Label>
                  <textarea id="hero_titulo" maxLength={120} rows={2} value={form.hero_titulo}
                    onChange={e => setForm(f => ({ ...f, hero_titulo: e.target.value }))}
                    placeholder="Gestão simples, fácil e eficiente para seu negócio"
                    className="w-full px-3 py-2.5 rounded-xl border border-input bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring" />
                </div>
                <div>
                  <Label htmlFor="hero_subtitulo">Subtítulo</Label>
                  <textarea id="hero_subtitulo" maxLength={240} rows={2} value={form.hero_subtitulo}
                    onChange={e => setForm(f => ({ ...f, hero_subtitulo: e.target.value }))}
                    placeholder="Cardápio, pedidos, entrega e fiscal — tudo em um só sistema."
                    className="w-full px-3 py-2.5 rounded-xl border border-input bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring" />
                </div>
                <ImageUpload label="Print do painel (dentro do notebook do topo)"
                  value={form.hero_imagem} onChange={v => setForm(f => ({ ...f, hero_imagem: v }))} aspectRatio="wide" />
                <ImageUpload label="Print mobile (no celular sobreposto ao notebook)"
                  value={form.hero_imagem_mobile} onChange={v => setForm(f => ({ ...f, hero_imagem_mobile: v }))} aspectRatio="free" />
                <div>
                  <Label htmlFor="landing_whatsapp">WhatsApp (só números, com DDD)</Label>
                  <Input id="landing_whatsapp" maxLength={30} value={form.whatsapp}
                    onChange={e => setForm(f => ({ ...f, whatsapp: e.target.value }))}
                    placeholder="47999998888" />
                  <p className="text-xs text-muted-foreground mt-1">
                    Usado nos botões "Falar no WhatsApp", nos planos e no botão flutuante. Em branco, cai no telefone de suporte; sem nenhum, os botões de WhatsApp somem.
                  </p>
                </div>
              </div>
            )}

            {aba === 'geral' && (
              <div className="space-y-4">
                <SecaoTituloEditor titulo="Botão e benefícios" desc="Texto do botão principal e a listinha de benefícios com check." />
                <div>
                  <Label htmlFor="cta_texto">Texto do botão principal</Label>
                  <Input id="cta_texto" maxLength={60} value={form.cta_texto}
                    onChange={e => setForm(f => ({ ...f, cta_texto: e.target.value }))}
                    placeholder="Ver demonstração" />
                </div>
                <div>
                  <Label htmlFor="demo_url">Link do botão "Ver demonstração"</Label>
                  <Input id="demo_url" maxLength={300} value={form.demo_url}
                    onChange={e => setForm(f => ({ ...f, demo_url: e.target.value }))}
                    placeholder="/demo/unimaxx" />
                  <p className="text-xs text-muted-foreground mt-1">
                    Deixe em branco pra usar a 1ª loja aprovada deste cliente automaticamente.
                    Se a loja de demo for de outro cliente (tenant), use <code>/demo/&lt;slug-do-cliente&gt;</code> —
                    funciona sem precisar de domínio próprio configurado. Só cole uma URL completa (https://...)
                    se a demo já tiver domínio funcionando de verdade.
                  </p>
                </div>
                <ListaTextoEditavel titulo="Benefícios (check no topo e no rodapé)" max={6}
                  itens={form.beneficios} onChange={v => setForm(f => ({ ...f, beneficios: v }))} />
              </div>
            )}

            {aba === 'recursos' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">Cards da grade "Tudo que uma operação de delivery precisa". Máx. 9.</p>
                  <Button type="button" variant="outline" size="sm" onClick={adicionarRecurso} disabled={form.recursos.length >= 9}>
                    <Plus className="size-3.5" /> Adicionar
                  </Button>
                </div>
                {form.recursos.map((r, i) => {
                  const Icone = ICONES_LANDING[r.icone] || Store;
                  return (
                    <div key={i} className="rounded-xl border border-border p-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <select value={r.icone} onChange={e => upRecurso(i, 'icone', e.target.value)}
                          className="h-10 px-2 rounded-lg border border-input bg-background text-sm shrink-0">
                          {ICONES_DISPONIVEIS.map(k => <option key={k} value={k}>{k}</option>)}
                        </select>
                        <Icone className="size-4 text-primary shrink-0" />
                        <Input value={r.titulo} maxLength={60} placeholder="Título"
                          onChange={e => upRecurso(i, 'titulo', e.target.value)} />
                        <Button type="button" variant="ghost" size="icon" onClick={() => removerRecurso(i)}>
                          <Trash2 className="size-4 text-destructive" />
                        </Button>
                      </div>
                      <Input value={r.desc} maxLength={160} placeholder="Descrição curta"
                        onChange={e => upRecurso(i, 'desc', e.target.value)} />
                    </div>
                  );
                })}
                {form.recursos.length === 0 && (
                  <p className="text-xs text-muted-foreground">Nenhum recurso — usando os padrões embutidos.</p>
                )}
              </div>
            )}

            {aba === 'comparativo' && (
              <div className="space-y-5">
                <ListaTextoEditavel titulo="Sem a plataforma (lado esquerdo)" max={6} placeholder="Ex.: Erros nos pedidos"
                  itens={form.comparativo_sem} onChange={v => setForm(f => ({ ...f, comparativo_sem: v }))} />
                <ListaTextoEditavel titulo="Com a plataforma (lado direito)" max={6} placeholder="Ex.: Agilidade e organização"
                  itens={form.comparativo_com} onChange={v => setForm(f => ({ ...f, comparativo_com: v }))} />
              </div>
            )}

            {aba === 'segmentos' && (
              <ListaTextoEditavel titulo="Tipos de negócio" max={16} placeholder="Ex.: Pizzaria"
                itens={form.segmentos} onChange={v => setForm(f => ({ ...f, segmentos: v }))} />
            )}

            {aba === 'planos' && (
              <div className="space-y-3">
                <SecaoTituloEditor titulo="Planos" desc="Cards de preços. Os botões levam pro WhatsApp. Vazio = usa os planos padrão embutidos. Máx. 6." />
                <div className="flex justify-end">
                  <Button type="button" variant="outline" size="sm" onClick={adicionarPlano} disabled={form.planos.length >= 6}>
                    <Plus className="size-3.5" /> Adicionar plano
                  </Button>
                </div>
                {form.planos.map((p, i) => (
                  <div key={i} className="rounded-xl border border-border p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <Input value={p.nome} maxLength={40} placeholder="Nome (ex.: Profissional)" onChange={e => upPlano(i, 'nome', e.target.value)} />
                      <Input value={p.preco} maxLength={40} placeholder="Preço (ex.: R$ 197/mês)" onChange={e => upPlano(i, 'preco', e.target.value)} />
                      <Button type="button" variant="ghost" size="icon" onClick={() => removerPlano(i)}>
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    </div>
                    <div className="flex items-center gap-3">
                      <Input value={p.cta} maxLength={40} placeholder="Texto do botão" onChange={e => upPlano(i, 'cta', e.target.value)} />
                      <label className="flex shrink-0 items-center gap-1.5 text-xs font-medium">
                        <input type="checkbox" checked={!!p.destaque} onChange={e => upPlano(i, 'destaque', e.target.checked)} className="size-4 accent-[hsl(var(--primary))]" />
                        Destaque
                      </label>
                    </div>
                    <ListaTextoEditavel titulo="Itens do plano" max={12} placeholder="Ex.: NFC-e integrada"
                      itens={p.recursos} onChange={v => upPlano(i, 'recursos', v)} />
                  </div>
                ))}
                {form.planos.length === 0 && <p className="text-xs text-muted-foreground">Nenhum plano — usando os padrões embutidos.</p>}
              </div>
            )}

            {aba === 'faq' && (
              <div className="space-y-3">
                <SecaoTituloEditor titulo="Dúvidas frequentes" desc="Acordeão de perguntas e respostas. Vazio = usa as dúvidas padrão. Máx. 15." />
                <div className="flex justify-end">
                  <Button type="button" variant="outline" size="sm" onClick={adicionarFaq} disabled={form.faq.length >= 15}>
                    <Plus className="size-3.5" /> Adicionar dúvida
                  </Button>
                </div>
                {form.faq.map((d, i) => (
                  <div key={i} className="rounded-xl border border-border p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <Input value={d.pergunta} maxLength={160} placeholder="Pergunta" onChange={e => upFaq(i, 'pergunta', e.target.value)} />
                      <Button type="button" variant="ghost" size="icon" onClick={() => removerFaq(i)}>
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    </div>
                    <textarea value={d.resposta} maxLength={600} rows={2} placeholder="Resposta"
                      onChange={e => upFaq(i, 'resposta', e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-input bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring" />
                  </div>
                ))}
                {form.faq.length === 0 && <p className="text-xs text-muted-foreground">Nenhuma dúvida — usando as padrão.</p>}
              </div>
            )}

            {aba === 'depoimentos' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">Vazio = a seção some da landing. Máx. 12.</p>
                  <Button type="button" variant="outline" size="sm" onClick={adicionarDepoimento} disabled={form.depoimentos.length >= 12}>
                    <Plus className="size-3.5" /> Adicionar
                  </Button>
                </div>
                {form.depoimentos.map((d, i) => (
                  <div key={i} className="rounded-xl border border-border p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <textarea value={d.texto} maxLength={300} rows={2} placeholder="Depoimento"
                        onChange={e => upDepoimento(i, 'texto', e.target.value)}
                        className="flex-1 px-3 py-2 rounded-xl border border-input bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring" />
                      <Button type="button" variant="ghost" size="icon" onClick={() => removerDepoimento(i)}>
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    </div>
                    <div className="flex gap-2">
                      <Input value={d.nome} maxLength={60} placeholder="Nome" onChange={e => upDepoimento(i, 'nome', e.target.value)} />
                      <Input value={d.negocio} maxLength={60} placeholder="Negócio (opcional)" onChange={e => upDepoimento(i, 'negocio', e.target.value)} />
                    </div>
                  </div>
                ))}
                {form.depoimentos.length === 0 && (
                  <p className="text-xs text-muted-foreground">Nenhum depoimento ainda.</p>
                )}
              </div>
            )}

            {aba === 'destaques' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">Blocos grandes com imagem, tipo "vitrine" de uma funcionalidade. Máx. 4.</p>
                  <Button type="button" variant="outline" size="sm" onClick={adicionarDestaque} disabled={form.destaques.length >= 4}>
                    <Plus className="size-3.5" /> Adicionar
                  </Button>
                </div>
                {form.destaques.map((d, i) => (
                  <div key={i} className="rounded-xl border border-border p-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <ImageUpload label="Imagem" value={d.imagem_url}
                        onChange={v => upDestaque(i, 'imagem_url', v)} aspectRatio="wide" />
                      <Button type="button" variant="ghost" size="icon" onClick={() => removerDestaque(i)}>
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    </div>
                    <div>
                      <Label className="text-xs">Moldura da imagem</Label>
                      <select value={d.formato || 'navegador'} onChange={e => upDestaque(i, 'formato', e.target.value)}
                        className="w-full h-10 px-2 rounded-lg border border-input bg-background text-sm">
                        <option value="navegador">Navegador (desktop)</option>
                        <option value="celular">Celular (mobile)</option>
                        <option value="livre">Sem moldura (imagem solta)</option>
                      </select>
                    </div>
                    <Input value={d.titulo} maxLength={80} placeholder="Título"
                      onChange={e => upDestaque(i, 'titulo', e.target.value)} />
                    <textarea value={d.desc} maxLength={240} rows={2} placeholder="Descrição"
                      onChange={e => upDestaque(i, 'desc', e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-input bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring" />
                  </div>
                ))}
                {form.destaques.length === 0 && (
                  <p className="text-xs text-muted-foreground">Nenhum destaque ainda.</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Button type="submit" disabled={enviando}>
          <Save className="size-4" />
          {enviando ? 'Salvando…' : 'Salvar landing page'}
        </Button>
      </div>

      <div className="order-1 lg:order-2">
        <div className="lg:sticky lg:top-4 space-y-2">
          <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <Eye className="size-3.5" /> Pré-visualização ao vivo
          </div>
          <PreviewLanding form={form} />
        </div>
      </div>
    </form>
  );
}

/**
 * Preview ao vivo = a própria landing pública (`/?preview=1`) dentro de um
 * <iframe> same-origin, recebendo o estado ainda não salvo via postMessage —
 * mesmo padrão do preview da loja (visual/PhonePreview.tsx). Não é um mockup
 * à parte: é literalmente o mesmo componente que o visitante vê, então nunca
 * diverge da página real (era esse o problema do mock anterior — ficava pra
 * trás toda vez que a landing mudava de estrutura).
 */
function PreviewLanding({ form }: { form: LandingConfig }) {
  const [pronto, setPronto] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    function aoReceberMensagem(e: MessageEvent) {
      if (e.origin !== window.location.origin) return;
      if (e.data?.type === 'preview-ready') setPronto(true);
    }
    window.addEventListener('message', aoReceberMensagem);
    return () => window.removeEventListener('message', aoReceberMensagem);
  }, []);

  useEffect(() => {
    if (!pronto) return;
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    win.postMessage({
      type: 'landing-preview',
      payload: {
        landing_cta_texto: form.cta_texto,
        landing_recursos: form.recursos,
        landing_beneficios: form.beneficios,
        landing_comparativo_sem: form.comparativo_sem,
        landing_comparativo_com: form.comparativo_com,
        landing_segmentos: form.segmentos,
        landing_depoimentos: form.depoimentos,
        landing_destaques: form.destaques,
        landing_planos: form.planos,
        landing_faq: form.faq,
        landing_hero_eyebrow: form.hero_eyebrow,
        landing_hero_titulo: form.hero_titulo,
        landing_hero_subtitulo: form.hero_subtitulo,
        landing_hero_imagem: form.hero_imagem,
        landing_hero_imagem_mobile: form.hero_imagem_mobile,
        landing_whatsapp: form.whatsapp,
        landing_demo_url: form.demo_url,
      },
    }, window.location.origin);
  }, [form, pronto]);

  function recarregar() {
    setPronto(false);
    const el = iframeRef.current;
    if (el) el.src = el.src;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-end">
        <button type="button" onClick={recarregar} title="Recarregar preview"
          className="flex size-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground">
          <RefreshCw className="size-3.5" />
        </button>
      </div>
      <div className="rounded-2xl border-2 border-dashed border-border p-2 bg-muted/30">
        <div className="rounded-xl overflow-hidden border border-border bg-background shadow-sm">
          <iframe
            ref={iframeRef}
            src="/?preview=1"
            title="Pré-visualização da landing"
            className="w-full border-0 bg-white"
            style={{ height: '70vh' }}
            onLoad={() => setPronto(false)}
          />
        </div>
      </div>
      <p className="text-[10px] text-center text-muted-foreground">
        É a página real, ao vivo — não um mockup.
      </p>
    </div>
  );
}

/**
 * Backup manual completo: dump SQL (mysqldump) de cada banco MySQL — o
 * central (registro de tenants) e o de cada tenant — mais a pasta `dados/`
 * do disco (uploads e certificados A1).
 */
function SecaoBackup() {
  const { mostrar } = useToast();
  const [baixando, setBaixando] = useState(false);

  async function baixar() {
    setBaixando(true);
    try {
      const token = tokenSessao();
      const resp = await fetch('/api/admin/backup', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!resp.ok) {
        const corpo = await resp.json().catch(() => ({}));
        throw new Error(corpo.erro || `Falha ao gerar o backup (HTTP ${resp.status}).`);
      }
      const blob = await resp.blob();
      const nome = resp.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1]
        || `backup-completo-${new Date().toISOString().slice(0, 10)}.tar.gz`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = nome;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      mostrar({ tipo: 'sucesso', titulo: 'Backup baixado!' });
    } catch (err) {
      mostrar({ tipo: 'erro', titulo: err instanceof Error ? err.message : 'Falha ao baixar o backup.' });
    } finally {
      setBaixando(false);
    }
  }

  return (
    <Card className="max-w-2xl border-amber-500/30">
      <CardContent className="p-5 space-y-3">
        <div className="flex items-center gap-2 text-sm font-bold">
          <DatabaseBackup className="size-4 text-amber-500" /> Backup do banco de dados
        </div>
        <p className="text-xs text-muted-foreground">
          Baixa um arquivo .tar.gz com o dump SQL de todos os bancos MySQL (plataforma + cada loja/tenant),
          mais os uploads e certificados A1. Recomendado baixar periodicamente, e sempre antes de uma
          migração ou manutenção grande no servidor.
        </p>
        <Button type="button" variant="outline" onClick={baixar} disabled={baixando}>
          {baixando ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
          {baixando ? 'Gerando backup…' : 'Baixar backup agora'}
        </Button>
      </CardContent>
    </Card>
  );
}

/* ───────────────────────── subcomponentes ───────────────────────── */

function Secao({ icone: Icone, titulo, children }: {
  icone: typeof Palette; titulo: string; children: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="flex items-center gap-2 text-sm font-bold">
          <Icone className="size-4 text-primary" /> {titulo}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

function CampoCor({ label, valor, onChange, permiteVazio }: {
  label: string; valor: string; onChange: (v: string) => void; permiteVazio?: boolean;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="flex items-center gap-3">
        <input type="color" value={valor || '#000000'}
          onChange={e => onChange(e.target.value)}
          className="h-11 w-14 rounded-xl border border-input cursor-pointer shrink-0" />
        <Input value={valor} onChange={e => onChange(e.target.value)}
          maxLength={7} placeholder={permiteVazio ? '— derivada da primária' : '#dc2640'}
          className="font-mono uppercase" />
        {permiteVazio && valor && (
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange('')}>
            Limpar
          </Button>
        )}
      </div>
    </div>
  );
}

/** Mock realista que reflete cor, cantos e fonte em tempo real. */
function PreviewApp({ form }: { form: TemaMarca }) {
  const fonte = FONTES[form.fonte]?.stack ?? FONTES.inter.stack;
  return (
    <div className="rounded-2xl border-2 border-dashed border-border p-3 bg-muted/30"
      style={{ fontFamily: fonte }}>
      <div className="rounded-xl overflow-hidden border border-border bg-background shadow-sm">
        {/* Header da marca */}
        <div className="flex items-center gap-2.5 p-3 border-b border-border">
          {form.logo_url ? (
            <img src={form.logo_url} alt="" className="size-9 rounded-xl object-cover" />
          ) : (
            <div className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground font-extrabold">
              {(form.nome || 'D').charAt(0)}
            </div>
          )}
          <div className="min-w-0">
            <div className="font-extrabold leading-tight truncate text-sm">{form.nome || 'Nome da marca'}</div>
            <div className="text-[11px] text-muted-foreground truncate">{form.slogan || 'Seu slogan aqui'}</div>
          </div>
        </div>

        {/* Conteúdo mock */}
        <div className="p-3 space-y-3">
          {/* Card de produto */}
          <div className="flex gap-3 rounded-xl border border-border p-2.5">
            <div className="size-14 rounded-lg bg-accent shrink-0 flex items-center justify-center text-xl">🍔</div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-sm leading-tight">X-Burguer Especial</div>
              <div className="text-[11px] text-muted-foreground line-clamp-1">Pão, carne, queijo e bacon</div>
              <div className="mt-1 flex items-center gap-2">
                <span className="font-bold text-sm">R$ 24,90</span>
                <Badge variant="success" className="text-[9px] px-1.5">Promo</Badge>
              </div>
            </div>
          </div>

          {/* Chips */}
          <div className="flex gap-1.5 flex-wrap">
            <span className="rounded-full bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground">Selecionado</span>
            <span className="rounded-full bg-accent text-accent-foreground px-2.5 py-1 text-[11px] font-semibold">Lanches</span>
            <span className="rounded-full border border-border px-2.5 py-1 text-[11px] font-semibold">Bebidas</span>
          </div>

          {/* Botões */}
          <div className="flex gap-2">
            <Button size="sm" className="flex-1">Adicionar</Button>
            <Button size="sm" variant="outline">Ver mais</Button>
          </div>
        </div>
      </div>
      <p className="text-[10px] text-center text-muted-foreground mt-2">
        É assim que o cliente vê o app.
      </p>
    </div>
  );
}
