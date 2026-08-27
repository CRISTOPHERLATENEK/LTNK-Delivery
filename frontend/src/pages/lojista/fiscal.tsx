/**
 * Configuração fiscal (NFC-e) do lojista.
 *
 * NAVEGAÇÃO POR ETAPAS, não formulário único. Emitir NFC-e depende de cinco
 * coisas em ordem — certificado, emitente, CSC, tributação, teste — e a versão
 * anterior mostrava as cinco de uma vez, num rolo de uns quarenta campos. Quem
 * abria não sabia por onde começar nem o que já estava pronto.
 *
 * Usa o MESMO desenho do resto do painel (Card, Button, Input, cor primária,
 * cantos arredondados). Uma tela com estética própria destoaria de todas as
 * outras abas de Configurações, que ficam a um clique de distância.
 *
 * Dado técnico continua em `font-mono`: número fiscal é conferido dígito a
 * dígito contra um papel, e em fonte proporcional 0/O e 1/l se confundem.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Ajuda } from '@/components/ui/ajuda';
import {
  FileText, ShieldCheck, Upload, AlertTriangle, CheckCircle2, Save, FlaskConical,
  Download, Package, Ban, RefreshCw, Receipt, Loader2, FolderArchive, Mail, Landmark,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
interface ProdutoFiscal {
  id: number; nome: string; categoria: string;
  ncm: string; cfop: string; csosn: string; origem: string; unidade_comercial: string; cest: string;
}

const NOTA_ROTULO: Record<NotaFiscal['status'], string> = {
  autorizada: 'Autorizada', cancelada: 'Cancelada', rejeitada: 'Rejeitada',
  erro: 'Erro', pendente: 'Pendente',
};

/** Cor do selo por situação, nas mesmas variantes usadas no resto do painel. */
const NOTA_BADGE: Record<NotaFiscal['status'], 'success' | 'secondary' | 'danger' | 'warning'> = {
  autorizada: 'success', cancelada: 'secondary', rejeitada: 'danger',
  erro: 'warning', pendente: 'secondary',
};

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

/**
 * CST do ICMS — o equivalente do CSOSN para quem NÃO é Simples Nacional.
 * O campo é o mesmo no banco; o que muda é o rótulo e a lista, porque mandar
 * um CSOSN numa nota de regime normal é rejeição na certa.
 */
const CSTS = [
  { v: '00', l: '00 – Tributada integralmente' },
  { v: '20', l: '20 – Com redução de base de cálculo' },
  { v: '40', l: '40 – Isenta' },
  { v: '41', l: '41 – Não tributada' },
  { v: '60', l: '60 – ICMS cobrado anteriormente por ST' },
  { v: '90', l: '90 – Outras' },
];

type Etapa = 1 | 2 | 3 | 4 | 5;

export function FiscalLoja() {
  const { mostrar } = useToast();
  const [etapa, setEtapa] = useState<Etapa>(1);

  const [cfg, setCfg] = useState<FiscalConfig | null>(null);
  /*
   * Cópia do que veio do servidor. É o que permite saber que há alteração não
   * salva — sem isso, a barra de salvar apareceria sempre ou nunca.
   */
  const [cfgSalvo, setCfgSalvo] = useState<FiscalConfig | null>(null);
  const [cert, setCert] = useState<FiscalCert | null>(null);
  const [csc, setCsc] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [editandoEmitente, setEditandoEmitente] = useState(false);
  const [trocandoCert, setTrocandoCert] = useState(false);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [senhaCert, setSenhaCert] = useState('');
  const [subindoCert, setSubindoCert] = useState(false);
  const [arrastando, setArrastando] = useState(false);
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
  const [buscandoCnpj, setBuscandoCnpj] = useState(false);

  const [competencias, setCompetencias] = useState<Competencia[]>([]);
  const [mesEscolhido, setMesEscolhido] = useState('');
  const [baixandoZip, setBaixandoZip] = useState(false);
  const [contador, setContador] = useState<Contador | null>(null);
  const [salvandoContador, setSalvandoContador] = useState(false);
  const [enviandoContador, setEnviandoContador] = useState(false);

  /* ─────────────────────────── carga e ações ─────────────────────────── */

  function carregar() {
    api<{ config: FiscalConfig; certificado: FiscalCert }>('GET', '/api/lojista/nfce')
      .then(r => { setCfg(r.config); setCfgSalvo(r.config); setCert(r.certificado); })
      .catch(() => mostrar({ tipo: 'erro', titulo: 'Não foi possível carregar a configuração fiscal.' }));
  }

  function carregarNotas() {
    setNotasCarregando(true);
    api<{ notas: NotaFiscal[] }>('GET', '/api/lojista/nfce/notas')
      .then(r => setNotas(r.notas))
      .catch(() => { /* silencioso: a loja pode não ter notas ainda */ })
      .finally(() => setNotasCarregando(false));
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

  function carregarContador() {
    api<Contador>('GET', '/api/lojista/nfce/contador')
      .then(setContador)
      .catch(() => { /* silencioso: a tela funciona sem esta parte */ });
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

  function campo<K extends keyof FiscalConfig>(k: K, v: FiscalConfig[K]) {
    setCfg(c => (c ? { ...c, [k]: v } : c));
  }

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
    mostrar({ tipo: 'sucesso', titulo: 'Dados do CNPJ preenchidos.' });
  }

  async function salvar() {
    if (!cfg) return;
    setEnviando(true);
    try {
      await api('PUT', '/api/lojista/nfce', { ...cfg, csc: csc || undefined });
      setCsc('');
      mostrar({ tipo: 'sucesso', titulo: 'Dados fiscais salvos.' });
      carregar();
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally { setEnviando(false); }
  }

  function descartar() {
    setCfg(cfgSalvo);
    setCsc('');
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
      mostrar({ tipo: 'sucesso', titulo: 'Certificado instalado.', descricao: json.titular });
      setArquivo(null); setSenhaCert(''); setTrocandoCert(false);
      carregar();
    } catch (e) {
      mostrar({ tipo: 'erro', titulo: e instanceof Error ? e.message : 'Falha ao enviar o certificado.' });
    } finally { setSubindoCert(false); }
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
      carregarNotas();
      mostrar(r.autorizada
        ? { tipo: 'sucesso', titulo: `Autorizada — NFC-e nº ${r.numero}` }
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
    baixarTexto(teste.xml, `nfce-teste-${teste.chave}.xml`);
  }

  async function baixarXmlNota(id: number, chave: string) {
    try {
      const r = await api<{ nota: { xml: string } }>('GET', `/api/lojista/nfce/notas/${id}`);
      baixarTexto(r.nota.xml, `nfce-${chave}.xml`);
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

  /** Baixa o ZIP do mês. Vai por `fetch` porque a rota exige o token da sessão. */
  async function baixarXmlsDoMes() {
    if (!mesEscolhido) return;
    setBaixandoZip(true);
    try {
      const resp = await fetch(`/api/lojista/nfce/xmls?competencia=${mesEscolhido}`, {
        headers: { Authorization: `Bearer ${tokenSessao('lojista')}` },
      });
      if (!resp.ok) {
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

  /* ───────────────────────── estado derivado ───────────────────────── */

  const escolhida = competencias.find(c => c.competencia === mesEscolhido);
  const simples = cfg?.crt !== 3;

  const diasCert = cert?.validade
    ? Math.floor((new Date(cert.validade).getTime() - Date.now()) / 864e5)
    : null;

  /*
   * "Teste aprovado" vem das NOTAS, não do resultado da sessão: quem testou
   * ontem e voltou hoje veria "aguardando teste" e testaria de novo à toa.
   */
  const testeAprovado = useMemo(
    () => notas.some(n => n.ambiente === 2 && n.status === 'autorizada') || !!resultadoSefaz?.autorizada,
    [notas, resultadoSefaz],
  );

  const feitas: Record<Etapa, boolean> = {
    1: !!cert?.instalado,
    2: !!(cfg?.cnpj && cfg.razao_social && cfg.cmun),
    3: !!(cfg?.tem_csc && cfg.csc_id),
    4: !!(cfg?.ncm_padrao && cfg.cfop_padrao && cfg.csosn_padrao),
    5: testeAprovado,
  };
  const concluidas = ([1, 2, 3, 4, 5] as Etapa[]).filter(n => feitas[n]).length;

  const sujo = !!cfg && !!cfgSalvo && (JSON.stringify(cfg) !== JSON.stringify(cfgSalvo) || !!csc);

  if (!cfg) return <Skeleton className="h-96" />;

  /*
   * Nas abas horizontais cabe só o título — o "pronto/pendente" vira o visto
   * verde. O detalhe de cada etapa (validade do certificado, se o teste passou)
   * já aparece dentro dela, então repetir na aba seria ruído.
   */
  const ETAPAS: Array<{ n: Etapa; titulo: string }> = [
    { n: 1, titulo: 'Certificado A1' },
    { n: 2, titulo: 'Dados do emitente' },
    { n: 3, titulo: 'CSC e numeração' },
    { n: 4, titulo: 'Tributação padrão' },
    { n: 5, titulo: 'Teste e ativação' },
  ];

  return (
    <div className="space-y-4">
      {/* Cabeçalho: título da tela + ambiente, no mesmo desenho das outras abas */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <FileText className="size-5 text-primary" />
          <span className="inline-flex items-baseline gap-1.5"><h1 className="text-lg font-extrabold">Emissão de NFC-e</h1><Ajuda chave="fiscal" /></span>
        </div>
        <div className="flex items-center gap-3">
          {/* Progresso: um traço por etapa. Barra contínua sugeriria
              meio-termo onde só existe feito ou não feito. */}
          <div className="hidden sm:block">
            <div className="text-[11px] font-semibold text-muted-foreground">Concluído {concluidas}/5</div>
            <div className="mt-1 flex gap-1">
              {[1, 2, 3, 4, 5].map(i => (
                <span key={i} className={cn('h-1 w-6 rounded-full', i <= concluidas ? 'bg-primary' : 'bg-muted')} />
              ))}
            </div>
          </div>
          {cfg.ambiente === 1
            ? <Badge variant="success">produção</Badge>
            : <Badge variant="warning">homologação</Badge>}
        </div>
      </div>

      {/* Etapas em abas horizontais, mesmo padrão das outras telas com abas.
          Rolam de lado no celular; o visto verde marca o que já está pronto. */}
      <nav className="flex gap-1 overflow-x-auto border-b border-border" aria-label="Etapas da configuração fiscal">
        {ETAPAS.map(e => {
          const ativa = etapa === e.n;
          return (
            <button
              key={e.n}
              type="button"
              onClick={() => setEtapa(e.n)}
              aria-current={ativa ? 'step' : undefined}
              className={cn(
                'relative -mb-px flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-semibold transition-colors',
                ativa ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              <span className="font-mono text-[11px] opacity-70">{String(e.n).padStart(2, '0')}</span>
              {e.titulo}
              {feitas[e.n] && <CheckCircle2 className="size-3.5 text-success" />}
            </button>
          );
        })}
      </nav>

      <div className="min-w-0 space-y-4">
          {etapa === 1 && (
            <Passo
              icone={ShieldCheck}
              titulo="Certificado digital A1"
              texto="O certificado assina cada nota emitida. É um arquivo .pfx ou .p12 emitido por uma certificadora, com validade de um ano — vencido, a emissão para no mesmo dia."
            >
              {cert?.instalado && !trocandoCert && (
                <>
                  <Tabela linhas={[
                    ['Titular', cert.titular || '—'],
                    ['CNPJ', <span key="c" className="font-mono">{mascararCnpj(cnpjDoCertificado(cert.titular) || cfg.cnpj)}</span>],
                    ['Validade', <span key="v" className="flex flex-wrap items-center gap-2">
                      <span className="font-mono">{cert.validade ? new Date(cert.validade).toLocaleDateString('pt-BR') : '—'}</span>
                      {diasCert !== null && (diasCert < 0
                        ? <Badge variant="danger">vencido</Badge>
                        : diasCert <= 30
                          ? <Badge variant="warning">{diasCert} dias restantes</Badge>
                          : <span className="text-xs text-muted-foreground">{diasCert} dias restantes</span>)}
                    </span>],
                  ]} />
                  <div className="mt-4">
                    <Button type="button" variant="outline" onClick={() => setTrocandoCert(true)}>
                      <Upload className="size-4" /> Substituir certificado
                    </Button>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Envie um novo antes do vencimento para não parar de emitir.
                    </p>
                  </div>
                </>
              )}

              {(!cert?.instalado || trocandoCert) && (
                <div className="max-w-[520px] space-y-3">
                  {!cert?.instalado && (
                    <p className="text-sm text-muted-foreground">Nenhum certificado instalado.</p>
                  )}

                  <label
                    onDragOver={e => { e.preventDefault(); setArrastando(true); }}
                    onDragLeave={() => setArrastando(false)}
                    onDrop={e => {
                      e.preventDefault(); setArrastando(false);
                      const arq = e.dataTransfer.files?.[0];
                      if (arq) setArquivo(arq);
                    }}
                    className={cn(
                      'flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors',
                      arrastando ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50',
                    )}
                  >
                    <input type="file" accept=".pfx,.p12" className="sr-only"
                      onChange={e => setArquivo(e.target.files?.[0] || null)} />
                    <Upload className="size-5 text-muted-foreground" />
                    {arquivo
                      ? <span className="font-mono text-sm">{arquivo.name}</span>
                      : <>
                        <span className="text-sm font-medium">Arraste o arquivo .pfx ou .p12</span>
                        <span className="text-xs text-muted-foreground">ou clique para escolher do computador</span>
                      </>}
                  </label>

                  <div>
                    <Label htmlFor="cert-senha">Senha do certificado</Label>
                    <Input id="cert-senha" type="password" className="font-mono" autoComplete="off"
                      value={senhaCert} onChange={e => setSenhaCert(e.target.value)} placeholder="••••••" />
                  </div>

                  <p className="text-[11px] text-muted-foreground">
                    O arquivo fica em pasta protegida no servidor e a senha é guardada criptografada. Não é compartilhado.
                  </p>

                  <div className="flex flex-wrap gap-2">
                    <Button type="button" onClick={enviarCertificado} disabled={subindoCert || !arquivo || !senhaCert}>
                      {subindoCert ? <><Loader2 className="size-4 animate-spin" /> Validando…</> : <><Upload className="size-4" /> Enviar e validar</>}
                    </Button>
                    {cert?.instalado && (
                      <Button type="button" variant="outline"
                        onClick={() => { setTrocandoCert(false); setArquivo(null); setSenhaCert(''); }}>
                        Cancelar
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </Passo>
          )}

          {etapa === 2 && (
            <Passo
              icone={Landmark}
              titulo="Dados do emitente"
              texto="É o que sai impresso na nota e o que a SEFAZ confere. Consulte pelo CNPJ para trazer os dados oficiais da Receita — a inscrição estadual ela não fornece, essa você preenche."
            >
              <div className="max-w-[420px]">
                <Label htmlFor="emit-cnpj">CNPJ</Label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input id="emit-cnpj" value={formatarCnpj(cfg.cnpj)} onChange={e => aoDigitarCnpj(e.target.value)}
                      maxLength={18} inputMode="numeric" placeholder="00.000.000/0000-00" className="font-mono" />
                    {buscandoCnpj && (
                      <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
                    )}
                  </div>
                  <Button type="button" variant="outline" onClick={() => aoDigitarCnpj(cfg.cnpj)}
                    disabled={buscandoCnpj || cnpjDigitos(cfg.cnpj).length !== 14}>
                    Consultar
                  </Button>
                </div>
              </div>

              <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  {editandoEmitente ? 'Edição manual' : 'Retornado pela Receita'}
                </span>
                <button type="button" onClick={() => setEditandoEmitente(v => !v)}
                  className="text-xs font-semibold text-primary hover:underline">
                  {editandoEmitente ? 'Voltar à leitura' : 'Editar manualmente'}
                </button>
              </div>

              {/* Leitura por padrão. Abrir doze inputs de cara transformava uma
                  conferência de trinta segundos num formulário. */}
              {!editandoEmitente ? (
                <div className="mt-2">
                  <Tabela linhas={[
                    ['Razão social', cfg.razao_social || '—'],
                    ['Nome fantasia', cfg.nome_fantasia || '—'],
                    ['Inscrição estadual', <span key="ie" className="font-mono">{cfg.ie || '—'}</span>],
                    ['Município', `${cfg.municipio || '—'}${cfg.uf ? ` / ${cfg.uf}` : ''}`],
                    ['Código IBGE', <span key="ib" className="font-mono">{cfg.cmun || '—'}</span>],
                    ['Endereço', [cfg.logradouro, cfg.numero, cfg.bairro].filter(Boolean).join(', ') || '—'],
                    ['CEP', <span key="cep" className="font-mono">{cfg.cep || '—'}</span>],
                  ]} />
                </div>
              ) : (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <Label htmlFor="e-razao">Razão social</Label>
                    <Input id="e-razao" value={cfg.razao_social} onChange={e => campo('razao_social', e.target.value)} />
                  </div>
                  <div>
                    <Label htmlFor="e-fantasia">Nome fantasia</Label>
                    <Input id="e-fantasia" value={cfg.nome_fantasia} onChange={e => campo('nome_fantasia', e.target.value)} />
                  </div>
                  <div>
                    <Label htmlFor="e-ie">Inscrição estadual</Label>
                    <Input id="e-ie" className="font-mono" value={cfg.ie} onChange={e => campo('ie', e.target.value)}
                      placeholder="ISENTO ou número" />
                  </div>
                  <div>
                    <Label htmlFor="e-mun">Município</Label>
                    <Input id="e-mun" value={cfg.municipio} onChange={e => campo('municipio', e.target.value)} />
                  </div>
                  <div>
                    <Label htmlFor="e-uf">UF</Label>
                    <Input id="e-uf" maxLength={2} className="uppercase" value={cfg.uf}
                      onChange={e => campo('uf', e.target.value.toUpperCase().slice(0, 2))} />
                  </div>
                  <div>
                    <Label htmlFor="e-ibge">Código IBGE</Label>
                    <Input id="e-ibge" maxLength={7} className="font-mono" value={cfg.cmun}
                      onChange={e => campo('cmun', e.target.value.replace(/\D/g, ''))} />
                  </div>
                  <div>
                    <Label htmlFor="e-cep">CEP</Label>
                    <Input id="e-cep" maxLength={8} className="font-mono" value={cfg.cep}
                      onChange={e => campo('cep', e.target.value.replace(/\D/g, ''))} />
                  </div>
                  <div>
                    <Label htmlFor="e-log">Logradouro</Label>
                    <Input id="e-log" value={cfg.logradouro} onChange={e => campo('logradouro', e.target.value)} />
                  </div>
                  <div>
                    <Label htmlFor="e-num">Número</Label>
                    <Input id="e-num" value={cfg.numero} onChange={e => campo('numero', e.target.value)} />
                  </div>
                  <div>
                    <Label htmlFor="e-bairro">Bairro</Label>
                    <Input id="e-bairro" value={cfg.bairro} onChange={e => campo('bairro', e.target.value)} />
                  </div>
                </div>
              )}
            </Passo>
          )}

          {etapa === 3 && (
            <Passo
              icone={ShieldCheck}
              titulo="CSC e numeração"
              texto="O CSC é o código de segurança do contribuinte, gerado por você no portal da SEFAZ do seu estado. Sem ele, o QR Code da nota não valida e a SEFAZ rejeita a emissão."
            >
              <ol className="space-y-2 border-l-2 border-border pl-4">
                {[
                  'Entre no portal da SEFAZ do seu estado com o certificado digital.',
                  'Procure "CSC" ou "Código de Segurança do Contribuinte" e gere um código.',
                  'Copie o ID (um número curto) e o código em si — os dois vão nos campos abaixo.',
                ].map((t, i) => (
                  <li key={i} className="text-sm text-muted-foreground">
                    <span className="mr-2 font-mono text-[11px] text-primary">{String(i + 1).padStart(2, '0')}</span>
                    {t}
                  </li>
                ))}
              </ol>
              <a href="https://www.sef.sc.gov.br/" target="_blank" rel="noreferrer"
                className="mt-3 inline-block text-xs font-semibold text-primary hover:underline">
                Abrir portal da SEFAZ-SC
              </a>

              <div className="mt-6 grid max-w-[560px] gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="csc-id">ID do CSC</Label>
                  <Input id="csc-id" className="font-mono" placeholder="000001" value={cfg.csc_id}
                    onChange={e => campo('csc_id', e.target.value.replace(/\D/g, ''))} />
                </div>
                <div>
                  <Label htmlFor="csc-cod">Código CSC</Label>
                  <Input id="csc-cod" type="password" className="font-mono" autoComplete="off" value={csc}
                    onChange={e => setCsc(e.target.value)}
                    placeholder={cfg.tem_csc ? 'Salvo — deixe vazio para manter' : 'Cole o código da SEFAZ'} />
                  {cfg.tem_csc && (
                    <p className="mt-1 flex items-center gap-1 text-[11px] text-success">
                      <CheckCircle2 className="size-3" /> Já há um código salvo. Ele nunca é exibido de volta.
                    </p>
                  )}
                </div>
                <div>
                  <Label htmlFor="n-serie">Série</Label>
                  <Input id="n-serie" type="number" min={1} className="font-mono" value={cfg.serie}
                    onChange={e => campo('serie', Number(e.target.value) || 1)} />
                </div>
                <div>
                  <Label htmlFor="n-prox">Próximo número</Label>
                  <Input id="n-prox" type="number" min={1} className="font-mono" value={cfg.proximo_numero}
                    onChange={e => campo('proximo_numero', Number(e.target.value) || 1)} />
                </div>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                A numeração é contínua e não pode repetir. Só mexa aqui se estiver migrando de outro sistema.
              </p>
            </Passo>
          )}

          {etapa === 4 && (
            <Passo
              icone={FileText}
              titulo="Tributação padrão"
              texto="Estes valores entram em todo produto que não tiver os seus. Confirme com seu contador antes de emitir em produção — NCM ou situação tributária errada é rejeição na SEFAZ ou imposto pago a mais."
            >
              <div>
                <Label>Regime tributário</Label>
                <div className="flex max-w-[420px] gap-2">
                  {([[1, 'Simples Nacional'], [3, 'Regime normal']] as const).map(([v, txt]) => (
                    <button key={v} type="button" onClick={() => campo('crt', v)}
                      className={cn('flex-1 rounded-xl border-2 px-3 py-2 text-sm font-semibold transition-colors',
                        cfg.crt === v ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-primary/40')}>
                      {txt}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <div>
                  <Label htmlFor="t-ncm">NCM padrão</Label>
                  <Input id="t-ncm" className="font-mono" maxLength={8} placeholder="21069090" value={cfg.ncm_padrao}
                    onChange={e => campo('ncm_padrao', e.target.value.replace(/\D/g, '').slice(0, 8))} />
                  <p className="mt-1 text-[11px] text-muted-foreground">Ex.: 21069090 = prep. alimentícia n.e.</p>
                </div>
                <div>
                  {/* O rótulo E a lista trocam com o regime: CSOSN é do Simples,
                      CST é do regime normal. */}
                  <Label htmlFor="t-sit">{simples ? 'CSOSN padrão' : 'CST do ICMS'}</Label>
                  <select id="t-sit" value={cfg.csosn_padrao} onChange={e => campo('csosn_padrao', e.target.value)}
                    className="flex h-12 w-full rounded-xl border border-input bg-background px-4 font-mono text-base shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {(simples ? CSOSNS : CSTS).map(c => <option key={c.v} value={c.v}>{c.l}</option>)}
                  </select>
                </div>
                <div>
                  <Label htmlFor="t-cfop">CFOP padrão</Label>
                  <select id="t-cfop" value={cfg.cfop_padrao} onChange={e => campo('cfop_padrao', e.target.value)}
                    className="flex h-12 w-full rounded-xl border border-input bg-background px-4 font-mono text-base shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {Object.entries(CFOP_TEXTO).map(([v, t]) => <option key={v} value={v}>{v} – {t}</option>)}
                  </select>
                </div>
              </div>

              {/*
                LIMITE REAL, dito na tela: o gerador de XML monta o grupo de
                ICMS do Simples Nacional (ICMSSN*) para qualquer regime — ver
                grupoIcms() em src/backend/nfce.ts. Escolher regime normal aqui
                grava o CRT certo na nota, mas o grupo de ICMS sai como Simples
                e a SEFAZ rejeita. Esconder isso faria o lojista culpar o CST
                que ele escolheu.
              */}
              {!simples && (
                <p className="mt-4 flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
                  <span>
                    A emissão ainda monta o ICMS no formato do Simples Nacional. Em regime normal, a nota
                    seria rejeitada pela SEFAZ — fale com o suporte antes de emitir.
                  </span>
                </p>
              )}

              <p className="mt-4 text-xs text-muted-foreground">
                Produtos com NCM ou CEST preenchidos na própria ficha ignoram estes valores.
              </p>
            </Passo>
          )}

          {etapa === 5 && (
            <Passo
              icone={FlaskConical}
              titulo="Teste e ativação"
              texto="Homologação é o ambiente de ensaio da SEFAZ: a nota é transmitida de verdade, mas não tem valor fiscal. Passe por ele antes de ligar produção — em produção, cada nota emitida é definitiva."
            >
              <div className="divide-y divide-border border-y border-border">
                <LinhaAcao
                  titulo="Nota de teste"
                  descricao={testeAprovado ? 'Última emissão autorizada pela SEFAZ.' : 'Nenhuma nota de teste autorizada ainda.'}
                  acao={
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" variant="outline" onClick={testarSefaz} disabled={testandoSefaz}>
                        {testandoSefaz ? <><Loader2 className="size-4 animate-spin" /> Transmitindo…</> : <><ShieldCheck className="size-4" /> Emitir em homologação</>}
                      </Button>
                      <Button type="button" variant="ghost" onClick={gerarTeste} disabled={gerandoTeste}>
                        {gerandoTeste ? 'Gerando…' : 'Só conferir o XML'}
                      </Button>
                    </div>
                  }
                />
                <LinhaAcao
                  titulo="Ambiente de produção"
                  descricao={cfg.ambiente === 1
                    ? 'Ligado. Toda venda emite nota com valor fiscal.'
                    : testeAprovado
                      ? 'Teste aprovado. Pode ligar quando quiser começar a emitir de verdade.'
                      : 'Disponível depois de uma nota autorizada em homologação.'}
                  acao={
                    <Button
                      type="button"
                      variant={cfg.ambiente === 1 ? 'outline' : 'default'}
                      disabled={cfg.ambiente !== 1 && !testeAprovado}
                      onClick={() => campo('ambiente', cfg.ambiente === 1 ? 2 : 1)}
                    >
                      {cfg.ambiente === 1 ? 'Voltar à homologação' : 'Ativar produção'}
                    </Button>
                  }
                />
                <LinhaAcao
                  titulo="Emitir nas vendas"
                  descricao="Com isso desligado, nada é emitido automaticamente — nem em homologação."
                  acao={
                    <button type="button" onClick={() => campo('ativo', cfg.ativo ? 0 : 1)}
                      className={cn('relative h-6 w-11 shrink-0 rounded-full transition-colors',
                        cfg.ativo ? 'bg-primary' : 'bg-muted-foreground/30')}>
                      <span className={cn('absolute top-0.5 size-5 rounded-full bg-white shadow transition-all',
                        cfg.ativo ? 'left-[22px]' : 'left-0.5')} />
                    </button>
                  }
                />
              </div>

              {resultadoSefaz && (
                <div className={cn('mt-4 rounded-xl border p-3 text-sm',
                  resultadoSefaz.autorizada ? 'border-success/40 bg-success/5' : 'border-destructive/40 bg-destructive/5')}>
                  <div className="flex items-center gap-2 font-bold">
                    {resultadoSefaz.autorizada
                      ? <><CheckCircle2 className="size-4 text-success" /> <span className="text-success">Autorizada em homologação</span></>
                      : <><AlertTriangle className="size-4 text-destructive" /> <span className="text-destructive">Rejeitada</span></>}
                  </div>
                  {resultadoSefaz.c_stat && (
                    <div className="mt-1 text-xs"><span className="text-muted-foreground">cStat: </span><span className="font-mono">{resultadoSefaz.c_stat}</span></div>
                  )}
                  {resultadoSefaz.motivo && <div className="text-xs text-muted-foreground">{resultadoSefaz.motivo}</div>}
                  {resultadoSefaz.protocolo && (
                    <div className="text-xs"><span className="text-muted-foreground">Protocolo: </span><span className="font-mono">{resultadoSefaz.protocolo}</span></div>
                  )}
                  {resultadoSefaz.chave && <div className="mt-1 break-all font-mono text-[10px] text-muted-foreground">{resultadoSefaz.chave}</div>}
                </div>
              )}
            </Passo>
          )}

          {/* ───────────────── Operação do dia a dia ─────────────────
              Fora do stepper de propósito: as cinco etapas são a instalação,
              feita uma vez. O que vem abaixo é rotina de todo mês, e não teria
              sentido virar "etapa 06" que nunca se conclui. */}

          <Card>
            <CardContent className="p-5">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Receipt className="size-4 text-primary" />
                  <span className="text-sm font-bold">Notas emitidas</span>
                  {notas.length > 0 && (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">{notas.length}</span>
                  )}
                </div>
                <button type="button" onClick={carregarNotas} title="Atualizar"
                  className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent">
                  <RefreshCw className={cn('size-4', notasCarregando && 'animate-spin')} />
                </button>
              </div>

              {notas.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  Nenhuma NFC-e emitida ainda. Emita a partir de uma venda concluída.
                </p>
              ) : (
                <div className="divide-y divide-border/60">
                  {notas.map(n => (
                    <div key={n.id} className="flex items-center gap-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold">nº {n.numero}/{n.serie}</span>
                          <Badge variant={NOTA_BADGE[n.status]}>{NOTA_ROTULO[n.status]}</Badge>
                          {n.ambiente === 2 && <span className="text-[10px] text-muted-foreground">homolog.</span>}
                          {n.pedido_id && <span className="text-[10px] text-muted-foreground">pedido #{n.pedido_id}</span>}
                        </div>
                        <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">{n.chave}</div>
                        {(n.status === 'rejeitada' || n.status === 'erro') && n.motivo && (
                          <div className="mt-0.5 line-clamp-1 text-[11px] text-destructive">{n.c_stat} — {n.motivo}</div>
                        )}
                      </div>
                      <div className="shrink-0 text-sm font-bold tabular-nums">
                        R$ {(n.total_centavos / 100).toFixed(2).replace('.', ',')}
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <button type="button" onClick={() => baixarXmlNota(n.id, n.chave)} title="Baixar XML"
                          className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent">
                          <Download className="size-4" />
                        </button>
                        {n.status === 'autorizada' && (
                          <button type="button" onClick={() => cancelarNota(n)} disabled={cancelando === n.id}
                            title="Cancelar NFC-e"
                            className="rounded-lg p-1.5 text-destructive hover:bg-destructive/10 disabled:opacity-40">
                            <Ban className="size-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3 p-5">
              <div className="flex items-center gap-2">
                <FolderArchive className="size-4 text-primary" />
                <span className="text-sm font-bold">XMLs do mês para o contador</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Um arquivo por nota, nomeado pela chave de acesso, mais o evento de cancelamento quando houver
                e uma relação em CSV para conferência. Só notas de produção — homologação não tem valor fiscal.
              </p>

              {competencias.length === 0 ? (
                <p className="text-xs text-muted-foreground">Nenhuma nota de produção emitida ainda.</p>
              ) : (
                <>
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="min-w-[220px] flex-1">
                      <Label htmlFor="xml-mes">Mês</Label>
                      <select id="xml-mes" value={mesEscolhido} onChange={e => setMesEscolhido(e.target.value)}
                        className="flex h-12 w-full rounded-xl border border-input bg-background px-4 text-base shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        {competencias.map(c => (
                          <option key={c.competencia} value={c.competencia}>
                            {mesPorExtenso(c.competencia)} — {c.autorizadas} autorizada(s)
                            {c.canceladas > 0 ? `, ${c.canceladas} cancelada(s)` : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                    <Button type="button" onClick={baixarXmlsDoMes} disabled={baixandoZip || !mesEscolhido}>
                      {baixandoZip ? <><Loader2 className="size-4 animate-spin" /> Preparando…</> : <><Download className="size-4" /> Baixar ZIP</>}
                    </Button>
                  </div>
                  {escolhida && (
                    <p className="text-xs text-muted-foreground">
                      {escolhida.autorizadas} nota(s) autorizada(s)
                      {escolhida.canceladas > 0 && <>, {escolhida.canceladas} cancelada(s)</>}
                      {' · '}total autorizado R$ {(escolhida.total_centavos / 100).toFixed(2).replace('.', ',')}
                    </p>
                  )}
                </>
              )}

              {contador && (
                <div className="space-y-3 border-t border-border pt-4">
                  <div className="flex items-center gap-2">
                    <Mail className="size-4 text-primary" />
                    <span className="text-sm font-bold">Enviar direto pro contador</span>
                  </div>

                  <div>
                    <Label htmlFor="contador-email">E-mail do contador</Label>
                    <Input id="contador-email" value={contador.email} placeholder="contador@escritorio.com.br"
                      onChange={e => setContador(c => c && ({ ...c, email: e.target.value }))} />
                    <p className="mt-1 text-[11px] text-muted-foreground">Mais de um? Separe por vírgula (até 5).</p>
                  </div>

                  <label className="flex cursor-pointer items-start gap-2.5">
                    <input type="checkbox" checked={contador.envio_auto} className="mt-0.5 size-4 shrink-0 accent-primary"
                      onChange={e => setContador(c => c && ({ ...c, envio_auto: e.target.checked }))} />
                    <span className="text-sm">
                      Enviar automaticamente todo mês
                      <span className="block text-[11px] text-muted-foreground">
                        No dia escolhido, manda os XMLs do <b>mês anterior</b> (fechado) sem você precisar entrar aqui.
                      </span>
                    </span>
                  </label>

                  {contador.envio_auto && (
                    <div className="w-40">
                      <Label htmlFor="contador-dia">Dia do envio</Label>
                      <select id="contador-dia" value={contador.dia_envio}
                        onChange={e => setContador(c => c && ({ ...c, dia_envio: Number(e.target.value) }))}
                        className="flex h-12 w-full rounded-xl border border-input bg-background px-4 text-base shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        {/* Até 28: dia 29-31 não existe em todo mês, e um envio
                            que pula fevereiro é pior que um dia antes. */}
                        {Array.from({ length: 28 }, (_, i) => i + 1).map(d => (
                          <option key={d} value={d}>dia {d}</option>
                        ))}
                      </select>
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
                      <CheckCircle2 className="size-3.5 text-success" />
                      Último envio: {mesPorExtenso(contador.ultima_competencia)}
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

          <Card>
            <CardContent className="p-0">
              <button type="button" onClick={() => setProdutosAberto(v => !v)}
                className="flex w-full items-center justify-between px-5 py-4 text-left">
                <div className="flex items-center gap-2">
                  <Package className="size-4 text-primary" />
                  <span className="text-sm font-bold">Tributação por produto</span>
                  {produtos.length > 0 && (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">{produtos.length}</span>
                  )}
                </div>
                <span className="text-xs text-muted-foreground">{produtosAberto ? 'ocultar' : 'mostrar'}</span>
              </button>

              {produtosAberto && (
                <div className="border-t border-border">
                  <p className="px-5 py-2 text-xs text-muted-foreground">
                    Só para os produtos que fogem do padrão da etapa 04. Salva sozinho ao digitar.
                  </p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-border bg-muted/40 text-muted-foreground">
                          <th className="min-w-[160px] px-4 py-2 text-left font-semibold">Produto</th>
                          <th className="w-[90px] px-2 py-2 text-left font-semibold">NCM</th>
                          <th className="w-[70px] px-2 py-2 text-left font-semibold">CFOP</th>
                          <th className="w-[70px] px-2 py-2 text-left font-semibold">{simples ? 'CSOSN' : 'CST'}</th>
                          <th className="w-[120px] px-2 py-2 text-left font-semibold">Origem</th>
                          <th className="w-[60px] px-2 py-2 text-left font-semibold">Unid.</th>
                          <th className="w-[80px] px-2 py-2 text-left font-semibold">CEST</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/60">
                        {produtos.map(p => (
                          <tr key={p.id} className="transition-colors hover:bg-muted/20">
                            <td className="px-4 py-2">
                              <div className="font-medium leading-tight">{p.nome}</div>
                              <div className="text-[10px] text-muted-foreground">{p.categoria}</div>
                            </td>
                            <td className="px-2 py-1.5">
                              <input value={p.ncm} maxLength={8} placeholder={cfg.ncm_padrao || '21069090'}
                                onChange={e => editarProduto(p.id, 'ncm', e.target.value.replace(/\D/g, '').slice(0, 8))}
                                className="w-full rounded border border-border bg-background px-1.5 py-1 font-mono text-xs focus:border-primary focus:outline-none" />
                            </td>
                            <td className="px-2 py-1.5">
                              <input value={p.cfop} maxLength={4} placeholder={cfg.cfop_padrao || '5102'}
                                onChange={e => editarProduto(p.id, 'cfop', e.target.value.replace(/\D/g, '').slice(0, 4))}
                                className="w-full rounded border border-border bg-background px-1.5 py-1 font-mono text-xs focus:border-primary focus:outline-none" />
                            </td>
                            <td className="px-2 py-1.5">
                              <select value={p.csosn} onChange={e => editarProduto(p.id, 'csosn', e.target.value)}
                                className="w-full rounded border border-border bg-background px-1 py-1 font-mono text-xs focus:border-primary focus:outline-none">
                                <option value="">padrão</option>
                                {(simples ? CSOSNS : CSTS).map(c => <option key={c.v} value={c.v}>{c.v}</option>)}
                              </select>
                            </td>
                            <td className="px-2 py-1.5">
                              <select value={p.origem} onChange={e => editarProduto(p.id, 'origem', e.target.value)}
                                className="w-full rounded border border-border bg-background px-1 py-1 text-xs focus:border-primary focus:outline-none">
                                {ORIGENS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
                              </select>
                            </td>
                            <td className="px-2 py-1.5">
                              <input value={p.unidade_comercial} maxLength={6} placeholder="UN"
                                onChange={e => editarProduto(p.id, 'unidade_comercial', e.target.value.toUpperCase().slice(0, 6))}
                                className="w-full rounded border border-border bg-background px-1.5 py-1 font-mono text-xs uppercase focus:border-primary focus:outline-none" />
                            </td>
                            <td className="px-2 py-1.5">
                              <input value={p.cest} maxLength={7} placeholder="—"
                                onChange={e => editarProduto(p.id, 'cest', e.target.value.replace(/\D/g, '').slice(0, 7))}
                                className="w-full rounded border border-border bg-background px-1.5 py-1 font-mono text-xs focus:border-primary focus:outline-none" />
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
      </div>

      {/*
        BARRA DE SALVAR só quando há alteração pendente.
        O botão solto no fim do formulário obrigava a rolar até o fim pra salvar
        um campo do começo — e sumia de vista justamente enquanto se digitava.
      */}
      {sujo && (
        <div className="sticky bottom-3 z-30">
          <Card className="border-primary/40 shadow-lg">
            <CardContent className="flex flex-wrap items-center gap-3 p-3">
              <span className="mr-auto text-sm font-semibold">Alterações não salvas</span>
              <Button type="button" variant="outline" onClick={descartar} disabled={enviando}>Descartar</Button>
              <Button type="button" onClick={salvar} disabled={enviando}>
                <Save className="size-4" /> {enviando ? 'Salvando…' : 'Salvar'}
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {/* XML de teste */}
      {teste && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setTeste(null)}>
          <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl bg-card shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-border p-4">
              <h3 className="flex items-center gap-2 font-bold">
                <FlaskConical className="size-4 text-primary" /> NFC-e de teste
              </h3>
              <Button variant="ghost" size="sm" onClick={() => setTeste(null)}>Fechar</Button>
            </div>
            <div className="space-y-2 overflow-auto p-4">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded-full bg-muted px-2.5 py-1 font-mono">chave: {teste.chave}</span>
                {teste.assinado
                  ? <Badge variant="success">assinado</Badge>
                  : <Badge variant="warning">não assinado</Badge>}
                <span className="rounded-full bg-muted px-2.5 py-1">{teste.ambiente === 1 ? 'Produção' : 'Homologação'}</span>
              </div>
              {!teste.assinado && teste.motivo_nao_assinado && (
                <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
                  <span>{teste.motivo_nao_assinado}</span>
                </div>
              )}
              <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted/50 p-3 text-[10px] leading-tight">{teste.xml}</pre>
            </div>
            <div className="flex flex-wrap justify-end gap-2 border-t border-border p-4">
              <Button variant="outline" onClick={baixarXml}><Download className="size-4" /> Baixar XML</Button>
              <Button onClick={() => imprimirDanfe(teste)}><FlaskConical className="size-4" /> Imprimir cupom</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────── peças ─────────────────────────────── */

function Passo({ icone: Icone, titulo, texto, children }: {
  icone: typeof FileText; titulo: string; texto: string; children: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center gap-2">
          <Icone className="size-4 text-primary" />
          <h2 className="font-bold">{titulo}</h2>
        </div>
        <p className="mt-1.5 max-w-[60ch] text-sm text-muted-foreground">{texto}</p>
        <div className="mt-5">{children}</div>
      </CardContent>
    </Card>
  );
}

/** Par rótulo/valor em linhas — modo leitura, sem abrir formulário. */
function Tabela({ linhas }: { linhas: Array<[string, React.ReactNode]> }) {
  return (
    <div className="divide-y divide-border/60 rounded-xl border border-border">
      {linhas.map(([rotulo, valor]) => (
        <div key={rotulo} className="flex flex-wrap gap-x-4 gap-y-1 px-3 py-2.5">
          <span className="w-36 shrink-0 text-xs text-muted-foreground">{rotulo}</span>
          <span className="min-w-0 flex-1 text-sm">{valor}</span>
        </div>
      ))}
    </div>
  );
}

function LinhaAcao({ titulo, descricao, acao }: { titulo: string; descricao: string; acao: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-4 py-4">
      <div className="min-w-[200px] flex-1">
        <div className="text-sm font-semibold">{titulo}</div>
        <div className="mt-0.5 max-w-[52ch] text-xs text-muted-foreground">{descricao}</div>
      </div>
      <div className="shrink-0">{acao}</div>
    </div>
  );
}

const CFOP_TEXTO: Record<string, string> = {
  '5102': 'Venda dentro do estado',
  '5405': 'Venda com ST, dentro do estado',
  '6102': 'Venda fora do estado',
  '6108': 'Venda fora do estado, importado',
  '5949': 'Outra saída dentro do estado',
};

const MESES_XML = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** '2026-07' -> 'julho de 2026'. Competência inválida volta como veio. */
function mesPorExtenso(competencia: string): string {
  const [ano, mes] = String(competencia || '').split('-').map(Number);
  const nome = MESES_XML[(mes || 0) - 1];
  return nome ? `${nome} de ${ano}` : String(competencia);
}

/**
 * Esconde o miolo do CNPJ, deixando raiz e final: `••.•••.328/0001-26`.
 *
 * O documento já foi salvo — mostrar inteiro na tela não acrescenta nada e
 * expõe o dado a quem passar atrás do balcão. O final basta pra conferir que é
 * o certificado certo.
 */
function mascararCnpj(bruto: string | null | undefined): string {
  const d = String(bruto ?? '').replace(/\D/g, '');
  if (d.length !== 14) return '—';
  return `••.•••.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

/**
 * O titular do certificado costuma vir como "RAZÃO SOCIAL:12345678000199".
 * Quando não vier, quem chama cai no CNPJ do emitente.
 */
function cnpjDoCertificado(titular: string | null | undefined): string {
  const m = String(titular ?? '').match(/(\d{14})/);
  return m ? m[1] : '';
}

/** Dispara o download de um texto como arquivo. */
function baixarTexto(conteudo: string, nome: string): void {
  const blob = new Blob([conteudo], { type: 'application/xml' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nome;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(a.href);
}
