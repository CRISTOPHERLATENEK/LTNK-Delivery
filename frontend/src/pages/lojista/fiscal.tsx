/**
 * Configuração fiscal (NFC-e) do lojista: dados do emitente, CSC, ambiente,
 * padrões de NCM/CFOP/CSOSN e dados por produto.
 */
import { useEffect, useRef, useState } from 'react';
import {
  FileText, ShieldCheck, Upload, AlertTriangle, CheckCircle2, Save, FlaskConical,
  Download, X, Package, ChevronDown, ChevronUp, Ban, RefreshCw, Receipt, Loader2, FolderArchive, Mail,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { api, ApiError, tokenSessao } from '@/lib/api';
import { imprimirDanfe, type DadosDanfe } from '@/lib/impressao';
import { buscarCnpj, formatarCnpj, cnpjDigitos } from '@/lib/cnpj';
import { cn } from '@/lib/utils';

interface FiscalConfig {
  ativo: 0 | 1; cnpj: string; ie: string; razao_social: string; nome_fantasia: string;
  crt: number; uf: string; cmun: string; municipio: string;
  logradouro: string; numero: string; bairro: string; cep: string;
  csc_id: string; ambiente: number; serie: number; proximo_numero: number; tem_csc: boolean;
  ncm_padrao: string; cfop_padrao: string; csosn_padrao: string;
}
interface FiscalCert { instalado: boolean; titular: string | null; validade: string | null; }
interface Contador {
  email: string; envio_auto: boolean; dia_envio: number;
  ultima_competencia: string; ultimo_envio_em: string; ultimo_erro: string;
  email_configurado: boolean;
}
interface Competencia {
  competencia: string; notas: number; autorizadas: number; canceladas: number; total_centavos: number;
}
interface ResultadoSefaz {
  autorizada: boolean; c_stat: string; motivo: string; protocolo: string; chave: string; numero: number;
}
interface NotaFiscal {
  id: number; pedido_id: number | null; serie: number; numero: number; chave: string;
  ambiente: number; status: 'pendente' | 'autorizada' | 'rejeitada' | 'cancelada' | 'erro';
  c_stat: string; motivo: string; protocolo: string; total_centavos: number;
  criado_em: string; autorizada_em: string;
}

const NOTA_STATUS: Record<NotaFiscal['status'], { label: string; cls: string }> = {
  autorizada: { label: 'Autorizada', cls: 'bg-green-500/15 text-green-600' },
  cancelada:  { label: 'Cancelada',  cls: 'bg-muted text-muted-foreground line-through' },
  rejeitada:  { label: 'Rejeitada',  cls: 'bg-red-500/15 text-red-600' },
  erro:       { label: 'Erro',       cls: 'bg-amber-500/15 text-amber-600' },
  pendente:   { label: 'Pendente',   cls: 'bg-muted text-muted-foreground' },
};
interface ProdutoFiscal {
  id: number; nome: string; categoria: string;
  ncm: string; cfop: string; csosn: string; origem: string; unidade_comercial: string; cest: string;
}

const ORIGENS = [
  { v: '0', l: '0 – Nacional' }, { v: '1', l: '1 – Estrangeira (importação direta)' },
  { v: '2', l: '2 – Estrangeira (adquirida no mercado interno)' },
  { v: '3', l: '3 – Nacional c/ >40% conteúdo estrangeiro' },
  { v: '4', l: '4 – Nacional (processos produtivos básicos)' },
  { v: '5', l: '5 – Nacional c/ ≤40% conteúdo estrangeiro' },
  { v: '6', l: '6 – Estrangeira c/ importação direta sem similar' },
  { v: '7', l: '7 – Estrangeira adquirida c/ similar nacional' },
  { v: '8', l: '8 – Nacional (produção por encomenda)' },
];

const CSOSNS = [
  { v: '102', l: '102 – Tributada sem permissão de crédito' },
  { v: '103', l: '103 – Isenção do ICMS no SN' },
  { v: '300', l: '300 – Imune' },
  { v: '400', l: '400 – Não tributada pelo SN' },
  { v: '500', l: '500 – ICMS cobrado anteriormente (ST/Monofásico)' },
  { v: '900', l: '900 – Outros' },
];

export function FiscalLoja() {
  const { mostrar } = useToast();
  const [cfg, setCfg] = useState<FiscalConfig | null>(null);
  const [cert, setCert] = useState<FiscalCert | null>(null);
  const [csc, setCsc] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [senhaCert, setSenhaCert] = useState('');
  const [subindoCert, setSubindoCert] = useState(false);
  const [teste, setTeste] = useState<(DadosDanfe & { xml: string; motivo_nao_assinado?: string }) | null>(null);
  const [gerandoTeste, setGerandoTeste] = useState(false);
  const [testandoSefaz, setTestandoSefaz] = useState(false);
  const [resultadoSefaz, setResultadoSefaz] = useState<ResultadoSefaz | null>(null);
  const [produtos, setProdutos] = useState<ProdutoFiscal[]>([]);
  const [produtosAberto, setProdutosAberto] = useState(false);
  const [produtosCarregando, setProdutosCarregando] = useState(false);
  const [produtosCarregados, setProdutosCarregados] = useState(false);
  const salvarProdutoTimer = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  const [notas, setNotas] = useState<NotaFiscal[]>([]);
  const [notasCarregando, setNotasCarregando] = useState(false);
  const [cancelando, setCancelando] = useState<number | null>(null);

  const [competencias, setCompetencias] = useState<Competencia[]>([]);
  const [mesEscolhido, setMesEscolhido] = useState('');
  const [baixandoZip, setBaixandoZip] = useState(false);

  const [contador, setContador] = useState<Contador | null>(null);
  const [salvandoContador, setSalvandoContador] = useState(false);
  const [enviandoContador, setEnviandoContador] = useState(false);

  function carregarContador() {
    api<Contador>('GET', '/api/lojista/nfce/contador')
      .then(setContador)
      .catch(() => { /* silencioso: a tela funciona sem esta parte */ });
  }

  async function salvarContador() {
    if (!contador) return;
    setSalvandoContador(true);
    try {
      await api('PUT', '/api/lojista/nfce/contador', {
        email: contador.email, envio_auto: contador.envio_auto, dia_envio: contador.dia_envio,
      });
      mostrar({ tipo: 'sucesso', titulo: 'Contador salvo.' });
      carregarContador();
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally {
      setSalvandoContador(false);
    }
  }

  async function enviarAgoraAoContador() {
    if (!mesEscolhido) return;
    setEnviandoContador(true);
    try {
      const r = await api<{ notas: number }>('POST', '/api/lojista/nfce/contador/enviar', { competencia: mesEscolhido });
      mostrar({ tipo: 'sucesso', titulo: `Enviado: ${r.notas} nota(s).`, descricao: 'O contador recebe o ZIP em anexo.' });
      carregarContador();
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally {
      setEnviandoContador(false);
    }
  }

  function carregarCompetencias() {
    api<{ competencias: Competencia[] }>('GET', '/api/lojista/nfce/competencias')
      .then(r => {
        setCompetencias(r.competencias);
        // Já vem no mês mais recente com nota: é o que o contador pede, e
        // ninguém abre esta tela pra baixar março de dois anos atrás.
        setMesEscolhido(m => m || (r.competencias[0]?.competencia ?? ''));
      })
      .catch(() => { /* silencioso: loja pode não ter emitido nada ainda */ });
  }

  /**
   * Baixa o ZIP do mês. Vai por `fetch` e não por link direto porque a rota
   * exige o token da sessão — um <a href> não manda cabeçalho nenhum.
   */
  async function baixarXmlsDoMes() {
    if (!mesEscolhido) return;
    setBaixandoZip(true);
    try {
      const resp = await fetch(`/api/lojista/nfce/xmls?competencia=${mesEscolhido}`, {
        headers: { Authorization: `Bearer ${tokenSessao('lojista')}` },
      });
      if (!resp.ok) {
        // O corpo de erro é JSON do servidor; a mensagem dele é mais útil que
        // um "falhou" genérico (ex.: mês só com nota de homologação).
        const erro = await resp.json().catch(() => null);
        throw new Error(erro?.erro || erro?.mensagem || 'Não foi possível gerar o arquivo.');
      }
      const blob = await resp.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `nfce-${mesEscolhido}.zip`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(a.href);
    } catch (err) {
      mostrar({ tipo: 'erro', titulo: err instanceof Error ? err.message : 'Não foi possível baixar.' });
    } finally {
      setBaixandoZip(false);
    }
  }

  const escolhida = competencias.find(c => c.competencia === mesEscolhido);

  function carregarNotas() {
    setNotasCarregando(true);
    api<{ notas: NotaFiscal[] }>('GET', '/api/lojista/nfce/notas')
      .then(r => setNotas(r.notas))
      .catch(() => { /* silencioso: aba pode não ter notas ainda */ })
      .finally(() => setNotasCarregando(false));
  }

  async function baixarXmlNota(id: number, chave: string) {
    try {
      const r = await api<{ nota: { xml: string } }>('GET', `/api/lojista/nfce/notas/${id}`);
      const blob = new Blob([r.nota.xml], { type: 'application/xml' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `nfce-${chave}.xml`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    }
  }

  async function cancelarNota(nota: NotaFiscal) {
    const justificativa = window.prompt('Motivo do cancelamento (15 a 255 caracteres):', '');
    if (justificativa === null) return;
    if (justificativa.trim().length < 15) {
      mostrar({ tipo: 'erro', titulo: 'A justificativa precisa de ao menos 15 caracteres.' });
      return;
    }
    setCancelando(nota.id);
    try {
      const r = await api<{ cancelada: boolean; motivo: string }>(
        'POST', `/api/lojista/nfce/notas/${nota.id}/cancelar`, { justificativa }
      );
      if (r.cancelada) {
        mostrar({ tipo: 'sucesso', titulo: 'NFC-e cancelada na SEFAZ.' });
        carregarNotas();
        carregarCompetencias();
      } else {
        mostrar({ tipo: 'erro', titulo: 'A SEFAZ recusou o cancelamento', descricao: r.motivo });
      }
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally { setCancelando(null); }
  }

  async function gerarTeste() {
    setGerandoTeste(true);
    try {
      const r = await api<DadosDanfe & { xml: string; motivo_nao_assinado?: string }>('POST', '/api/lojista/nfce/teste');
      setTeste(r);
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally { setGerandoTeste(false); }
  }

  async function testarSefaz() {
    setTestandoSefaz(true);
    setResultadoSefaz(null);
    try {
      const r = await api<ResultadoSefaz>('POST', '/api/lojista/nfce/testar-sefaz');
      setResultadoSefaz(r);
      mostrar(r.autorizada
        ? { tipo: 'sucesso', titulo: `Autorizada! NFC-e nº ${r.numero}` }
        : { tipo: 'erro', titulo: `Rejeitada (${r.c_stat})`, descricao: r.motivo });
    } catch (err) {
      if (err instanceof ApiError) {
        setResultadoSefaz({ autorizada: false, c_stat: '', motivo: err.message, protocolo: '', chave: '', numero: 0 });
        mostrar({ tipo: 'erro', titulo: err.message });
      }
    } finally { setTestandoSefaz(false); }
  }

  function baixarXml() {
    if (!teste) return;
    const blob = new Blob([teste.xml], { type: 'application/xml' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `nfce-teste-${teste.chave}.xml`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function carregar() {
    api<{ config: FiscalConfig; certificado: FiscalCert }>('GET', '/api/lojista/nfce')
      .then(r => { setCfg(r.config); setCert(r.certificado); })
      .catch(() => mostrar({ tipo: 'erro', titulo: 'Não foi possível carregar a configuração fiscal.' }));
  }

  function carregarProdutos() {
    setProdutosCarregando(true);
    api<{ produtos: ProdutoFiscal[] }>('GET', '/api/lojista/fiscal/produtos')
      .then(r => { setProdutos(r.produtos); setProdutosCarregados(true); })
      .catch(() => mostrar({ tipo: 'erro', titulo: 'Não foi possível carregar os produtos fiscais.' }))
      .finally(() => setProdutosCarregando(false));
  }

  useEffect(() => { carregar(); carregarNotas(); carregarCompetencias(); carregarContador(); }, []);

  useEffect(() => {
    if (produtosAberto && !produtosCarregados) carregarProdutos();
  }, [produtosAberto]);

  function editarProduto(id: number, campoProd: keyof ProdutoFiscal, valor: string) {
    setProdutos(ps => {
      const atualizado = ps.map(p => p.id === id ? { ...p, [campoProd]: valor } : p);
      clearTimeout(salvarProdutoTimer.current[id]);
      salvarProdutoTimer.current[id] = setTimeout(() => {
        const prod = atualizado.find(p => p.id === id);
        if (!prod) return;
        api('PUT', `/api/lojista/fiscal/produtos/${id}`, prod)
          .catch(() => mostrar({ tipo: 'erro', titulo: `Erro ao salvar produto #${id}` }));
      }, 800);
      return atualizado;
    });
  }

  function campo<K extends keyof FiscalConfig>(k: K, v: FiscalConfig[K]) {
    setCfg(c => (c ? { ...c, [k]: v } : c));
  }

  const [buscandoCnpj, setBuscandoCnpj] = useState(false);
  async function aoDigitarCnpj(bruto: string) {
    const digitos = cnpjDigitos(bruto);
    campo('cnpj', digitos);
    if (digitos.length !== 14) return;
    setBuscandoCnpj(true);
    const d = await buscarCnpj(digitos);
    setBuscandoCnpj(false);
    if (!d) { mostrar({ tipo: 'erro', titulo: 'CNPJ não encontrado.' }); return; }
    // Preenche só os campos vazios? Não — sobrescreve com os dados oficiais,
    // mantendo o que a Receita não fornece (IE) intacto.
    setCfg(c => c ? {
      ...c,
      cnpj: digitos,
      razao_social: d.razao_social || c.razao_social,
      nome_fantasia: d.nome_fantasia || c.nome_fantasia,
      uf: d.uf || c.uf,
      cmun: d.cmun || c.cmun,
      municipio: d.municipio || c.municipio,
      logradouro: d.logradouro || c.logradouro,
      numero: d.numero || c.numero,
      bairro: d.bairro || c.bairro,
      cep: d.cep || c.cep,
    } : c);
    mostrar({ tipo: 'sucesso', titulo: 'Dados do CNPJ preenchidos!' });
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!cfg) return;
    setEnviando(true);
    try {
      await api('PUT', '/api/lojista/nfce', { ...cfg, csc: csc || undefined });
      setCsc('');
      mostrar({ tipo: 'sucesso', titulo: 'Dados fiscais salvos!' });
      carregar();
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally { setEnviando(false); }
  }

  async function enviarCertificado() {
    if (!arquivo || !senhaCert) {
      mostrar({ tipo: 'erro', titulo: 'Escolha o arquivo .pfx e digite a senha.' });
      return;
    }
    setSubindoCert(true);
    try {
      const fd = new FormData();
      fd.append('certificado', arquivo);
      fd.append('senha', senhaCert);
      const resp = await fetch('/api/lojista/nfce/certificado', {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenSessao()}` },
        body: fd,
      });
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.erro || 'Falha no upload.');
      mostrar({ tipo: 'sucesso', titulo: 'Certificado instalado!', descricao: json.titular });
      setArquivo(null); setSenhaCert('');
      carregar();
    } catch (e) {
      mostrar({ tipo: 'erro', titulo: e instanceof Error ? e.message : 'Falha ao enviar o certificado.' });
    } finally { setSubindoCert(false); }
  }

  if (!cfg) return <Skeleton className="h-96" />;

  const validadeFmt = cert?.validade ? new Date(cert.validade).toLocaleDateString('pt-BR') : null;
  const venceProximo = cert?.validade ? (new Date(cert.validade).getTime() - Date.now()) < 30 * 864e5 : false;

  return (
    <div className="space-y-4">
      <Card className="border-amber-500/40 bg-amber-500/5">
        <CardContent className="p-4 text-xs text-muted-foreground flex gap-2">
          <AlertTriangle className="size-4 text-amber-500 shrink-0 mt-0.5" />
          <span>
            Emissão de NFC-e exige <strong>certificado A1</strong>, <strong>CSC</strong> (gerado no portal da SEFAZ do seu estado)
            e dados fiscais corretos. Confirme NCM/CSOSN com seu contador. Comece em <strong>homologação</strong>.
          </span>
        </CardContent>
      </Card>

      {/* Certificado A1 */}
      <Card>
        <CardContent className="p-5 space-y-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-primary" />
            <span className="font-bold text-sm">Certificado digital A1</span>
          </div>

          {cert?.instalado ? (
            <div className={cn('rounded-xl border p-3 flex items-start gap-3', venceProximo ? 'border-amber-500/50 bg-amber-500/5' : 'border-green-500/40 bg-green-500/5')}>
              <CheckCircle2 className={cn('size-5 shrink-0', venceProximo ? 'text-amber-500' : 'text-green-600')} />
              <div className="text-sm">
                <div className="font-semibold">{cert.titular}</div>
                <div className="text-xs text-muted-foreground">
                  Válido até {validadeFmt}{venceProximo && ' — vence em breve, renove!'}
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Nenhum certificado instalado.</p>
          )}

          <div>
            <Label>Arquivo do certificado (.pfx / .p12)</Label>
            <input
              type="file" accept=".pfx,.p12"
              onChange={e => setArquivo(e.target.files?.[0] || null)}
              className="mt-1 block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-primary file:px-3 file:py-2 file:text-primary-foreground file:font-semibold hover:file:bg-primary/90"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <div>
              <Label>Senha do certificado</Label>
              <Input type="password" value={senhaCert} onChange={e => setSenhaCert(e.target.value)} placeholder="••••••" />
            </div>
            <Button onClick={enviarCertificado} disabled={subindoCert || !arquivo || !senhaCert}>
              <Upload className="size-4" /> {subindoCert ? 'Enviando…' : (cert?.instalado ? 'Substituir' : 'Instalar')}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            O arquivo é guardado em pasta protegida no servidor e a senha fica criptografada. Não é compartilhado.
          </p>
        </CardContent>
      </Card>

      {/* Dados do emitente */}
      <Card>
        <CardContent className="p-5">
          <div className="flex items-center gap-2 mb-4">
            <FileText className="size-4 text-primary" />
            <span className="font-bold text-sm">Dados do emitente</span>
          </div>
          <form onSubmit={salvar} className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label>Razão social *</Label>
              <Input value={cfg.razao_social} onChange={e => campo('razao_social', e.target.value)} placeholder="Empresa LTDA" />
            </div>
            <div>
              <Label>Nome fantasia</Label>
              <Input value={cfg.nome_fantasia} onChange={e => campo('nome_fantasia', e.target.value)} placeholder="Pizzaria da Paula" />
            </div>
            <div>
              <Label>CNPJ *</Label>
              <div className="relative">
                <Input value={formatarCnpj(cfg.cnpj)} onChange={e => aoDigitarCnpj(e.target.value)}
                  placeholder="00.000.000/0000-00" maxLength={18} className="font-mono" inputMode="numeric" />
                {buscandoCnpj && <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 size-4 animate-spin text-muted-foreground" />}
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">Digite o CNPJ e os dados abaixo são preenchidos automaticamente.</p>
            </div>
            <div>
              <Label>Inscrição Estadual</Label>
              <Input value={cfg.ie} onChange={e => campo('ie', e.target.value)} placeholder="ISENTO ou número" />
            </div>
            <div>
              <Label>UF *</Label>
              <Input value={cfg.uf} onChange={e => campo('uf', e.target.value.toUpperCase().slice(0, 2))} placeholder="SP" maxLength={2} className="uppercase" />
            </div>
            <div>
              <Label>Cód. município (IBGE) *</Label>
              <Input value={cfg.cmun} onChange={e => campo('cmun', e.target.value.replace(/\D/g, ''))} placeholder="3550308" maxLength={7} className="font-mono" />
            </div>
            <div>
              <Label>Município</Label>
              <Input value={cfg.municipio} onChange={e => campo('municipio', e.target.value)} placeholder="São Paulo" />
            </div>
            <div className="sm:col-span-2 grid grid-cols-2 gap-3">
              <div><Label>Logradouro</Label><Input value={cfg.logradouro} onChange={e => campo('logradouro', e.target.value)} placeholder="Rua ..." /></div>
              <div><Label>Número</Label><Input value={cfg.numero} onChange={e => campo('numero', e.target.value)} placeholder="100" /></div>
            </div>
            <div><Label>Bairro</Label><Input value={cfg.bairro} onChange={e => campo('bairro', e.target.value)} placeholder="Centro" /></div>
            <div><Label>CEP</Label><Input value={cfg.cep} onChange={e => campo('cep', e.target.value.replace(/\D/g, ''))} placeholder="01001000" maxLength={8} className="font-mono" /></div>

            <div className="sm:col-span-2 border-t pt-4 mt-1 grid gap-4 sm:grid-cols-2">
              <div>
                <Label>CSC (token) {cfg.tem_csc && <span className="text-green-600 text-xs">✓ salvo</span>}</Label>
                <Input value={csc} onChange={e => setCsc(e.target.value)} placeholder={cfg.tem_csc ? 'Deixe vazio p/ manter' : 'Cole o CSC da SEFAZ'} className="font-mono" />
              </div>
              <div>
                <Label>ID do CSC</Label>
                <Input value={cfg.csc_id} onChange={e => campo('csc_id', e.target.value.replace(/\D/g, ''))} placeholder="000001" className="font-mono" />
              </div>
              <div>
                <Label>Ambiente</Label>
                <div className="mt-1.5 flex gap-2">
                  {([[2, 'Homologação'], [1, 'Produção']] as const).map(([v, txt]) => (
                    <button key={v} type="button" onClick={() => campo('ambiente', v)}
                      className={cn('flex-1 rounded-xl border-2 px-3 py-2 text-sm font-semibold transition-colors',
                        cfg.ambiente === v ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground')}>
                      {txt}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <Label>Série</Label>
                <Input type="number" min="1" value={cfg.serie} onChange={e => campo('serie', Number(e.target.value) || 1)} />
              </div>
            </div>

            <div className="sm:col-span-2 flex items-center justify-between border-t pt-4">
              <label className="flex items-center gap-2.5 cursor-pointer">
                <button type="button" onClick={() => campo('ativo', cfg.ativo ? 0 : 1)}
                  className={cn('relative h-6 w-11 rounded-full transition-colors', cfg.ativo ? 'bg-primary' : 'bg-muted-foreground/30')}>
                  <span className={cn('absolute top-0.5 size-5 rounded-full bg-white shadow transition-all', cfg.ativo ? 'left-[22px]' : 'left-0.5')} />
                </button>
                <span className="text-sm font-medium">Emitir NFC-e nas vendas</span>
              </label>
              <Button type="submit" disabled={enviando}>
                <Save className="size-4" /> {enviando ? 'Salvando…' : 'Salvar'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Padrões fiscais da loja */}
      <Card>
        <CardContent className="p-5">
          <div className="flex items-center gap-2 mb-1">
            <FileText className="size-4 text-primary" />
            <span className="font-bold text-sm">Padrões fiscais</span>
          </div>
          <p className="text-xs text-muted-foreground mb-4">
            Aplicados automaticamente nos produtos que não tiverem NCM/CFOP/CSOSN próprios.
          </p>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="text-xs font-semibold text-muted-foreground block mb-1">NCM padrão <span className="font-normal">(8 dígitos)</span></label>
              <Input
                value={cfg.ncm_padrao}
                onChange={e => campo('ncm_padrao', e.target.value.replace(/\D/g, '').slice(0, 8))}
                placeholder="21069090"
                className="font-mono"
                maxLength={8}
              />
              <p className="text-[10px] text-muted-foreground mt-0.5">Ex.: 21069090 = prep. alim. n.e.</p>
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground block mb-1">CFOP padrão</label>
              <select
                value={cfg.cfop_padrao}
                onChange={e => campo('cfop_padrao', e.target.value)}
                className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm font-mono"
              >
                <option value="5102">5102 – Venda dentro do estado (produto)</option>
                <option value="5405">5405 – Venda com ST (dentro do estado)</option>
                <option value="6102">6102 – Venda fora do estado (produto)</option>
                <option value="6108">6108 – Venda fora do estado (importado)</option>
                <option value="5949">5949 – Outra saída dentro do estado</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground block mb-1">CSOSN padrão</label>
              <select
                value={cfg.csosn_padrao}
                onChange={e => campo('csosn_padrao', e.target.value)}
                className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm font-mono"
              >
                {CSOSNS.map(c => <option key={c.v} value={c.v}>{c.l}</option>)}
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Dados fiscais por produto */}
      <Card>
        <CardContent className="p-0">
          <button
            type="button"
            className="flex w-full items-center justify-between px-5 py-4 text-left"
            onClick={() => setProdutosAberto(v => !v)}
          >
            <div className="flex items-center gap-2">
              <Package className="size-4 text-primary" />
              <span className="font-bold text-sm">Dados fiscais por produto</span>
              {produtos.length > 0 && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                  {produtos.length}
                </span>
              )}
            </div>
            {produtosAberto ? <ChevronUp className="size-4 text-muted-foreground" /> : <ChevronDown className="size-4 text-muted-foreground" />}
          </button>

          {produtosAberto && (
            <div className="border-t border-border">
              <p className="px-5 py-2 text-xs text-muted-foreground">
                Edite NCM, CFOP, CSOSN e Unidade individualmente. Salva automaticamente ao digitar.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/40">
                      <th className="px-4 py-2 text-left font-semibold text-muted-foreground min-w-[160px]">Produto</th>
                      <th className="px-2 py-2 text-left font-semibold text-muted-foreground w-[90px]">NCM</th>
                      <th className="px-2 py-2 text-left font-semibold text-muted-foreground w-[70px]">CFOP</th>
                      <th className="px-2 py-2 text-left font-semibold text-muted-foreground w-[70px]">CSOSN</th>
                      <th className="px-2 py-2 text-left font-semibold text-muted-foreground w-[120px]">Origem</th>
                      <th className="px-2 py-2 text-left font-semibold text-muted-foreground w-[60px]">Unid.</th>
                      <th className="px-2 py-2 text-left font-semibold text-muted-foreground w-[80px]">CEST</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {produtos.map(p => (
                      <tr key={p.id} className="hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-2">
                          <div className="font-medium leading-tight">{p.nome}</div>
                          <div className="text-[10px] text-muted-foreground">{p.categoria}</div>
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            value={p.ncm}
                            onChange={e => editarProduto(p.id, 'ncm', e.target.value.replace(/\D/g, '').slice(0, 8))}
                            placeholder={cfg.ncm_padrao || '21069090'}
                            maxLength={8}
                            className="w-full rounded border border-border bg-background px-1.5 py-1 font-mono text-xs focus:border-primary focus:outline-none"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            value={p.cfop}
                            onChange={e => editarProduto(p.id, 'cfop', e.target.value.replace(/\D/g, '').slice(0, 4))}
                            placeholder={cfg.cfop_padrao || '5102'}
                            maxLength={4}
                            className="w-full rounded border border-border bg-background px-1.5 py-1 font-mono text-xs focus:border-primary focus:outline-none"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <select
                            value={p.csosn}
                            onChange={e => editarProduto(p.id, 'csosn', e.target.value)}
                            className="w-full rounded border border-border bg-background px-1 py-1 font-mono text-xs focus:border-primary focus:outline-none"
                          >
                            <option value="">padrão</option>
                            {CSOSNS.map(c => <option key={c.v} value={c.v}>{c.v}</option>)}
                          </select>
                        </td>
                        <td className="px-2 py-1.5">
                          <select
                            value={p.origem}
                            onChange={e => editarProduto(p.id, 'origem', e.target.value)}
                            className="w-full rounded border border-border bg-background px-1 py-1 text-xs focus:border-primary focus:outline-none"
                          >
                            {ORIGENS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
                          </select>
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            value={p.unidade_comercial}
                            onChange={e => editarProduto(p.id, 'unidade_comercial', e.target.value.toUpperCase().slice(0, 6))}
                            placeholder="UN"
                            maxLength={6}
                            className="w-full rounded border border-border bg-background px-1.5 py-1 font-mono text-xs uppercase focus:border-primary focus:outline-none"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            value={p.cest}
                            onChange={e => editarProduto(p.id, 'cest', e.target.value.replace(/\D/g, '').slice(0, 7))}
                            placeholder="—"
                            maxLength={7}
                            className="w-full rounded border border-border bg-background px-1.5 py-1 font-mono text-xs focus:border-primary focus:outline-none"
                          />
                        </td>
                      </tr>
                    ))}
                    {produtosCarregando && (
                      <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">Carregando produtos…</td></tr>
                    )}
                    {!produtosCarregando && produtosCarregados && produtos.length === 0 && (
                      <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">Nenhum produto cadastrado.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Notas fiscais emitidas */}
      <Card>
        <CardContent className="p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Receipt className="size-4 text-primary" />
              <span className="font-bold text-sm">Notas fiscais emitidas</span>
              {notas.length > 0 && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">{notas.length}</span>
              )}
            </div>
            <button type="button" onClick={carregarNotas} className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground" title="Atualizar">
              <RefreshCw className={cn('size-4', notasCarregando && 'animate-spin')} />
            </button>
          </div>

          {notas.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              Nenhuma NFC-e emitida ainda. Emita a partir de uma venda concluída.
            </p>
          ) : (
            <div className="divide-y divide-border/60">
              {notas.map(n => {
                const st = NOTA_STATUS[n.status];
                return (
                  <div key={n.id} className="flex items-center gap-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm">nº {n.numero}/{n.serie}</span>
                        <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold', st.cls)}>{st.label}</span>
                        {n.ambiente === 2 && <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">homolog.</span>}
                        {n.pedido_id && <span className="text-[10px] text-muted-foreground">pedido #{n.pedido_id}</span>}
                      </div>
                      <div className="text-[10px] text-muted-foreground font-mono truncate mt-0.5">{n.chave}</div>
                      {(n.status === 'rejeitada' || n.status === 'erro') && n.motivo && (
                        <div className="text-[11px] text-red-600 mt-0.5 line-clamp-1">{n.c_stat} — {n.motivo}</div>
                      )}
                    </div>
                    <div className="text-sm font-bold tabular-nums shrink-0">
                      R$ {(n.total_centavos / 100).toFixed(2).replace('.', ',')}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button type="button" onClick={() => baixarXmlNota(n.id, n.chave)}
                        className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground" title="Baixar XML">
                        <Download className="size-4" />
                      </button>
                      {n.status === 'autorizada' && (
                        <button type="button" onClick={() => cancelarNota(n)} disabled={cancelando === n.id}
                          className="p-1.5 rounded-lg hover:bg-red-500/10 text-red-600 disabled:opacity-40" title="Cancelar NFC-e">
                          <Ban className="size-4" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/*
        XMLs DO MÊS PRO CONTADOR.
        Baixar nota por nota era inviável: um mês razoável tem centenas, e o
        contador precisa do lote inteiro, com o cancelamento junto de cada uma
        que foi cancelada.
      */}
      <Card>
        <CardContent className="space-y-3 p-5">
          <div className="flex items-center gap-2">
            <FolderArchive className="size-4 text-primary" />
            <span className="text-sm font-bold">XMLs do mês para o contador</span>
          </div>

          {competencias.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Nenhuma nota de produção emitida ainda. Notas de homologação não entram aqui —
              elas não têm valor fiscal e não servem para escrituração.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-[220px] flex-1">
                  <Label htmlFor="xml-mes">Mês</Label>
                  <select
                    id="xml-mes"
                    value={mesEscolhido}
                    onChange={e => setMesEscolhido(e.target.value)}
                    className="flex h-12 w-full rounded-xl border border-input bg-background px-4 text-base shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {competencias.map(c => (
                      <option key={c.competencia} value={c.competencia}>
                        {mesPorExtenso(c.competencia)} — {c.autorizadas} autorizada(s)
                        {c.canceladas > 0 ? `, ${c.canceladas} cancelada(s)` : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <Button type="button" onClick={baixarXmlsDoMes} disabled={baixandoZip || !mesEscolhido}>
                  {baixandoZip
                    ? <><Loader2 className="size-4 animate-spin" /> Preparando…</>
                    : <><Download className="size-4" /> Baixar ZIP</>}
                </Button>
              </div>

              {escolhida && (
                <p className="text-xs text-muted-foreground">
                  {escolhida.autorizadas} nota(s) autorizada(s)
                  {escolhida.canceladas > 0 && <>, {escolhida.canceladas} cancelada(s)</>}
                  {' · '}total autorizado R$ {(escolhida.total_centavos / 100).toFixed(2).replace('.', ',')}
                </p>
              )}

              <p className="text-xs text-muted-foreground">
                O ZIP traz um arquivo por nota (nomeado pela chave), o XML do evento de cancelamento
                quando houver, e um <span className="font-mono">relacao.csv</span> com número, chave,
                data, valor e situação — pro contador conferir se recebeu tudo sem abrir XML por XML.
              </p>
            </>
          )}

          {/*
            CADASTRO DO CONTADOR + ENVIO AUTOMÁTICO.
            Fica aqui e não numa tela à parte porque é a mesma decisão: quem
            acabou de baixar o mês pra mandar por e-mail é exatamente quem
            deveria ligar o automático e não fazer isso de novo.
          */}
          {contador && (
            <div className="space-y-3 border-t border-border pt-4">
              <div className="flex items-center gap-2">
                <Mail className="size-4 text-primary" />
                <span className="text-sm font-bold">Enviar direto pro contador</span>
              </div>

              <div>
                <Label htmlFor="contador-email">E-mail do contador</Label>
                <Input
                  id="contador-email"
                  type="text"
                  value={contador.email}
                  onChange={e => setContador(c => c && ({ ...c, email: e.target.value }))}
                  placeholder="contador@escritorio.com.br"
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Mais de um? Separe por vírgula (até 5).
                </p>
              </div>

              <label className="flex cursor-pointer items-start gap-2.5">
                <input
                  type="checkbox"
                  checked={contador.envio_auto}
                  onChange={e => setContador(c => c && ({ ...c, envio_auto: e.target.checked }))}
                  className="mt-0.5 size-4 shrink-0 accent-primary"
                />
                <span className="text-sm">
                  Enviar automaticamente todo mês
                  <span className="block text-[11px] text-muted-foreground">
                    No dia escolhido, manda os XMLs do <b>mês anterior</b> (fechado) sem você precisar entrar aqui.
                  </span>
                </span>
              </label>

              {contador.envio_auto && (
                <div className="flex flex-wrap items-end gap-2">
                  <div className="w-40">
                    <Label htmlFor="contador-dia">Dia do envio</Label>
                    <select
                      id="contador-dia"
                      value={contador.dia_envio}
                      onChange={e => setContador(c => c && ({ ...c, dia_envio: Number(e.target.value) }))}
                      className="flex h-12 w-full rounded-xl border border-input bg-background px-4 text-base shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {/* Até 28: dia 29-31 não existe em todo mês, e um envio
                          que pula fevereiro é pior que um dia antes. */}
                      {Array.from({ length: 28 }, (_, i) => i + 1).map(d => (
                        <option key={d} value={d}>dia {d}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              {/* Sem SMTP o automático nunca sai. Dizer isso ANTES é o que
                  evita o lojista ligar a chave e achar que resolveu. */}
              {contador.envio_auto && !contador.email_configurado && (
                <p className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
                  O envio de e-mail da plataforma não está configurado — nada será enviado até o suporte ligar o SMTP.
                </p>
              )}

              {contador.ultimo_erro && (
                <p className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  Último envio falhou: {contador.ultimo_erro}
                </p>
              )}

              {contador.ultima_competencia && !contador.ultimo_erro && (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <CheckCircle2 className="size-3.5 text-green-600" />
                  Último envio: {mesPorExtenso(contador.ultima_competencia)}
                  {contador.ultimo_envio_em && <> em {contador.ultimo_envio_em.slice(8, 10)}/{contador.ultimo_envio_em.slice(5, 7)}</>}
                </p>
              )}

              <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={salvarContador} disabled={salvandoContador}>
                  <Save className="size-4" /> {salvandoContador ? 'Salvando…' : 'Salvar'}
                </Button>
                {competencias.length > 0 && (
                  <Button type="button" variant="outline" onClick={enviarAgoraAoContador}
                    disabled={enviandoContador || !contador.email}>
                    {enviandoContador
                      ? <><Loader2 className="size-4 animate-spin" /> Enviando…</>
                      : <><Mail className="size-4" /> Enviar {mesEscolhido ? mesPorExtenso(mesEscolhido) : 'agora'}</>}
                  </Button>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Gerar NFC-e de teste */}
      <Card>
        <CardContent className="p-5 space-y-3">
          <div className="flex items-center gap-2">
            <FlaskConical className="size-4 text-primary" />
            <span className="font-bold text-sm">Gerar NFC-e de teste</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Monta o XML com seus dados fiscais + uma venda de exemplo e assina (se houver certificado).
            <strong> Não transmite à SEFAZ</strong> — serve só pra conferir o XML e a assinatura.
            Salve os dados acima antes de testar.
          </p>
          <Button type="button" onClick={gerarTeste} disabled={gerandoTeste}>
            <FlaskConical className="size-4" /> {gerandoTeste ? 'Gerando…' : 'Gerar XML de teste'}
          </Button>
        </CardContent>
      </Card>

      {/* Testar emissão REAL na SEFAZ (homologação) */}
      <Card>
        <CardContent className="p-5 space-y-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-primary" />
            <span className="font-bold text-sm">Testar emissão na SEFAZ</span>
            {cfg.ambiente === 2
              ? <span className="rounded-full bg-amber-500/15 text-amber-600 px-2 py-0.5 text-[10px] font-bold">homologação</span>
              : <span className="rounded-full bg-red-500/15 text-red-600 px-2 py-0.5 text-[10px] font-bold">PRODUÇÃO</span>}
          </div>
          <p className="text-xs text-muted-foreground">
            Emite uma NFC-e de exemplo e <strong>transmite de verdade</strong> à SEFAZ, mostrando o
            retorno (autorizada ou o motivo da recusa). Use pra validar certificado + CSC.
            Salve os dados acima antes. Precisa do certificado A1 instalado.
          </p>
          <Button type="button" onClick={testarSefaz} disabled={testandoSefaz || !cfg.ativo}>
            <ShieldCheck className="size-4" /> {testandoSefaz ? 'Transmitindo…' : 'Testar emissão na SEFAZ'}
          </Button>
          {!cfg.ativo && (
            <p className="text-[11px] text-amber-600">Ative "Emitir NFC-e nas vendas" acima antes de testar.</p>
          )}

          {resultadoSefaz && (
            <div className={cn(
              'rounded-xl border p-3 text-sm space-y-1',
              resultadoSefaz.autorizada ? 'border-green-500/40 bg-green-500/5' : 'border-red-500/40 bg-red-500/5',
            )}>
              <div className="flex items-center gap-2 font-bold">
                {resultadoSefaz.autorizada
                  ? <><CheckCircle2 className="size-4 text-green-600" /> <span className="text-green-700 dark:text-green-400">Autorizada! 🎉</span></>
                  : <><AlertTriangle className="size-4 text-red-600" /> <span className="text-red-700 dark:text-red-400">Rejeitada</span></>}
              </div>
              {resultadoSefaz.c_stat && <div className="text-xs"><span className="text-muted-foreground">cStat:</span> <span className="font-mono font-semibold">{resultadoSefaz.c_stat}</span></div>}
              <div className="text-xs"><span className="text-muted-foreground">Motivo:</span> {resultadoSefaz.motivo}</div>
              {resultadoSefaz.protocolo && <div className="text-xs"><span className="text-muted-foreground">Protocolo:</span> <span className="font-mono">{resultadoSefaz.protocolo}</span></div>}
              {resultadoSefaz.chave && <div className="text-[10px] text-muted-foreground font-mono break-all">{resultadoSefaz.chave}</div>}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Modal com o resultado */}
      {teste && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setTeste(null)}>
          <div className="w-full max-w-2xl rounded-2xl bg-card shadow-xl flex flex-col max-h-[85vh]" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b p-4">
              <h3 className="flex items-center gap-2 font-bold"><FlaskConical className="size-4 text-primary" /> NFC-e de teste</h3>
              <button onClick={() => setTeste(null)} className="p-1 rounded-lg hover:bg-accent text-muted-foreground"><X className="size-4" /></button>
            </div>
            <div className="p-4 space-y-2 overflow-auto">
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="rounded-full bg-muted px-2.5 py-1 font-mono">chave: {teste.chave}</span>
                {teste.assinado
                  ? <span className="rounded-full bg-green-500/15 text-green-600 px-2.5 py-1 font-semibold">✓ assinado</span>
                  : <span className="rounded-full bg-amber-500/15 text-amber-600 px-2.5 py-1 font-semibold">não assinado</span>}
                <span className="rounded-full bg-muted px-2.5 py-1">{teste.ambiente === 1 ? 'Produção' : 'Homologação'}</span>
              </div>
              {!teste.assinado && teste.motivo_nao_assinado && (
                <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="size-4 mt-0.5 shrink-0" />
                  <span>{teste.motivo_nao_assinado}</span>
                </div>
              )}
              <pre className="text-[10px] leading-tight bg-muted/50 rounded-lg p-3 overflow-auto whitespace-pre-wrap break-all max-h-[50vh]">{teste.xml}</pre>
            </div>
            <div className="border-t p-4 flex justify-end gap-2 flex-wrap">
              <Button variant="outline" onClick={() => setTeste(null)}>Fechar</Button>
              <Button variant="outline" onClick={baixarXml}><Download className="size-4" /> Baixar XML</Button>
              <Button onClick={() => imprimirDanfe(teste)}><FlaskConical className="size-4" /> Imprimir cupom fiscal</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const MESES_XML = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** '2026-07' -> 'julho de 2026'. Competência inválida volta como veio. */
function mesPorExtenso(competencia: string): string {
  const [ano, mes] = String(competencia || '').split('-').map(Number);
  const nome = MESES_XML[(mes || 0) - 1];
  return nome ? `${nome} de ${ano}` : String(competencia);
}
