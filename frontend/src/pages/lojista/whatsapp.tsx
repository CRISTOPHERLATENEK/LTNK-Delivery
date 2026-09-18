/**
 * Configuração de WhatsApp do lojista — dois métodos possíveis, cada um só
 * aparece se o admin liberou pra esta loja (ver painel admin → Lojas):
 *  - Oficial (Meta Cloud API): credenciais que o lojista obtém no Business
 *    Manager da Meta, mais robusto e sem risco de banimento de número.
 *  - Não oficial (QR code): mais simples de ligar, mas fora dos termos do
 *    WhatsApp — ainda não implementado nesta versão (placeholder abaixo).
 */
import { useEffect, useState } from 'react';
import { Loader2, CheckCircle2, Send, Info, QrCode, Smartphone } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';

interface ConfigWhatsApp {
  permite_oficial: boolean;
  permite_nao_oficial: boolean;
  metodo_ativo: 'nenhum' | 'oficial' | 'nao_oficial';
  enviar_confirmacao: boolean;
  oficial: {
    numero: string; phone_id: string; business_id: string; template: string; tem_token: boolean;
  };
  nao_oficial: {
    status: 'desconectado' | 'conectando' | 'conectado' | string;
    disponivel: boolean;
    numero?: string;
    /**
     * ESTA LOJA TEM CONEXÃO PRÓPRIA — é o que decide se o QR aparece aqui.
     *
     * Com token próprio (cadastrado pelo admin para este cliente), quem pareia o
     * número é o lojista, nesta tela. Sem ele, a loja usa a sessão compartilhada
     * da plataforma e o cartão continua só de leitura: parear ali sequestraria o
     * número de todos os outros clientes.
     */
    conexao_propria?: boolean;
  };
}

/** Glifo oficial do WhatsApp (marca) — usa currentColor, herda a cor do pai. */
function WhatsAppLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.71.306 1.263.489 1.694.625.712.227 1.36.195 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893A11.821 11.821 0 0020.885 3.488"/>
    </svg>
  );
}

/**
 * `semCabecalho` existe porque esta tela passou a viver DENTRO do modal de
 * Integrações, que já mostra o logo e o nome no topo. Repetir os dois viraria
 * "WhatsApp" duas vezes na mesma janela.
 */
export function WhatsAppLoja({ semCabecalho = false }: { semCabecalho?: boolean } = {}) {
  const { mostrar } = useToast();
  const [cfg, setCfg] = useState<ConfigWhatsApp | null>(null);
  const [form, setForm] = useState({ numero: '', phone_id: '', business_id: '', template: 'confirmacao_pedido', token: '' });
  const [salvando, setSalvando] = useState(false);
  const [testando, setTestando] = useState(false);
  const [aplicandoMetodo, setAplicandoMetodo] = useState(false);

  function carregar() {
    api<ConfigWhatsApp>('GET', '/api/lojista/whatsapp').then(r => {
      setCfg(r);
      setForm({ numero: r.oficial.numero, phone_id: r.oficial.phone_id, business_id: r.oficial.business_id, template: r.oficial.template, token: '' });
    }).catch(() => mostrar({ tipo: 'erro', titulo: 'Não foi possível carregar a configuração de WhatsApp.' }));
  }
  useEffect(() => { carregar(); }, []);

  async function salvarOficial(e: React.FormEvent) {
    e.preventDefault();
    setSalvando(true);
    try {
      await api('PUT', '/api/lojista/whatsapp/oficial', form);
      mostrar({ tipo: 'sucesso', titulo: 'Credenciais salvas!' });
      setForm(f => ({ ...f, token: '' }));
      carregar();
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally { setSalvando(false); }
  }

  async function testar() {
    setTestando(true);
    try {
      await api('POST', '/api/lojista/whatsapp/oficial/testar');
      mostrar({ tipo: 'sucesso', titulo: 'Conexão funcionando!' });
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally { setTestando(false); }
  }

  async function definirMetodo(metodo: 'nenhum' | 'oficial' | 'nao_oficial', enviarConfirmacao?: boolean) {
    setAplicandoMetodo(true);
    try {
      await api('PUT', '/api/lojista/whatsapp/ativo', {
        metodo, enviar_confirmacao: enviarConfirmacao ?? cfg?.enviar_confirmacao,
      });
      carregar();
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally { setAplicandoMetodo(false); }
  }

  if (!cfg) {
    return <div className="space-y-3"><Skeleton className="h-40 rounded-2xl" /></div>;
  }

  if (!cfg.permite_oficial && !cfg.permite_nao_oficial) {
    return (
      <Card>
        <CardContent className="p-8 text-center space-y-3">
          <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-[#25D366]/10">
            <WhatsAppLogo className="size-7 text-[#25D366]" />
          </div>
          <h2 className="font-bold">WhatsApp ainda não liberado</h2>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">
            Fale com o suporte da plataforma pra liberar o envio de mensagens de WhatsApp pra sua loja.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {!semCabecalho && (
        <div className="flex items-center gap-3">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-[#25D366] text-white">
            <WhatsAppLogo className="size-7" />
          </div>
          <div>
            <h2 className="text-lg font-bold">WhatsApp</h2>
          </div>
        </div>
      )}

      {/* Ativar / desativar */}
      <Card>
        <CardContent className="p-5 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="font-bold text-sm">WhatsApp ativo</div>
              <p className="text-xs text-muted-foreground">Liga ou desliga o envio de mensagens desta loja.</p>
            </div>
            <button
              type="button"
              disabled={aplicandoMetodo}
              aria-pressed={cfg.metodo_ativo !== 'nenhum'}
              onClick={() => {
                const ligar = cfg.metodo_ativo === 'nenhum';
                definirMetodo(ligar ? (cfg.permite_oficial ? 'oficial' : 'nao_oficial') : 'nenhum');
              }}
              className={cn(
                'relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-60',
                cfg.metodo_ativo !== 'nenhum' ? 'bg-[#25D366]' : 'bg-muted-foreground/30',
              )}
            >
              <span className={cn(
                'absolute top-0.5 size-6 rounded-full bg-white shadow transition-all',
                cfg.metodo_ativo !== 'nenhum' ? 'left-[22px]' : 'left-0.5',
              )} />
            </button>
          </div>

          {/* Escolha do método — só quando os dois estão liberados pelo admin */}
          {cfg.metodo_ativo !== 'nenhum' && cfg.permite_oficial && cfg.permite_nao_oficial && (
            <div className="border-t pt-3 space-y-2">
              <Label>Como enviar</Label>
              <div className="flex gap-2">
                <button type="button" disabled={aplicandoMetodo} onClick={() => definirMetodo('oficial')}
                  className={cn('flex-1 rounded-xl border-2 px-3 py-2 text-sm font-semibold transition-colors',
                    cfg.metodo_ativo === 'oficial' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-primary/40')}>
                  API oficial
                </button>
                <button type="button" disabled={aplicandoMetodo} onClick={() => definirMetodo('nao_oficial')}
                  className={cn('flex-1 rounded-xl border-2 px-3 py-2 text-sm font-semibold transition-colors',
                    cfg.metodo_ativo === 'nao_oficial' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-primary/40')}>
                  Não oficial (QR)
                </button>
              </div>
            </div>
          )}

          {/* Envio automático */}
          {cfg.metodo_ativo !== 'nenhum' && (
            <label className="flex items-start gap-2.5 cursor-pointer border-t pt-3">
              <input
                type="checkbox" checked={cfg.enviar_confirmacao} disabled={aplicandoMetodo}
                onChange={e => definirMetodo(cfg.metodo_ativo, e.target.checked)}
                className="accent-[#25D366] size-4 mt-0.5"
              />
              <span className="text-sm font-medium">Enviar confirmação automática quando o cliente fizer um pedido</span>
            </label>
          )}
        </CardContent>
      </Card>

      {/* Método oficial */}
      {cfg.permite_oficial && (
        <Card>
          <CardContent className="p-5 space-y-4">
            <div className="flex items-center gap-2">
              <h2 className="font-bold">API oficial (Meta)</h2>
              {cfg.oficial.tem_token && <Badge variant="success" className="text-[10px]"><CheckCircle2 className="size-3" /> configurado</Badge>}
            </div>
            <div className="flex items-start gap-2 rounded-xl bg-muted/50 px-3 py-2.5 text-xs text-muted-foreground">
              <Info className="size-3.5 shrink-0 mt-0.5" />
              <span>
                Precisa de uma conta no Meta Business Manager com um número de WhatsApp Business verificado e um
                modelo de mensagem (template) aprovado pra confirmação de pedido. As credenciais (Phone Number ID
                e token de acesso) ficam disponíveis lá no Business Manager.
              </span>
            </div>
            <form onSubmit={salvarOficial} className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>Número (com DDI, só dígitos)</Label>
                <Input value={form.numero} onChange={e => setForm(f => ({ ...f, numero: e.target.value.replace(/\D/g, '') }))}
                  placeholder="5511999999999" className="font-mono" />
              </div>
              <div>
                <Label>Phone Number ID *</Label>
                <Input required value={form.phone_id} onChange={e => setForm(f => ({ ...f, phone_id: e.target.value }))} className="font-mono" />
              </div>
              <div>
                <Label>Business Account ID</Label>
                <Input value={form.business_id} onChange={e => setForm(f => ({ ...f, business_id: e.target.value }))} className="font-mono" />
              </div>
              <div>
                <Label>Nome do template</Label>
                <Input value={form.template} onChange={e => setForm(f => ({ ...f, template: e.target.value }))} className="font-mono" />
              </div>
              <div className="sm:col-span-2">
                <Label>Token de acesso {cfg.oficial.tem_token && <span className="text-muted-foreground font-normal">(deixe vazio pra manter o atual)</span>}</Label>
                <Input type="password" value={form.token} onChange={e => setForm(f => ({ ...f, token: e.target.value }))}
                  placeholder={cfg.oficial.tem_token ? '••••••••••••' : 'Cole o token de acesso'} />
              </div>
              <div className="sm:col-span-2 flex gap-2 pt-1">
                <Button type="submit" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar credenciais'}</Button>
                {cfg.oficial.tem_token && (
                  <Button type="button" variant="outline" onClick={testar} disabled={testando}>
                    {testando ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                    {testando ? 'Testando…' : 'Testar conexão'}
                  </Button>
                )}
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Método não oficial — sessão única compartilhada da plataforma, conectada pelo super admin */}
      {cfg.permite_nao_oficial && <StatusNaoOficial nao_oficial={cfg.nao_oficial} />}
    </div>
  );
}

/** Status (somente leitura) do WhatsApp não-oficial — quem conecta/desconecta é o super admin, é uma sessão única da plataforma. */
function StatusNaoOficial({ nao_oficial }: { nao_oficial: ConfigWhatsApp['nao_oficial'] }) {
  if (!nao_oficial.disponivel) {
    return (
      <Card className="border-dashed">
        <CardContent className="p-5 space-y-2">
          <div className="flex items-center gap-2">
            <QrCode className="size-4 text-muted-foreground" />
            <h2 className="font-bold">Não oficial (QR code)</h2>
            <Badge variant="secondary" className="text-[10px]">indisponível</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            A plataforma ainda não configurou esse método. Fale com o suporte.
          </p>
        </CardContent>
      </Card>
    );
  }

  /* Com conexão própria o cartão vira operável: é o lojista que pareia. */
  if (nao_oficial.conexao_propria) return <ConexaoPropria inicial={nao_oficial} />;

  const conectado = nao_oficial.status === 'conectado';

  return (
    <Card>
      <CardContent className="p-5 flex items-center gap-3">
        <div className={cn(
          'flex size-11 items-center justify-center rounded-2xl shrink-0',
          conectado ? 'bg-[#25D366]/10 text-[#25D366]' : 'bg-muted text-muted-foreground',
        )}>
          <Smartphone className="size-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="font-bold">Não oficial (QR code)</h2>
            {conectado
              ? <Badge variant="success" className="text-[10px]"><CheckCircle2 className="size-3" /> conectado</Badge>
              : <Badge variant="secondary" className="text-[10px]">desconectado</Badge>}
          </div>
          <p className="text-sm text-muted-foreground">
            {conectado
              ? 'O WhatsApp compartilhado da plataforma está conectado — sua loja já pode usar esse método.'
              : 'Esse é um número de WhatsApp único, compartilhado por toda a plataforma. A conexão é feita pelo suporte/admin.'}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * O PAREAMENTO DO NÚMERO DA LOJA.
 *
 * Só aparece para quem tem conexão própria. O token nunca chega aqui: quem o
 * cadastra é o super admin, no painel dele, e esta tela só fala com as rotas
 * que já operam sobre a credencial do cliente.
 */
function ConexaoPropria({ inicial }: { inicial: ConfigWhatsApp['nao_oficial'] }) {
  const { mostrar } = useToast();
  const [status, setStatus] = useState(inicial.status);
  const [numero, setNumero] = useState(inicial.numero || '');
  const [aba, setAba] = useState<'qr' | 'codigo'>('qr');
  const [qr, setQr] = useState('');
  const [codigo, setCodigo] = useState('');
  const [telefone, setTelefone] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const conectado = status === 'conectado';

  /*
   * ENQUANTO NÃO CONECTA, PERGUNTA SOZINHO. O pareamento termina no celular do
   * lojista, não aqui: sem o polling, ele escaneia e a tela continua dizendo
   * "desconectado" até alguém recarregar — e a conclusão natural é que não
   * funcionou. Para quando conecta, que é quando não há mais o que esperar.
   */
  useEffect(() => {
    if (conectado) return;
    let vivo = true;
    const t = setInterval(async () => {
      try {
        const r = await api<ConfigWhatsApp>('GET', '/api/lojista/whatsapp');
        if (!vivo) return;
        setStatus(r.nao_oficial.status);
        setNumero(r.nao_oficial.numero || '');
        if (r.nao_oficial.status === 'conectado') setQr('');
      } catch { /* silencioso: é polling de fundo, erro aqui não é da pessoa */ }
    }, 4000);
    return () => { vivo = false; clearInterval(t); };
  }, [conectado]);

  async function gerarQr() {
    setOcupado(true);
    setCodigo('');
    try {
      const r = await api<{ qr: string }>('POST', '/api/lojista/whatsapp/nao-oficial/conectar');
      setQr(r.qr);
    } catch (e) {
      if (e instanceof ApiError) mostrar({ tipo: 'erro', titulo: e.message });
    } finally { setOcupado(false); }
  }

  async function gerarCodigo() {
    setOcupado(true);
    setQr('');
    try {
      const r = await api<{ codigo?: string }>('POST', '/api/lojista/whatsapp/nao-oficial/codigo', { telefone });
      setCodigo(r.codigo || '');
      if (!r.codigo) mostrar({ tipo: 'erro', titulo: 'A API não devolveu o código. Tente pelo QR code.' });
    } catch (e) {
      if (e instanceof ApiError) mostrar({ tipo: 'erro', titulo: e.message });
    } finally { setOcupado(false); }
  }

  async function desconectar() {
    setOcupado(true);
    try {
      await api('POST', '/api/lojista/whatsapp/nao-oficial/desconectar');
      setStatus('desconectado');
      setNumero('');
      mostrar({ tipo: 'sucesso', titulo: 'WhatsApp desconectado.' });
    } catch (e) {
      if (e instanceof ApiError) mostrar({ tipo: 'erro', titulo: e.message });
    } finally { setOcupado(false); }
  }

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="flex items-center gap-2">
          <QrCode className="size-4 text-muted-foreground" />
          <h2 className="font-bold">Não oficial (QR code)</h2>
          {conectado
            ? <Badge variant="success" className="text-[10px]"><CheckCircle2 className="size-3" /> conectado</Badge>
            : <Badge variant="secondary" className="text-[10px]">desconectado</Badge>}
        </div>

        {conectado ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              O WhatsApp da sua loja está conectado{numero ? ` (${numero})` : ''} e já envia as mensagens dos pedidos.
            </p>
            <Button variant="outline" onClick={desconectar} disabled={ocupado}>
              {ocupado && <Loader2 className="size-4 animate-spin" />} Desconectar
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="inline-flex rounded-lg bg-muted p-1 text-sm">
              {([['qr', 'QR code'], ['codigo', 'Código']] as const).map(([v, rotulo]) => (
                <button
                  key={v} type="button" onClick={() => setAba(v)}
                  className={cn('rounded-md px-3 py-1.5 transition-colors',
                    aba === v ? 'bg-background font-semibold shadow-sm' : 'text-muted-foreground')}
                >{rotulo}</button>
              ))}
            </div>

            {aba === 'qr' ? (
              <div className="space-y-3 text-center">
                {qr
                  ? <img src={qr} alt="QR code para conectar o WhatsApp" className="mx-auto size-56 rounded-xl border bg-white p-2" />
                  : (
                    <div className="mx-auto flex size-56 items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground">
                      Gere o QR code para começar
                    </div>
                  )}
                <p className="text-xs text-muted-foreground">
                  Abra o WhatsApp no celular → Aparelhos conectados → Conectar um aparelho, e escaneie este código.
                </p>
                <Button variant="outline" onClick={gerarQr} disabled={ocupado}>
                  {ocupado && <Loader2 className="size-4 animate-spin" />} {qr ? 'Gerar novo QR code' : 'Gerar QR code'}
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="wa-tel">Número do WhatsApp da loja</Label>
                  <Input id="wa-tel" value={telefone} onChange={e => setTelefone(e.target.value)}
                    placeholder="(47) 99999-9999" inputMode="tel" />
                </div>
                <Button variant="outline" onClick={gerarCodigo} disabled={ocupado || !telefone.trim()}>
                  {ocupado && <Loader2 className="size-4 animate-spin" />} Gerar código
                </Button>
                {codigo && (
                  <div className="rounded-lg border bg-muted/40 p-3 text-center">
                    <p className="text-xs text-muted-foreground">Digite no WhatsApp do celular</p>
                    <p className="font-mono text-2xl font-bold tracking-widest">{codigo}</p>
                  </div>
                )}
              </div>
            )}

            <p className="text-xs text-muted-foreground">Aguardando você conectar no celular… (atualiza sozinho)</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
