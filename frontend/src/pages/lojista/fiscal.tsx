/**
 * Configuração fiscal (NFC-e) do lojista.
 *
 * NAVEGAÇÃO POR ETAPAS, não formulário único. Emitir NFC-e depende de cinco
 * coisas em ordem — certificado, emitente, CSC, tributação, teste — e a versão
 * anterior mostrava as cinco de uma vez, num rolo de uns quarenta campos. Quem
 * abria não sabia por onde começar nem o que já estava pronto.
 *
 * A estética é de instrumento e não de painel de marketing: sem cor decorativa
 * (o único destaque é o próprio branco), raio de 3px e TODO dado técnico em
 * fonte mono — número fiscal é conferido dígito a dígito contra um papel, e em
 * fonte proporcional 0/O e 1/l se confundem. A escala está em index.css
 * (`.fiscal-shell`), com o espelho claro do mesmo desenho.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
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

  const ETAPAS: Array<{ n: Etapa; titulo: string; status: string }> = [
    {
      n: 1, titulo: 'Certificado A1',
      status: cert?.instalado
        ? (diasCert !== null && diasCert >= 0 ? `Válido · ${diasCert} dias` : 'Vencido')
        : 'Não instalado',
    },
    { n: 2, titulo: 'Dados do emitente', status: feitas[2] ? 'Confirmado' : 'Pendente' },
    { n: 3, titulo: 'CSC e numeração', status: feitas[3] ? 'Configurado' : 'Pendente' },
    { n: 4, titulo: 'Tributação padrão', status: 'Revisar com contador' },
    { n: 5, titulo: 'Teste e ativação', status: testeAprovado ? 'Teste aprovado' : 'Aguardando teste' },
  ];

  return (
    /*
      Superfície própria, dentro da coluna das Configurações — e não sangrando
      pra tela inteira. Esta tela mora ao lado do menu de configurações; margem
      negativa pra "full bleed" passaria por cima dele.
    */
    <div className="fiscal-shell border" style={{ borderColor: 'var(--f-line)', borderRadius: 3 }}>
      {/* Cabeçalho */}
      <header className="flex flex-wrap items-end justify-between gap-4 px-5 pb-5 pt-6 sm:px-8">
        <div>
          <div className="f-mono text-[11px] uppercase tracking-[.14em]" style={{ color: 'var(--f-text-3)' }}>Fiscal</div>
          <h1 className="mt-1 text-[26px] font-semibold leading-tight">Emissão de NFC-e</h1>
        </div>
        {/* Ambiente: dot + texto com borda fina. Badge preenchido colorido seria
            a única mancha de cor da tela, e justamente no canto. */}
        <div className="flex items-center gap-2 rounded-[4px] border px-2.5 py-1.5 text-xs"
          style={{ borderColor: 'var(--f-line-2)' }}>
          <span className="size-[5px] rounded-full"
            style={{ background: cfg.ambiente === 1 ? 'var(--f-green)' : 'var(--f-amber)' }} />
          <span style={{ color: cfg.ambiente === 1 ? 'var(--f-green)' : 'var(--f-amber)' }}>
            {cfg.ambiente === 1 ? 'Produção' : 'Homologação'}
          </span>
        </div>
      </header>

      <div className="border-t" style={{ borderColor: 'var(--f-line)' }} />

      {/* Stepper + conteúdo */}
      <div className="lg:grid lg:grid-cols-[232px_1fr]">
        {/* Coluna esquerda — no celular vira barra horizontal rolável */}
        <nav className="border-b lg:border-b-0 lg:border-r" style={{ borderColor: 'var(--f-line)' }}>
          <div className="hidden px-5 pb-3 pt-5 text-[11px] uppercase tracking-[.14em] lg:block"
            style={{ color: 'var(--f-text-3)' }}>
            Configuração
          </div>
          <ul className="flex overflow-x-auto lg:block">
            {ETAPAS.map(e => (
              <li key={e.n} className="shrink-0 lg:shrink">
                <button
                  type="button"
                  onClick={() => setEtapa(e.n)}
                  className={cn(
                    'flex w-full items-start gap-3 border-l-2 px-5 py-3 text-left transition-colors',
                  )}
                  style={{
                    borderLeftColor: etapa === e.n ? 'var(--f-accent)' : 'transparent',
                    background: etapa === e.n ? 'var(--f-surface-2)' : 'transparent',
                  }}
                >
                  <span className="f-mono mt-[3px] text-[11px]"
                    style={{ color: etapa === e.n ? 'var(--f-text-2)' : 'var(--f-text-3)' }}>
                    {String(e.n).padStart(2, '0')}
                  </span>
                  <span className="min-w-0">
                    <span className="block whitespace-nowrap text-[13.5px] lg:whitespace-normal"
                      style={{ color: etapa === e.n ? 'var(--f-text)' : 'var(--f-text-2)' }}>
                      {e.titulo}
                    </span>
                    <span className="mt-0.5 block whitespace-nowrap text-[11.5px] lg:whitespace-normal"
                      style={{ color: feitas[e.n] ? 'var(--f-green)' : 'var(--f-text-3)' }}>
                      {e.status}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>

          {/* Progresso em filetes: cinco traços, um por etapa. Barra com
              gradiente sugeriria continuidade onde só existe feito/não feito. */}
          <div className="hidden px-5 py-5 lg:block">
            <div className="f-mono text-[11px]" style={{ color: 'var(--f-text-3)' }}>
              Concluído {concluidas}/5
            </div>
            <div className="mt-2 flex gap-1">
              {[1, 2, 3, 4, 5].map(i => (
                <span key={i} className="h-[2px] flex-1"
                  style={{ background: i <= concluidas ? 'var(--f-filete)' : 'var(--f-filete-off)' }} />
              ))}
            </div>
          </div>
        </nav>

        {/* Painel de conteúdo */}
        <div className="px-5 py-7 sm:px-8">
          {etapa === 1 && (
            <Passo
              titulo="Certificado digital A1"
              texto="O certificado assina cada nota emitida. É um arquivo .pfx ou .p12 emitido por uma certificadora, com validade de um ano — vencido, a emissão para no mesmo dia."
            >
              {cert?.instalado && !trocandoCert && (
                <>
                  <Tabela linhas={[
                    ['Titular', cert.titular || '—'],
                    ['CNPJ', <span key="c" className="f-mono">{mascararCnpj(cnpjDoCertificado(cert.titular) || cfg.cnpj)}</span>],
                    ['Validade', <span key="v">
                      <span className="f-mono">{cert.validade ? new Date(cert.validade).toLocaleDateString('pt-BR') : '—'}</span>
                      {diasCert !== null && (
                        <span className="ml-2" style={{ color: diasCert <= 30 ? 'var(--f-amber)' : 'var(--f-text-3)' }}>
                          {diasCert >= 0 ? `${diasCert} dias restantes` : 'vencido'}
                        </span>
                      )}
                    </span>],
                  ]} />
                  <div className="mt-5">
                    <button type="button" className="f-btn" onClick={() => setTrocandoCert(true)}>
                      Substituir certificado
                    </button>
                    <p className="mt-2 text-[12.5px]" style={{ color: 'var(--f-text-3)' }}>
                      Envie um novo antes do vencimento para não parar de emitir.
                    </p>
                  </div>
                </>
              )}

              {(!cert?.instalado || trocandoCert) && (
                <div className="max-w-[520px] space-y-4">
                  {!cert?.instalado && (
                    <p className="text-[13px]" style={{ color: 'var(--f-text-3)' }}>
                      Nenhum certificado instalado.
                    </p>
                  )}

                  <label
                    onDragOver={e => { e.preventDefault(); setArrastando(true); }}
                    onDragLeave={() => setArrastando(false)}
                    onDrop={e => {
                      e.preventDefault(); setArrastando(false);
                      const f = e.dataTransfer.files?.[0];
                      if (f) setArquivo(f);
                    }}
                    className="flex cursor-pointer flex-col items-center justify-center gap-1 border border-dashed px-6 py-9 text-center"
                    style={{
                      borderColor: arrastando ? 'var(--f-text-3)' : 'var(--f-line-2)',
                      borderRadius: 3,
                      background: 'var(--f-surface)',
                    }}
                  >
                    <input type="file" accept=".pfx,.p12" className="sr-only"
                      onChange={e => setArquivo(e.target.files?.[0] || null)} />
                    {arquivo
                      ? <span className="f-mono text-[13px]">{arquivo.name}</span>
                      : <>
                        <span className="text-[13.5px]">Arraste o arquivo .pfx ou .p12</span>
                        <span className="text-[12.5px]" style={{ color: 'var(--f-text-3)' }}>
                          ou <u>escolha do computador</u>
                        </span>
                      </>}
                  </label>

                  <div>
                    <Rotulo>Senha do certificado</Rotulo>
                    <input type="password" value={senhaCert} onChange={e => setSenhaCert(e.target.value)}
                      className="f-campo f-mono" placeholder="••••••" autoComplete="off" />
                  </div>

                  <p className="text-[12px]" style={{ color: 'var(--f-text-3)' }}>
                    O arquivo fica em pasta protegida no servidor e a senha é guardada criptografada.
                    Não é compartilhado com ninguém.
                  </p>

                  <div className="flex flex-wrap gap-2">
                    <button type="button" className="f-btn f-btn--solido"
                      onClick={enviarCertificado} disabled={subindoCert || !arquivo || !senhaCert}>
                      {subindoCert && <Loader2 className="size-3.5 animate-spin" />}
                      {subindoCert ? 'Validando…' : 'Enviar e validar'}
                    </button>
                    {cert?.instalado && (
                      <button type="button" className="f-btn"
                        onClick={() => { setTrocandoCert(false); setArquivo(null); setSenhaCert(''); }}>
                        Cancelar
                      </button>
                    )}
                  </div>
                </div>
              )}
            </Passo>
          )}

          {etapa === 2 && (
            <Passo
              titulo="Dados do emitente"
              texto="É o que sai impresso na nota e o que a SEFAZ confere. Consulte pelo CNPJ para trazer os dados oficiais da Receita — a inscrição estadual ela não fornece, essa você preenche."
            >
              <div className="max-w-[420px]">
                <Rotulo>CNPJ</Rotulo>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <input
                      value={formatarCnpj(cfg.cnpj)}
                      onChange={e => aoDigitarCnpj(e.target.value)}
                      maxLength={18}
                      inputMode="numeric"
                      placeholder="00.000.000/0000-00"
                      className="f-campo f-mono"
                    />
                    {buscandoCnpj && (
                      <Loader2 className="absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 animate-spin"
                        style={{ color: 'var(--f-text-3)' }} />
                    )}
                  </div>
                  <button type="button" className="f-btn" onClick={() => aoDigitarCnpj(cfg.cnpj)}
                    disabled={buscandoCnpj || cnpjDigitos(cfg.cnpj).length !== 14}>
                    Consultar
                  </button>
                </div>
              </div>

              <div className="mt-7 flex items-center justify-between gap-3">
                <span className="text-[11px] uppercase tracking-[.14em]" style={{ color: 'var(--f-text-3)' }}>
                  {editandoEmitente ? 'Edição manual' : 'Retornado pela Receita'}
                </span>
                <button type="button" onClick={() => setEditandoEmitente(v => !v)}
                  className="text-[12.5px] underline underline-offset-2" style={{ color: 'var(--f-text-2)' }}>
                  {editandoEmitente ? 'Voltar à leitura' : 'Editar manualmente'}
                </button>
              </div>

              {/* Leitura por padrão. Abrir doze inputs de cara transforma uma
                  conferência de trinta segundos num formulário. */}
              {!editandoEmitente ? (
                <div className="mt-3">
                  <Tabela linhas={[
                    ['Razão social', cfg.razao_social || '—'],
                    ['Nome fantasia', cfg.nome_fantasia || '—'],
                    ['Inscrição estadual', <span key="ie" className="f-mono">{cfg.ie || '—'}</span>],
                    ['Município', `${cfg.municipio || '—'}${cfg.uf ? ` / ${cfg.uf}` : ''}`],
                    ['Código IBGE', <span key="ib" className="f-mono">{cfg.cmun || '—'}</span>],
                    ['Endereço', [cfg.logradouro, cfg.numero, cfg.bairro].filter(Boolean).join(', ') || '—'],
                    ['CEP', <span key="cep" className="f-mono">{cfg.cep || '—'}</span>],
                  ]} />
                </div>
              ) : (
                <div className="mt-4 grid max-w-[720px] gap-4 sm:grid-cols-2">
                  <Campo rotulo="Razão social" className="sm:col-span-2"
                    valor={cfg.razao_social} onChange={v => campo('razao_social', v)} />
                  <Campo rotulo="Nome fantasia" valor={cfg.nome_fantasia} onChange={v => campo('nome_fantasia', v)} />
                  <Campo rotulo="Inscrição estadual" mono valor={cfg.ie} onChange={v => campo('ie', v)}
                    placeholder="ISENTO ou número" />
                  <Campo rotulo="Município" valor={cfg.municipio} onChange={v => campo('municipio', v)} />
                  <Campo rotulo="UF" valor={cfg.uf} onChange={v => campo('uf', v.toUpperCase().slice(0, 2))} maxLength={2} />
                  <Campo rotulo="Código IBGE" mono valor={cfg.cmun} maxLength={7}
                    onChange={v => campo('cmun', v.replace(/\D/g, ''))} />
                  <Campo rotulo="CEP" mono valor={cfg.cep} maxLength={8}
                    onChange={v => campo('cep', v.replace(/\D/g, ''))} />
                  <Campo rotulo="Logradouro" valor={cfg.logradouro} onChange={v => campo('logradouro', v)} />
                  <Campo rotulo="Número" valor={cfg.numero} onChange={v => campo('numero', v)} />
                  <Campo rotulo="Bairro" valor={cfg.bairro} onChange={v => campo('bairro', v)} />
                </div>
              )}
            </Passo>
          )}

          {etapa === 3 && (
            <Passo
              titulo="CSC e numeração"
              texto="O CSC é o código de segurança do contribuinte, gerado por você no portal da SEFAZ do seu estado. Sem ele, o QR Code da nota não valida e a SEFAZ rejeita a emissão."
            >
              <ol className="max-w-[46ch] border-l pl-5" style={{ borderColor: 'var(--f-line-2)' }}>
                {[
                  'Entre no portal da SEFAZ do seu estado com o certificado digital.',
                  'Procure "CSC" ou "Código de Segurança do Contribuinte" e gere um código para produção.',
                  'Copie o ID (um número curto) e o código em si — os dois vão nos campos abaixo.',
                ].map((t, i) => (
                  <li key={i} className="relative py-2">
                    <span className="f-mono mr-2 text-[11px]" style={{ color: 'var(--f-text-3)' }}>
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <span className="text-[13.5px]" style={{ color: 'var(--f-text-2)' }}>{t}</span>
                  </li>
                ))}
              </ol>
              <p className="mt-3">
                <a href="https://www.sef.sc.gov.br/" target="_blank" rel="noreferrer"
                  className="text-[12.5px] underline underline-offset-2" style={{ color: 'var(--f-text-2)' }}>
                  Abrir portal da SEFAZ-SC
                </a>
              </p>

              <div className="mt-7 grid max-w-[520px] grid-cols-[140px_1fr] items-center gap-x-4 gap-y-3">
                <Rotulo>ID do CSC</Rotulo>
                <input value={cfg.csc_id} onChange={e => campo('csc_id', e.target.value.replace(/\D/g, ''))}
                  className="f-campo f-mono" placeholder="000001" />

                <Rotulo>Código CSC</Rotulo>
                <div>
                  <input type="password" value={csc} onChange={e => setCsc(e.target.value)}
                    className="f-campo f-mono" autoComplete="off"
                    placeholder={cfg.tem_csc ? 'Salvo — deixe vazio para manter' : 'Cole o código gerado na SEFAZ'} />
                  {cfg.tem_csc && (
                    <p className="mt-1 text-[12px]" style={{ color: 'var(--f-green)' }}>
                      Já há um código salvo. Ele nunca é exibido de volta.
                    </p>
                  )}
                </div>
              </div>

              <div className="mt-6 grid max-w-[320px] grid-cols-[140px_140px] gap-4">
                <div>
                  <Rotulo>Série</Rotulo>
                  <input type="number" min={1} value={cfg.serie}
                    onChange={e => campo('serie', Number(e.target.value) || 1)} className="f-campo f-mono" />
                </div>
                <div>
                  <Rotulo>Próximo nº</Rotulo>
                  <input type="number" min={1} value={cfg.proximo_numero}
                    onChange={e => campo('proximo_numero', Number(e.target.value) || 1)} className="f-campo f-mono" />
                </div>
              </div>
              <p className="mt-2 max-w-[46ch] text-[12px]" style={{ color: 'var(--f-text-3)' }}>
                A numeração é contínua e não pode repetir. Só mexa aqui se estiver migrando de outro sistema.
              </p>
            </Passo>
          )}

          {etapa === 4 && (
            <Passo
              titulo="Tributação padrão"
              texto="Estes valores entram em todo produto que não tiver os seus. Confirme com seu contador antes de emitir em produção — NCM ou situação tributária errada é rejeição na SEFAZ ou imposto pago a mais."
            >
              <div className="max-w-[420px]">
                <Rotulo>Regime tributário</Rotulo>
                {/* Segmented com bordas compartilhadas: um container, duas
                    opções, sem pill flutuante nem cor de preenchimento. */}
                <div className="inline-flex overflow-hidden border"
                  style={{ borderColor: 'var(--f-line-2)', borderRadius: 3 }}>
                  {([[1, 'Simples Nacional'], [3, 'Regime normal']] as const).map(([v, txt], i) => (
                    <button key={v} type="button" onClick={() => campo('crt', v)}
                      className="px-4 py-2 text-[13px] transition-colors"
                      style={{
                        borderLeft: i === 1 ? '1px solid var(--f-line-2)' : undefined,
                        background: cfg.crt === v ? 'var(--f-line-2)' : 'transparent',
                        fontWeight: cfg.crt === v ? 600 : 400,
                        color: cfg.crt === v ? 'var(--f-text)' : 'var(--f-text-2)',
                      }}>
                      {txt}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-6 flex flex-wrap gap-4">
                <div className="w-[150px]">
                  <Rotulo>NCM padrão</Rotulo>
                  <input value={cfg.ncm_padrao} maxLength={8} className="f-campo f-mono"
                    onChange={e => campo('ncm_padrao', e.target.value.replace(/\D/g, '').slice(0, 8))}
                    placeholder="21069090" />
                </div>
                <div className="w-[150px]">
                  {/* O rótulo E a lista trocam com o regime: CSOSN é do Simples,
                      CST é do regime normal. Mandar um no lugar do outro é
                      rejeição certa. */}
                  <Rotulo>{simples ? 'CSOSN' : 'CST do ICMS'}</Rotulo>
                  <select value={cfg.csosn_padrao} className="f-campo f-mono"
                    onChange={e => campo('csosn_padrao', e.target.value)}>
                    {(simples ? CSOSNS : CSTS).map(c => <option key={c.v} value={c.v}>{c.v}</option>)}
                  </select>
                  <p className="mt-1 text-[11.5px]" style={{ color: 'var(--f-text-3)' }}>
                    {(simples ? CSOSNS : CSTS).find(c => c.v === cfg.csosn_padrao)?.l.split('–')[1]?.trim() || '—'}
                  </p>
                </div>
                <div className="w-[150px]">
                  <Rotulo>CFOP</Rotulo>
                  <select value={cfg.cfop_padrao} className="f-campo f-mono"
                    onChange={e => campo('cfop_padrao', e.target.value)}>
                    <option value="5102">5102</option>
                    <option value="5405">5405</option>
                    <option value="6102">6102</option>
                    <option value="6108">6108</option>
                    <option value="5949">5949</option>
                  </select>
                  <p className="mt-1 text-[11.5px]" style={{ color: 'var(--f-text-3)' }}>
                    {CFOP_TEXTO[cfg.cfop_padrao] || '—'}
                  </p>
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
                <p className="mt-6 max-w-[46ch] border-l-2 py-1 pl-3 text-[12.5px]"
                  style={{ borderColor: 'var(--f-amber)', color: 'var(--f-amber)' }}>
                  A emissão ainda monta o ICMS no formato do Simples Nacional. Em regime normal, a nota
                  seria rejeitada pela SEFAZ — fale com o suporte antes de emitir.
                </p>
              )}

              <p className="mt-6 max-w-[46ch] text-[12.5px]" style={{ color: 'var(--f-text-3)' }}>
                Produtos com NCM ou CEST preenchidos na própria ficha ignoram estes valores.
              </p>
            </Passo>
          )}

          {etapa === 5 && (
            <Passo
              titulo="Teste e ativação"
              texto="Homologação é o ambiente de ensaio da SEFAZ: a nota é transmitida de verdade, mas não tem valor fiscal. Passe por ele antes de ligar produção — em produção, cada nota emitida é definitiva."
            >
              <div className="border-t" style={{ borderColor: 'var(--f-line)' }}>
                <LinhaAcao
                  titulo="Nota de teste"
                  descricao={testeAprovado
                    ? 'Última emissão autorizada pela SEFAZ.'
                    : 'Nenhuma nota de teste autorizada ainda.'}
                  acao={
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className="f-btn" onClick={testarSefaz} disabled={testandoSefaz}>
                        {testandoSefaz && <Loader2 className="size-3.5 animate-spin" />}
                        {testandoSefaz ? 'Transmitindo…' : 'Emitir em homologação'}
                      </button>
                      <button type="button" className="f-btn" onClick={gerarTeste} disabled={gerandoTeste}>
                        {gerandoTeste ? 'Gerando…' : 'Só conferir o XML'}
                      </button>
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
                    <button
                      type="button"
                      className={cn('f-btn', cfg.ambiente !== 1 && testeAprovado && 'f-btn--solido')}
                      disabled={cfg.ambiente !== 1 && !testeAprovado}
                      onClick={() => campo('ambiente', cfg.ambiente === 1 ? 2 : 1)}
                    >
                      {cfg.ambiente === 1 ? 'Voltar à homologação' : 'Ativar produção'}
                    </button>
                  }
                />
                <LinhaAcao
                  titulo="Emitir nas vendas"
                  descricao="Com isso desligado, nada é emitido automaticamente — nem em homologação."
                  acao={
                    <button type="button" className="f-btn" onClick={() => campo('ativo', cfg.ativo ? 0 : 1)}>
                      {cfg.ativo ? 'Emissão ligada · desligar' : 'Emissão desligada · ligar'}
                    </button>
                  }
                />
              </div>

              {resultadoSefaz && (
                <div className="mt-6 border-l-2 py-2 pl-4"
                  style={{ borderColor: resultadoSefaz.autorizada ? 'var(--f-green)' : 'var(--f-amber)' }}>
                  <div className="text-[13.5px]"
                    style={{ color: resultadoSefaz.autorizada ? 'var(--f-green)' : 'var(--f-amber)' }}>
                    {resultadoSefaz.autorizada
                      ? <>Autorizada em homologação{resultadoSefaz.protocolo && <> · protocolo <span className="f-mono">{resultadoSefaz.protocolo}</span></>}</>
                      : <>Rejeitada{resultadoSefaz.c_stat && <> · <span className="f-mono">{resultadoSefaz.c_stat}</span></>}</>}
                  </div>
                  {resultadoSefaz.motivo && (
                    <p className="mt-1 text-[12.5px]" style={{ color: 'var(--f-text-3)' }}>{resultadoSefaz.motivo}</p>
                  )}
                  {resultadoSefaz.chave && (
                    <p className="f-mono mt-1 break-all text-[11px]" style={{ color: 'var(--f-text-3)' }}>{resultadoSefaz.chave}</p>
                  )}
                </div>
              )}
            </Passo>
          )}

          {/* ───────────────── Operação do dia a dia ─────────────────
              Fora do stepper de propósito: as cinco etapas são a instalação,
              feita uma vez. O que vem abaixo é rotina de todo mês, e não teria
              sentido virar "etapa 06" que nunca se conclui. */}
          <div className="mt-14 border-t pt-8" style={{ borderColor: 'var(--f-line)' }}>
            <div className="text-[11px] uppercase tracking-[.14em]" style={{ color: 'var(--f-text-3)' }}>Operação</div>

            {/* Notas emitidas */}
            <section className="mt-6">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-[18px] font-semibold">
                  Notas emitidas
                  {notas.length > 0 && <span className="f-mono ml-2 text-[12px]" style={{ color: 'var(--f-text-3)' }}>{notas.length}</span>}
                </h2>
                <button type="button" onClick={carregarNotas} className="f-btn text-[12px]">
                  {notasCarregando ? 'Atualizando…' : 'Atualizar'}
                </button>
              </div>

              {notas.length === 0 ? (
                <p className="mt-4 text-[13px]" style={{ color: 'var(--f-text-3)' }}>
                  Nenhuma NFC-e emitida ainda.
                </p>
              ) : (
                <div className="mt-4 border-t" style={{ borderColor: 'var(--f-line)' }}>
                  {notas.map(n => (
                    <div key={n.id} className="flex flex-wrap items-center gap-3 border-b py-3"
                      style={{ borderColor: 'var(--f-line)' }}>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 text-[13px]">
                          <span className="f-mono">nº {n.numero}/{n.serie}</span>
                          <span style={{
                            color: n.status === 'autorizada' ? 'var(--f-green)'
                              : n.status === 'cancelada' ? 'var(--f-text-3)' : 'var(--f-amber)',
                          }}>
                            {NOTA_ROTULO[n.status]}
                          </span>
                          {n.ambiente === 2 && <span style={{ color: 'var(--f-text-3)' }}>homologação</span>}
                          {n.pedido_id && <span style={{ color: 'var(--f-text-3)' }}>pedido #{n.pedido_id}</span>}
                        </div>
                        <div className="f-mono mt-0.5 truncate text-[10.5px]" style={{ color: 'var(--f-text-3)' }}>{n.chave}</div>
                        {(n.status === 'rejeitada' || n.status === 'erro') && n.motivo && (
                          <div className="mt-0.5 line-clamp-1 text-[11.5px]" style={{ color: 'var(--f-amber)' }}>
                            {n.c_stat} — {n.motivo}
                          </div>
                        )}
                      </div>
                      <span className="f-mono shrink-0 text-[13px]">
                        R$ {(n.total_centavos / 100).toFixed(2).replace('.', ',')}
                      </span>
                      <div className="flex shrink-0 gap-2">
                        <button type="button" className="f-btn text-[12px]" onClick={() => baixarXmlNota(n.id, n.chave)}>
                          XML
                        </button>
                        {n.status === 'autorizada' && (
                          <button type="button" className="f-btn text-[12px]" onClick={() => cancelarNota(n)}
                            disabled={cancelando === n.id}>
                            Cancelar
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* XMLs do mês + contador */}
            <section className="mt-10">
              <h2 className="text-[18px] font-semibold">XMLs do mês para o contador</h2>
              <p className="mt-1.5 max-w-[46ch] text-[13.5px]" style={{ color: 'var(--f-text-4)' }}>
                Um arquivo por nota, nomeado pela chave de acesso, mais o evento de cancelamento quando
                houver e uma relação em CSV para conferência. Só notas de produção — homologação não tem
                valor fiscal.
              </p>

              {competencias.length === 0 ? (
                <p className="mt-4 text-[13px]" style={{ color: 'var(--f-text-3)' }}>
                  Nenhuma nota de produção emitida ainda.
                </p>
              ) : (
                <div className="mt-5 flex flex-wrap items-end gap-3">
                  <div className="min-w-[240px]">
                    <Rotulo>Mês</Rotulo>
                    <select value={mesEscolhido} onChange={e => setMesEscolhido(e.target.value)} className="f-campo">
                      {competencias.map(c => (
                        <option key={c.competencia} value={c.competencia}>
                          {mesPorExtenso(c.competencia)} — {c.autorizadas} autorizada(s)
                          {c.canceladas > 0 ? `, ${c.canceladas} cancelada(s)` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button type="button" className="f-btn" onClick={baixarXmlsDoMes} disabled={baixandoZip || !mesEscolhido}>
                    {baixandoZip && <Loader2 className="size-3.5 animate-spin" />}
                    {baixandoZip ? 'Preparando…' : 'Baixar ZIP'}
                  </button>
                  {escolhida && (
                    <span className="pb-2 text-[12.5px]" style={{ color: 'var(--f-text-3)' }}>
                      total autorizado <span className="f-mono">R$ {(escolhida.total_centavos / 100).toFixed(2).replace('.', ',')}</span>
                    </span>
                  )}
                </div>
              )}

              {contador && (
                <div className="mt-8 max-w-[520px] space-y-4 border-t pt-6" style={{ borderColor: 'var(--f-line)' }}>
                  <div className="text-[11px] uppercase tracking-[.14em]" style={{ color: 'var(--f-text-3)' }}>
                    Envio automático
                  </div>

                  <div>
                    <Rotulo>E-mail do contador</Rotulo>
                    <input value={contador.email} className="f-campo"
                      onChange={e => setContador(c => c && ({ ...c, email: e.target.value }))}
                      placeholder="contador@escritorio.com.br" />
                    <p className="mt-1 text-[12px]" style={{ color: 'var(--f-text-3)' }}>
                      Mais de um? Separe por vírgula (até 5).
                    </p>
                  </div>

                  <label className="flex cursor-pointer items-start gap-2.5">
                    <input type="checkbox" checked={contador.envio_auto} className="mt-[3px] size-3.5 shrink-0"
                      onChange={e => setContador(c => c && ({ ...c, envio_auto: e.target.checked }))} />
                    <span className="text-[13.5px]">
                      Enviar todo mês, sem eu precisar entrar aqui
                      <span className="mt-0.5 block text-[12px]" style={{ color: 'var(--f-text-3)' }}>
                        No dia escolhido, manda os XMLs do mês anterior, já fechado.
                      </span>
                    </span>
                  </label>

                  {contador.envio_auto && (
                    <div className="w-[150px]">
                      <Rotulo>Dia do envio</Rotulo>
                      <select value={contador.dia_envio} className="f-campo f-mono"
                        onChange={e => setContador(c => c && ({ ...c, dia_envio: Number(e.target.value) }))}>
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
                    <p className="border-l-2 py-1 pl-3 text-[12.5px]"
                      style={{ borderColor: 'var(--f-amber)', color: 'var(--f-amber)' }}>
                      O envio de e-mail da plataforma não está configurado — nada será enviado até o suporte ligar o SMTP.
                    </p>
                  )}

                  {contador.ultimo_erro && (
                    <p className="border-l-2 py-1 pl-3 text-[12.5px]"
                      style={{ borderColor: 'var(--f-amber)', color: 'var(--f-amber)' }}>
                      Último envio falhou: {contador.ultimo_erro}
                    </p>
                  )}

                  {contador.ultima_competencia && !contador.ultimo_erro && (
                    <p className="text-[12.5px]" style={{ color: 'var(--f-green)' }}>
                      Último envio: {mesPorExtenso(contador.ultima_competencia)}
                    </p>
                  )}

                  <div className="flex flex-wrap gap-2">
                    <button type="button" className="f-btn f-btn--solido" onClick={salvarContador} disabled={salvandoContador}>
                      {salvandoContador ? 'Salvando…' : 'Salvar'}
                    </button>
                    {competencias.length > 0 && (
                      <button type="button" className="f-btn" onClick={enviarAgoraAoContador}
                        disabled={enviandoContador || !contador.email}>
                        {enviandoContador && <Loader2 className="size-3.5 animate-spin" />}
                        {enviandoContador ? 'Enviando…' : `Enviar ${mesEscolhido ? mesPorExtenso(mesEscolhido) : 'agora'}`}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </section>

            {/* Dados fiscais por produto */}
            <section className="mt-10">
              <button type="button" onClick={() => setProdutosAberto(v => !v)}
                className="flex w-full items-center justify-between gap-3 text-left">
                <h2 className="text-[18px] font-semibold">
                  Tributação por produto
                  {produtos.length > 0 && <span className="f-mono ml-2 text-[12px]" style={{ color: 'var(--f-text-3)' }}>{produtos.length}</span>}
                </h2>
                <span className="text-[12.5px]" style={{ color: 'var(--f-text-3)' }}>
                  {produtosAberto ? 'ocultar' : 'mostrar'}
                </span>
              </button>
              <p className="mt-1.5 max-w-[46ch] text-[13.5px]" style={{ color: 'var(--f-text-4)' }}>
                Só para os produtos que fogem do padrão da etapa 04. Salva sozinho ao digitar.
              </p>

              {produtosAberto && (
                <div className="mt-4 overflow-x-auto border-t" style={{ borderColor: 'var(--f-line)' }}>
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr style={{ color: 'var(--f-text-3)' }}>
                        <th className="min-w-[160px] py-2 text-left font-normal">Produto</th>
                        <th className="w-[90px] py-2 text-left font-normal">NCM</th>
                        <th className="w-[70px] py-2 text-left font-normal">CFOP</th>
                        <th className="w-[70px] py-2 text-left font-normal">{simples ? 'CSOSN' : 'CST'}</th>
                        <th className="w-[120px] py-2 text-left font-normal">Origem</th>
                        <th className="w-[60px] py-2 text-left font-normal">Unid.</th>
                        <th className="w-[80px] py-2 text-left font-normal">CEST</th>
                      </tr>
                    </thead>
                    <tbody>
                      {produtos.map(p => (
                        <tr key={p.id} className="border-t" style={{ borderColor: 'var(--f-line)' }}>
                          <td className="py-1.5 pr-3">
                            <div className="text-[12.5px] leading-tight">{p.nome}</div>
                            <div className="text-[10.5px]" style={{ color: 'var(--f-text-3)' }}>{p.categoria}</div>
                          </td>
                          <td className="py-1.5 pr-2">
                            <input value={p.ncm} maxLength={8} className="f-campo f-mono px-1.5 py-1 text-[11.5px]"
                              placeholder={cfg.ncm_padrao || '21069090'}
                              onChange={e => editarProduto(p.id, 'ncm', e.target.value.replace(/\D/g, '').slice(0, 8))} />
                          </td>
                          <td className="py-1.5 pr-2">
                            <input value={p.cfop} maxLength={4} className="f-campo f-mono px-1.5 py-1 text-[11.5px]"
                              placeholder={cfg.cfop_padrao || '5102'}
                              onChange={e => editarProduto(p.id, 'cfop', e.target.value.replace(/\D/g, '').slice(0, 4))} />
                          </td>
                          <td className="py-1.5 pr-2">
                            <select value={p.csosn} className="f-campo f-mono px-1 py-1 text-[11.5px]"
                              onChange={e => editarProduto(p.id, 'csosn', e.target.value)}>
                              <option value="">padrão</option>
                              {(simples ? CSOSNS : CSTS).map(c => <option key={c.v} value={c.v}>{c.v}</option>)}
                            </select>
                          </td>
                          <td className="py-1.5 pr-2">
                            <select value={p.origem} className="f-campo px-1 py-1 text-[11.5px]"
                              onChange={e => editarProduto(p.id, 'origem', e.target.value)}>
                              {ORIGENS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
                            </select>
                          </td>
                          <td className="py-1.5 pr-2">
                            <input value={p.unidade_comercial} maxLength={6}
                              className="f-campo f-mono px-1.5 py-1 text-[11.5px] uppercase" placeholder="UN"
                              onChange={e => editarProduto(p.id, 'unidade_comercial', e.target.value.toUpperCase().slice(0, 6))} />
                          </td>
                          <td className="py-1.5">
                            <input value={p.cest} maxLength={7} className="f-campo f-mono px-1.5 py-1 text-[11.5px]"
                              placeholder="—"
                              onChange={e => editarProduto(p.id, 'cest', e.target.value.replace(/\D/g, '').slice(0, 7))} />
                          </td>
                        </tr>
                      ))}
                      {produtosCarregando && (
                        <tr><td colSpan={7} className="py-8 text-center" style={{ color: 'var(--f-text-3)' }}>Carregando…</td></tr>
                      )}
                      {!produtosCarregando && produtosCarregados && produtos.length === 0 && (
                        <tr><td colSpan={7} className="py-8 text-center" style={{ color: 'var(--f-text-3)' }}>Nenhum produto cadastrado.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        </div>
      </div>

      {/*
        BARRA DE SALVAR só quando há alteração pendente.
        O botão solto no fim do formulário obrigava a rolar até o fim pra
        salvar um campo do começo — e, pior, sumia de vista justamente enquanto
        se digitava.
      */}
      {sujo && (
        <div className="sticky bottom-0 z-40 border-t px-5 py-3 sm:px-8"
          style={{ borderColor: 'var(--f-line-2)', background: 'var(--f-surface)' }}>
          <div className="flex flex-wrap items-center justify-end gap-3">
            <span className="mr-auto text-[13px]" style={{ color: 'var(--f-text-2)' }}>Alterações não salvas</span>
            <button type="button" className="f-btn" onClick={descartar} disabled={enviando}>Descartar</button>
            <button type="button" className="f-btn f-btn--solido" onClick={salvar} disabled={enviando}>
              {enviando && <Loader2 className="size-3.5 animate-spin" />}
              {enviando ? 'Salvando…' : 'Salvar'}
            </button>
          </div>
        </div>
      )}

      {/* XML de teste */}
      {teste && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setTeste(null)}>
          <div className="fiscal-shell flex max-h-[85vh] w-full max-w-2xl flex-col border"
            style={{ borderColor: 'var(--f-line-2)', borderRadius: 3, background: 'var(--f-surface)' }}
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b px-5 py-3" style={{ borderColor: 'var(--f-line)' }}>
              <h3 className="text-[15px] font-semibold">XML de teste</h3>
              <button type="button" onClick={() => setTeste(null)} className="f-btn text-[12px]">Fechar</button>
            </div>
            <div className="space-y-3 overflow-auto p-5">
              <Tabela linhas={[
                ['Chave', <span key="k" className="f-mono break-all">{teste.chave}</span>],
                ['Assinatura', <span key="a" style={{ color: teste.assinado ? 'var(--f-green)' : 'var(--f-amber)' }}>
                  {teste.assinado ? 'Assinado com o certificado' : 'Não assinado'}
                </span>],
                ['Ambiente', teste.ambiente === 1 ? 'Produção' : 'Homologação'],
              ]} />
              {!teste.assinado && teste.motivo_nao_assinado && (
                <p className="border-l-2 py-1 pl-3 text-[12.5px]"
                  style={{ borderColor: 'var(--f-amber)', color: 'var(--f-amber)' }}>
                  {teste.motivo_nao_assinado}
                </p>
              )}
              <pre className="f-mono max-h-[50vh] overflow-auto whitespace-pre-wrap break-all p-3 text-[10.5px]"
                style={{ background: 'var(--f-surface-2)', borderRadius: 3, color: 'var(--f-text-2)' }}>{teste.xml}</pre>
            </div>
            <div className="flex flex-wrap justify-end gap-2 border-t px-5 py-3" style={{ borderColor: 'var(--f-line)' }}>
              <button type="button" className="f-btn" onClick={baixarXml}>Baixar XML</button>
              <button type="button" className="f-btn f-btn--solido" onClick={() => imprimirDanfe(teste)}>Imprimir cupom</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────── peças ─────────────────────────────── */

function Passo({ titulo, texto, children }: { titulo: string; texto: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-[18px] font-semibold">{titulo}</h2>
      <p className="mt-1.5 max-w-[46ch] text-[13.5px] leading-relaxed" style={{ color: 'var(--f-text-4)' }}>{texto}</p>
      <div className="mt-7">{children}</div>
    </section>
  );
}

function Rotulo({ children }: { children: React.ReactNode }) {
  return <div className="mb-1.5 text-[12px]" style={{ color: 'var(--f-text-3)' }}>{children}</div>;
}

/** Tabela de hairlines: rótulo à esquerda, valor à direita. */
function Tabela({ linhas }: { linhas: Array<[string, React.ReactNode]> }) {
  return (
    <div className="max-w-[560px] border-t" style={{ borderColor: 'var(--f-line)' }}>
      {linhas.map(([rotulo, valor]) => (
        <div key={rotulo} className="flex gap-4 border-b py-2.5" style={{ borderColor: 'var(--f-line)' }}>
          <span className="w-[150px] shrink-0 text-[12px]" style={{ color: 'var(--f-text-3)' }}>{rotulo}</span>
          <span className="min-w-0 flex-1 text-[13px]">{valor}</span>
        </div>
      ))}
    </div>
  );
}

function Campo({ rotulo, valor, onChange, mono, className, ...resto }: {
  rotulo: string; valor: string; onChange: (v: string) => void; mono?: boolean; className?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'className'>) {
  return (
    <div className={className}>
      <Rotulo>{rotulo}</Rotulo>
      <input value={valor} onChange={e => onChange(e.target.value)}
        className={cn('f-campo', mono && 'f-mono')} {...resto} />
    </div>
  );
}

function LinhaAcao({ titulo, descricao, acao }: { titulo: string; descricao: string; acao: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-4 border-b py-4" style={{ borderColor: 'var(--f-line)' }}>
      <div className="min-w-[220px] flex-1">
        <div className="text-[13.5px]">{titulo}</div>
        <div className="mt-0.5 max-w-[46ch] text-[12.5px]" style={{ color: 'var(--f-text-3)' }}>{descricao}</div>
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
