import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LifeBuoy, MessageCircle, CheckCircle2, DatabaseBackup, Download, Loader2, Save, CreditCard, FlaskConical, Rocket } from 'lucide-react';
import { AdminLayout } from './layout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import { api, ApiError, tokenSessao } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Secao } from './marca/campos';
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

/**
 * Configurações da plataforma — suporte, WhatsApp, Mercado Pago e backup.
 *
 * Saiu de dentro da tela de Marca, onde vivia embaixo do editor de identidade:
 * pra chegar no WhatsApp ou no token do Mercado Pago era preciso rolar por
 * cores, fontes e SEO. Pior, a conexão do WBAPI ficava órfã no fim da página,
 * longe da configuração dela.
 *
 * Cada seção tem o próprio Salvar, como já era — os formulários são
 * independentes e salvar um nunca deve dar a impressão de salvar os outros.
 */
export function TelaConfiguracoes() {
  return (
    <AdminLayout titulo="Configurações">
      <div className="mx-auto max-w-3xl space-y-4">
        <div>
          <h1 className="text-xl font-bold">Configurações</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Suporte, integrações e backup da plataforma.
          </p>
        </div>
        {/* A conexão do WhatsApp é renderizada DENTRO de SecaoConfiguracoesGerais,
            logo abaixo do servidor/sessão que ela usa — e só quando há o que
            conectar. Antes ela ficava aqui embaixo, longe da própria config. */}
        <SecaoConfiguracoesGerais />
        <SecaoBackup />
      </div>
    </AdminLayout>
  );
}
