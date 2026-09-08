import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LifeBuoy, MessageCircle, CheckCircle2, DatabaseBackup, Download, Loader2, Save, CreditCard, FlaskConical, Rocket } from 'lucide-react';
import { AdminLayout } from './layout';
import { Cabecalho } from './ui';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import { api, ApiError, tokenSessao } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Secao, Quadro, Linha } from './marca/campos';
interface ConfiguracoesGerais {
  suporte_email: string;
  suporte_telefone: string;
  termos_url: string;
  politica_url: string;
  termos_versao: string;
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
    suporte_email: '', suporte_telefone: '', termos_url: '', politica_url: '', termos_versao: '', wbapi_server: '', wbapi_session_id: '', wbapi_configurado: false,
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
        politica_url: form.politica_url,
        termos_versao: form.termos_versao,
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
          <Linha rotulo="E-mail de suporte">
            <input
              id="suporte_email" type="email" maxLength={200} value={form.suporte_email}
              onChange={e => setForm(f => ({ ...f, suporte_email: e.target.value }))}
              placeholder="suporte@suaempresa.com.br"
              className="h-[34px] w-full px-2.5 text-[13px] outline-none"
              style={{ border: '1px solid var(--adm-linha)', borderRadius: 4, boxSizing: 'border-box' }}
            />
          </Linha>
          <Linha rotulo="Telefone de suporte" apoio="Também usado no WhatsApp">
            <input
              id="suporte_telefone" maxLength={30} value={form.suporte_telefone}
              onChange={e => setForm(f => ({ ...f, suporte_telefone: e.target.value }))}
              placeholder="(11) 99999-9999"
              className="h-[34px] w-full px-2.5 text-[13px] outline-none"
              style={{ border: '1px solid var(--adm-linha)', borderRadius: 4, boxSizing: 'border-box' }}
            />
          </Linha>
          <Linha rotulo="Termos de uso" apoio="Vazio = a plataforma não exibe o link">
            <input
              id="termos_url" maxLength={500} value={form.termos_url}
              onChange={e => setForm(f => ({ ...f, termos_url: e.target.value }))}
              placeholder="https://…"
              className="h-[34px] w-full px-2.5 text-[13px] outline-none"
              style={{ border: '1px solid var(--adm-linha)', borderRadius: 4, boxSizing: 'border-box' }}
            />
          </Linha>
          {/*
            POLÍTICA SEPARADA DOS TERMOS porque são dois assuntos: termos é o
            contrato de uso, política é o que a LGPD pede — quais dados, para
            quê, por quanto tempo, e como a pessoa exerce os direitos dela. Um
            link só, chamado "termos", não cumpre o dever de informar.
          */}
          <Linha rotulo="Política de privacidade" apoio="Vazio = a plataforma não exibe o link">
            <input
              id="politica_url" maxLength={500} value={form.politica_url}
              onChange={e => setForm(f => ({ ...f, politica_url: e.target.value }))}
              placeholder="https://…"
              className="h-[34px] w-full px-2.5 text-[13px] outline-none"
              style={{ border: '1px solid var(--adm-linha)', borderRadius: 4, boxSizing: 'border-box' }}
            />
          </Linha>
          {/*
            A VERSÃO VAI GRAVADA NO ACEITE de cada pessoa. Sem ela, o registro
            diz "aceitou em tal data" e não diz O QUE aceitou — que é
            exatamente o que se pergunta quando os documentos mudam.
          */}
          <Linha rotulo="Versão publicada" apoio="Mude ao publicar documento novo · fica gravada em cada aceite">
            <input
              id="termos_versao" maxLength={40} value={form.termos_versao}
              onChange={e => setForm(f => ({ ...f, termos_versao: e.target.value }))}
              placeholder="2026-09-08"
              className="adm-num h-[34px] w-full px-2.5 text-[13px] outline-none"
              style={{ border: '1px solid var(--adm-linha)', borderRadius: 4, boxSizing: 'border-box' }}
            />
          </Linha>
      </Secao>

      <Secao icone={MessageCircle} titulo="WhatsApp não-oficial (WBAPI)">
        <p className="px-3 pt-2.5 text-[11.5px] leading-snug text-muted-foreground">
          Uma sessão única de WhatsApp, compartilhada por toda a plataforma (o plano contratado não permite
          criar uma sessão por loja) — as lojas com esse método liberado usam esse mesmo número pra confirmar
          pedidos. Sem isso configurado, só o método oficial (Meta) fica disponível.
        </p>
          <Linha rotulo="URL do servidor">
            <input
              id="wbapi_server" maxLength={300} value={form.wbapi_server}
              onChange={e => setForm(f => ({ ...f, wbapi_server: e.target.value }))}
              placeholder="https://api.deeliv.app"
              className="h-[34px] w-full px-2.5 text-[13px] outline-none"
              style={{ border: '1px solid var(--adm-linha)', borderRadius: 4, boxSizing: 'border-box' }}
            />
          </Linha>
          <Linha rotulo="Session ID">
            <input
              id="wbapi_session_id" maxLength={100} value={form.wbapi_session_id}
              onChange={e => setForm(f => ({ ...f, wbapi_session_id: e.target.value }))}
              placeholder="ID da sessão fornecido pelo provedor"
              className="adm-num h-[34px] w-full px-2.5 text-[13px] outline-none"
              style={{ border: '1px solid var(--adm-linha)', borderRadius: 4, boxSizing: 'border-box' }}
            />
          </Linha>
          {/* O "já configurada" vai no APOIO, e não numa linha verde embaixo do
              campo: é o estado do campo, e estado pertence ao rótulo. */}
          <Linha rotulo="X-Api-Key" apoio={form.wbapi_configurado ? 'Uma chave já está configurada · em branco mantém' : undefined}>
            <input
              id="wbapi_api_key" type="password" maxLength={300} value={wbapiApiKey}
              onChange={e => setWbapiApiKey(e.target.value)}
              placeholder={form.wbapi_configurado ? '•••••••••••••• (deixe em branco pra manter)' : 'Cole a chave aqui'}
              className="h-[34px] w-full px-2.5 text-[13px] outline-none"
              style={{ border: '1px solid var(--adm-linha)', borderRadius: 4, boxSizing: 'border-box' }}
            />
          </Linha>
      </Secao>

      <Secao icone={CreditCard} titulo="Mercado Pago (token da plataforma)">
        <p className="px-3 pt-2.5 text-[11.5px] leading-snug text-muted-foreground">
          Token usado como fallback do Pix pras lojas que não configuraram o próprio token. Guarde um token de
          teste (sandbox) e um de produção lado a lado, e escolha qual dos dois vale agora — dá pra testar o
          checkout sem risco de gerar cobrança real, e trocar pra produção só apertando o botão abaixo.
        </p>

        <div className="mx-3 mt-2.5 flex overflow-hidden rounded-lg border">
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
        <p className="px-3 pb-1 pt-1.5 text-[11.5px] leading-snug text-muted-foreground">
          {form.mercadopago_modo === 'teste'
            ? 'Ativo agora: token de TESTE — nenhum Pix gerado nessas lojas move dinheiro de verdade.'
            : 'Ativo agora: token de PRODUÇÃO — Pix gerado nessas lojas é uma cobrança real.'}
        </p>

          <Linha
            rotulo="Token de teste"
            apoio={form.mercadopago_token_teste_mascarado
              ? `Configurado: ${form.mercadopago_token_teste_mascarado}`
              : 'Começa com TEST-'}
          >
            <input
              id="mp_token_teste" type="password" maxLength={300} value={tokenTeste}
              onChange={e => setTokenTeste(e.target.value)}
              placeholder={form.mercadopago_token_teste_mascarado || 'Cole o token TEST-… aqui'}
              className="adm-num h-[34px] w-full px-2.5 text-[13px] outline-none"
              style={{ border: '1px solid var(--adm-linha)', borderRadius: 4, boxSizing: 'border-box' }}
            />
          </Linha>
          <Linha
            rotulo="Token de produção"
            apoio={form.mercadopago_token_producao_mascarado
              ? `Configurado: ${form.mercadopago_token_producao_mascarado}`
              : 'Começa com APP_USR- · cobrança real'}
          >
            <input
              id="mp_token_producao" type="password" maxLength={300} value={tokenProducao}
              onChange={e => setTokenProducao(e.target.value)}
              placeholder={form.mercadopago_token_producao_mascarado || 'Cole o token APP_USR-… aqui'}
              className="adm-num h-[34px] w-full px-2.5 text-[13px] outline-none"
              style={{ border: '1px solid var(--adm-linha)', borderRadius: 4, boxSizing: 'border-box' }}
            />
          </Linha>
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

interface CanalPainel {
  canal: 'estavel' | 'beta' | 'teste';
  rotulo: string;
  descricao: string;
  nota: string;
  lojas: number;
  funcionalidades: { chave: string; titulo: string; porque: string; dias: number }[];
}

/**
 * CANAIS DE LIBERAÇÃO: o que cada versão entrega, e o texto que você escreve.
 *
 * O catálogo (o que mudou no código) é gerado; a NOTA é escrita por gente. São
 * coisas diferentes e só a segunda serve para o lojista: "agora o pedido pode
 * entrar num caixa do Maxx Gestão" é catálogo; "estamos testando a integração
 * com o PDV, avise se o pedido não aparecer" é nota.
 *
 * A nota do canal aparece no painel de quem está nele — é assim que o lojista
 * descobre que optou por receber cedo, e que o atendimento descobre junto.
 */
function SecaoCanais() {
  const { mostrar } = useToast();
  const consulta = useQuery({
    queryKey: ['admin-canais'],
    queryFn: () => api<{ canais: CanalPainel[] }>('GET', '/api/admin/canais').then(r => r.canais),
  });

  const [rascunhos, setRascunhos] = useState<Record<string, string>>({});
  const [salvando, setSalvando] = useState<string | null>(null);

  /* O rascunho nasce do que veio do servidor e só existe enquanto se digita:
     assim o campo não "volta" ao recarregar a consulta no meio da edição. */
  const texto = (c: CanalPainel) => rascunhos[c.canal] ?? c.nota;
  const sujo = (c: CanalPainel) => texto(c) !== c.nota;

  async function salvarNota(c: CanalPainel) {
    setSalvando(c.canal);
    try {
      await api('PUT', `/api/admin/canais/${c.canal}/nota`, { nota: texto(c) });
      setRascunhos(r => { const n = { ...r }; delete n[c.canal]; return n; });
      await consulta.refetch();
      mostrar({ tipo: 'sucesso', titulo: `Nota do canal ${c.rotulo} salva` });
    } catch (e) {
      if (e instanceof ApiError) mostrar({ tipo: 'erro', titulo: e.message });
    } finally { setSalvando(null); }
  }

  if (consulta.isLoading) return null;

  return (
    <>
      {(consulta.data ?? []).map(c => (
        <Secao key={c.canal} titulo={`Canal ${c.rotulo}`}>
          <p className="px-3 pt-2.5 text-[12px] leading-relaxed text-muted-foreground">
            {c.descricao} · <b className="text-foreground">{c.lojas}</b>{' '}
            {c.lojas === 1 ? 'loja' : 'lojas'} neste canal.
          </p>

          {/* O QUE ESTE CANAL ENTREGA a mais que o anterior. */}
          {c.funcionalidades.length > 0 ? (
            <ul className="space-y-1.5 px-3 py-2.5">
              {c.funcionalidades.map(f => (
                <li key={f.chave} className="text-[12.5px] leading-relaxed">
                  <span className="font-medium">{f.titulo}</span>
                  {f.porque && <span className="text-muted-foreground"> — {f.porque}</span>}
                  {/*
                    HÁ QUANTOS DIAS está parada aqui. Sem esse número, canal vira
                    gaveta: nada lembra de decidir, e a funcionalidade fica em
                    beta para sempre. Quarenta dias na tela incomodam o
                    suficiente para alguém promover ou desistir.
                  */}
                  {f.dias > 0 && (
                    <span className="adm-num ml-1 text-[11px] text-muted-foreground">
                      há {f.dias}d
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-3 py-2.5 text-[12.5px] text-muted-foreground">
              {c.canal === 'estavel'
                ? 'Tudo que já foi promovido. Nada exclusivo deste canal.'
                : 'Nenhuma funcionalidade exclusiva deste canal no momento.'}
            </p>
          )}

          <Linha rotulo="Nota do canal" apoio="Aparece para os lojistas deste canal" empilhado>
            <textarea
              id={`nota-${c.canal}`}
              value={texto(c)}
              maxLength={2000}
              rows={3}
              onChange={e => setRascunhos(r => ({ ...r, [c.canal]: e.target.value }))}
              placeholder={c.canal === 'estavel'
                ? 'Opcional — quem está aqui não precisa ser avisado de nada.'
                : 'Ex.: você recebe novidades antes. Se algo parecer estranho, fale com a gente.'}
              className="mt-1 w-full rounded-[4px] border border-input bg-background px-2.5 py-2 text-[13px] outline-none"
            />
            <div className="mt-1.5 flex items-center gap-2">
              <Button type="button" size="sm" disabled={!sujo(c) || salvando === c.canal}
                onClick={() => void salvarNota(c)}>
                {salvando === c.canal ? 'Salvando…' : 'Salvar nota'}
              </Button>
              {sujo(c) && <span className="text-[11.5px] text-muted-foreground">não salvo</span>}
            </div>
            </Linha>
        </Secao>
      ))}
    </>
  );
}

export function TelaConfiguracoes() {
  return (
    <AdminLayout titulo="Configurações">
      {/* 620px: linha de leitura de formulário. Mais largo, o olho perde o
          começo da linha seguinte entre um campo e outro. */}
      <div className="mx-auto max-w-[620px]">
        <Cabecalho
          titulo="Configurações"
          subtitulo="Suporte, integrações e backup da plataforma"
        />
        {/* A conexão do WhatsApp é renderizada DENTRO de SecaoConfiguracoesGerais,
            logo abaixo do servidor/sessão que ela usa — e só quando há o que
            conectar. Antes ela ficava aqui embaixo, longe da própria config. */}
        <SecaoConfiguracoesGerais />
        <SecaoCanais />
        <SecaoBackup />
      </div>
    </AdminLayout>
  );
}
