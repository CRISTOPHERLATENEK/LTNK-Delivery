/**
 * Gestão de TENANTS (clientes do SaaS) — só super admin do painel principal.
 * Cada tenant tem seu próprio banco (.db) e domínio (multi-tenant SILO).
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Building2, Plus, Globe, Power, Store, Wand2, ExternalLink, Database, Download, Loader2, LogIn, MapPin, Palette, FileText, Check, ArrowRight, ArrowLeft, SkipForward } from 'lucide-react';
import { AdminLayout } from './layout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { ImageUpload } from '@/components/ui/image-upload';
import { api, ApiError, tokenSessao } from '@/lib/api';
import { buscarCnpj, formatarCnpj, cnpjDigitos } from '@/lib/cnpj';
import { cn } from '@/lib/utils';

interface Tenant {
  id: number;
  nome: string;
  slug: string;
  dominio: string | null;
  db_nome: string;
  ativo: 0 | 1;
  criado_em: string;
  lojas: number;
}

function gerarSlug(nome: string): string {
  return nome.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

export function TelaTenants() {
  const { mostrar } = useToast();
  const consulta = useQuery({
    queryKey: ['tenants'],
    queryFn: () => api<{ tenants: Tenant[] }>('GET', '/api/admin/tenants').then(r => r.tenants),
  });

  const vazio = { nome: '', slug: '', dominio: '', nome_loja: '', categoria: '', dono_nome: '', email: '', senha: '', telefone: '' };
  const [form, setForm] = useState(vazio);
  const [criando, setCriando] = useState(false);
  const [enviando, setEnviando] = useState(false);

  /** Etapas do assistente: 'cliente' cria o tenant; as demais só completam dados nele. */
  const [etapa, setEtapa] = useState<'cliente' | 'endereco' | 'visual' | 'fiscal'>('cliente');
  const [criado, setCriado] = useState<{ tenantId: number; lojaId: number; email: string } | null>(null);

  function fecharAssistente() {
    setCriando(false);
    setEtapa('cliente');
    setCriado(null);
    setForm(vazio);
    consulta.refetch();
  }

  async function criar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    try {
      const r = await api<{ tenant: { id: number }; loja_id: number }>('POST', '/api/admin/tenants', {
        nome: form.nome,
        slug: form.slug || gerarSlug(form.nome),
        dominio: form.dominio,
        nome_loja: form.nome_loja || form.nome,
        categoria: form.categoria,
        dono_nome: form.dono_nome,
        email: form.email,
        senha: form.senha,
        telefone: form.telefone,
      });
      mostrar({ tipo: 'sucesso', titulo: 'Cliente criado!', descricao: 'Banco provisionado — agora complete o cadastro.' });
      setCriado({ tenantId: r.tenant.id, lojaId: r.loja_id, email: form.email });
      setEtapa('endereco');
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally {
      setEnviando(false);
    }
  }

  async function alternarAtivo(t: Tenant) {
    try {
      await api('PUT', `/api/admin/tenants/${t.id}`, { ativo: t.ativo ? 0 : 1 });
      consulta.refetch();
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    }
  }

  async function salvarDominio(t: Tenant, dominio: string) {
    try {
      await api('PUT', `/api/admin/tenants/${t.id}`, { dominio });
      mostrar({ tipo: 'sucesso', titulo: 'Domínio atualizado.' });
      consulta.refetch();
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    }
  }

  const tenants = consulta.data ?? [];

  return (
    <AdminLayout titulo="Clientes">
      <div className="max-w-4xl space-y-5 mx-auto">
        {/* Cabeçalho */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-extrabold">
              <Building2 className="size-5 text-primary" /> Clientes (Tenants)
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Cada cliente tem seu próprio banco isolado e domínio.
            </p>
          </div>
          {!criando && (
            <Button onClick={() => setCriando(true)}>
              <Plus className="size-4" /> Novo cliente
            </Button>
          )}
        </div>

        {/* Assistente de criação — 4 etapas */}
        {criando && (
          <Card className="border-primary/40">
            <CardContent className="p-5 space-y-5">
              <Estepes atual={etapa} />

              {etapa === 'endereco' && criado ? (
                <EtapaEndereco tenantId={criado.tenantId} lojaId={criado.lojaId}
                  onVoltar={() => setEtapa('cliente')}
                  onProximo={() => setEtapa('visual')} />
              ) : etapa === 'visual' && criado ? (
                <EtapaVisual tenantId={criado.tenantId} lojaId={criado.lojaId}
                  onVoltar={() => setEtapa('endereco')}
                  onProximo={() => setEtapa('fiscal')} />
              ) : etapa === 'fiscal' && criado ? (
                <EtapaFiscal tenantId={criado.tenantId} lojaId={criado.lojaId} email={criado.email}
                  onVoltar={() => setEtapa('visual')}
                  onConcluir={fecharAssistente} />
              ) : (
              <form onSubmit={criar} className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <Label>Nome do cliente *</Label>
                  <Input
                    required autoFocus
                    value={form.nome}
                    onChange={e => setForm(f => ({ ...f, nome: e.target.value, slug: f.slug || gerarSlug(e.target.value) }))}
                    placeholder="Ex.: Pizzaria do João"
                  />
                </div>
                <div>
                  <Label>Slug (identificador) *</Label>
                  <div className="flex gap-2">
                    <Input
                      value={form.slug}
                      onChange={e => setForm(f => ({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') }))}
                      placeholder="pizzaria-do-joao"
                      className="font-mono text-sm"
                    />
                    <button type="button" title="Gerar do nome"
                      onClick={() => setForm(f => ({ ...f, slug: gerarSlug(f.nome) }))}
                      className="shrink-0 flex items-center px-3 rounded-lg border border-input bg-muted text-xs font-semibold hover:bg-muted/80">
                      <Wand2 className="size-3.5" />
                    </button>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">Vira o banco MySQL: <span className="font-mono">tenant_{(form.slug || 'slug').replace(/-/g, '_')}</span></p>
                </div>
                <div>
                  <Label>Domínio (opcional)</Label>
                  <Input
                    value={form.dominio}
                    onChange={e => setForm(f => ({ ...f, dominio: e.target.value }))}
                    placeholder="cliente.com.br"
                    className="font-mono text-sm"
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Deixe em branco pra usar o subdomínio automático (<span className="font-mono">{form.slug || 'slug'}.seudominio.com</span>) —
                    não precisa configurar DNS nenhum. Domínio próprio exige apontar o DNS do cliente pro servidor.
                  </p>
                </div>

                <div className="sm:col-span-2 border-t pt-4 mt-1">
                  <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-3">Loja e responsável (login inicial)</p>
                </div>

                <div>
                  <Label>Nome da loja</Label>
                  <Input
                    value={form.nome_loja}
                    onChange={e => setForm(f => ({ ...f, nome_loja: e.target.value }))}
                    placeholder={form.nome || 'Ex.: Pizzaria do João'}
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">Vazio = usa o nome do cliente.</p>
                </div>
                <div>
                  <Label>Categoria da loja</Label>
                  <Input
                    list="categorias-loja-sugestoes"
                    value={form.categoria}
                    onChange={e => setForm(f => ({ ...f, categoria: e.target.value }))}
                    placeholder="Ex.: Pizzaria"
                  />
                  <datalist id="categorias-loja-sugestoes">
                    {['Pizzaria', 'Hamburgueria', 'Açaiteria', 'Padaria', 'Sorveteria', 'Sushiteria', 'Restaurante', 'Lanchonete', 'Marmitaria', 'Doceria'].map(c => (
                      <option key={c} value={c} />
                    ))}
                  </datalist>
                  <p className="text-[11px] text-muted-foreground mt-1">Vazio = "Outros". Aparece na busca e nos filtros do cardápio.</p>
                </div>
                <div>
                  <Label>Nome do responsável *</Label>
                  <Input
                    required
                    value={form.dono_nome}
                    onChange={e => setForm(f => ({ ...f, dono_nome: e.target.value }))}
                    placeholder="Ex.: João da Silva"
                  />
                </div>
                <div>
                  <Label>E-mail de acesso *</Label>
                  <Input
                    required type="email"
                    value={form.email}
                    onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                    placeholder="joao@exemplo.com"
                  />
                </div>
                <div>
                  <Label>Senha inicial *</Label>
                  <Input
                    required type="text" minLength={6}
                    value={form.senha}
                    onChange={e => setForm(f => ({ ...f, senha: e.target.value }))}
                    placeholder="mín. 6 caracteres"
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">O cliente troca depois, na tela dele.</p>
                </div>
                <div>
                  <Label>Telefone (opcional)</Label>
                  <Input
                    value={form.telefone}
                    onChange={e => setForm(f => ({ ...f, telefone: e.target.value }))}
                    placeholder="(11) 99999-9999"
                  />
                </div>

                <div className="sm:col-span-2 flex gap-2">
                  <Button type="submit" disabled={enviando || !form.nome.trim() || !form.dono_nome.trim() || !form.email.trim() || form.senha.length < 6}>
                    {enviando ? 'Criando…' : 'Criar e continuar'} <ArrowRight className="size-4" />
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setCriando(false)}>Cancelar</Button>
                </div>
              </form>
              )}
            </CardContent>
          </Card>
        )}

        {/* Lista */}
        {consulta.isLoading ? (
          <div className="space-y-2">{[1, 2].map(i => <Skeleton key={i} className="h-24" />)}</div>
        ) : tenants.length === 0 ? (
          <Card><CardContent className="p-10 text-center text-muted-foreground">
            Nenhum cliente ainda. Clique em "Novo cliente".
          </CardContent></Card>
        ) : (
          <div className="space-y-3">
            {tenants.map(t => (
              <TenantCard key={t.id} t={t} onToggle={() => alternarAtivo(t)} onSalvarDominio={d => salvarDominio(t, d)} />
            ))}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}

/* ─────────────────────── Assistente de criação: stepper + etapas ─────────────────────── */

const PASSOS_ASSISTENTE = [
  { chave: 'cliente', label: 'Cliente', icone: Building2 },
  { chave: 'endereco', label: 'Endereço', icone: MapPin },
  { chave: 'visual', label: 'Visual', icone: Palette },
  { chave: 'fiscal', label: 'Fiscal', icone: FileText },
] as const;

function Estepes({ atual }: { atual: typeof PASSOS_ASSISTENTE[number]['chave'] }) {
  const idxAtual = PASSOS_ASSISTENTE.findIndex(p => p.chave === atual);
  return (
    <div className="flex items-center gap-1.5">
      {PASSOS_ASSISTENTE.map((p, i) => {
        const feito = i < idxAtual;
        const ativo = i === idxAtual;
        const Icone = p.icone;
        return (
          <div key={p.chave} className="flex items-center gap-1.5 flex-1">
            <div className={cn(
              'flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-bold whitespace-nowrap',
              ativo ? 'bg-primary text-primary-foreground' : feito ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground',
            )}>
              {feito ? <Check className="size-3.5" /> : <Icone className="size-3.5" />}
              <span className="hidden sm:inline">{p.label}</span>
            </div>
            {i < PASSOS_ASSISTENTE.length - 1 && <div className={cn('h-0.5 flex-1 rounded-full', feito ? 'bg-primary/40' : 'bg-border')} />}
          </div>
        );
      })}
    </div>
  );
}

/** Etapa 2: endereço, taxa de entrega e tempo estimado. */
function EtapaEndereco({ tenantId, lojaId, onVoltar, onProximo }: {
  tenantId: number; lojaId: number; onVoltar: () => void; onProximo: () => void;
}) {
  const { mostrar } = useToast();
  const [endereco, setEndereco] = useState('');
  const [taxa, setTaxa] = useState('0');
  const [tempo, setTempo] = useState('40');
  const [salvando, setSalvando] = useState(false);

  async function salvarEAvancar() {
    setSalvando(true);
    try {
      if (endereco.trim()) {
        await api('PUT', `/api/admin/lojas/${lojaId}/detalhes?tenant_id=${tenantId}`, {
          endereco: endereco.trim(),
          taxa_entrega_centavos: Math.round(Number(taxa.replace(',', '.')) * 100) || 0,
          tempo_estimado_min: Number(tempo) || 40,
        });
      }
      onProximo();
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally { setSalvando(false); }
  }

  return (
    <div className="space-y-4">
      <div>
        <Label>Endereço da loja</Label>
        <Input value={endereco} onChange={e => setEndereco(e.target.value)} placeholder="Rua Exemplo, 123 - Bairro, Cidade - UF" />
        <p className="text-[11px] text-muted-foreground mt-1">Usado pro mapa e pra calcular distância de entrega. Pode deixar em branco e completar depois.</p>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Taxa de entrega (R$)</Label>
          <Input value={taxa} onChange={e => setTaxa(e.target.value)} placeholder="0,00" />
        </div>
        <div>
          <Label>Tempo estimado (min)</Label>
          <Input type="number" min="1" value={tempo} onChange={e => setTempo(e.target.value)} />
        </div>
      </div>
      <div className="flex gap-2 pt-2">
        <Button type="button" onClick={salvarEAvancar} disabled={salvando}>
          {salvando ? 'Salvando…' : 'Próximo'} <ArrowRight className="size-4" />
        </Button>
        <Button type="button" variant="ghost" onClick={onProximo}><SkipForward className="size-4" /> Pular</Button>
        <Button type="button" variant="outline" onClick={onVoltar}><ArrowLeft className="size-4" /> Voltar</Button>
      </div>
    </div>
  );
}

/** Etapa 3: cor da marca e imagens (logo/capa). */
function EtapaVisual({ tenantId, lojaId, onVoltar, onProximo }: {
  tenantId: number; lojaId: number; onVoltar: () => void; onProximo: () => void;
}) {
  const { mostrar } = useToast();
  const [corMarca, setCorMarca] = useState('#dc2640');
  const [corSecundaria, setCorSecundaria] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [capaUrl, setCapaUrl] = useState('');
  const [salvando, setSalvando] = useState(false);

  async function salvarEAvancar() {
    setSalvando(true);
    try {
      await api('PUT', `/api/admin/lojas/${lojaId}/detalhes?tenant_id=${tenantId}`, {
        cor_marca: corMarca, cor_secundaria: corSecundaria, logo_url: logoUrl, capa_url: capaUrl,
      });
      onProximo();
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally { setSalvando(false); }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Cor da marca</Label>
          <div className="flex items-center gap-2">
            <input type="color" value={corMarca} onChange={e => setCorMarca(e.target.value)} className="size-10 rounded-lg border border-input cursor-pointer" />
            <Input value={corMarca} onChange={e => setCorMarca(e.target.value)} className="font-mono text-sm" />
          </div>
        </div>
        <div>
          <Label>Cor secundária (opcional)</Label>
          <div className="flex items-center gap-2">
            <input type="color" value={corSecundaria || '#ffffff'} onChange={e => setCorSecundaria(e.target.value)} className="size-10 rounded-lg border border-input cursor-pointer" />
            <Input value={corSecundaria} onChange={e => setCorSecundaria(e.target.value)} placeholder="vazio = deriva da primária" className="font-mono text-sm" />
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <ImageUpload label="Logo" value={logoUrl} onChange={setLogoUrl} aspectRatio="square" />
        <ImageUpload label="Capa" value={capaUrl} onChange={setCapaUrl} aspectRatio="wide" />
      </div>
      <div className="flex gap-2 pt-2">
        <Button type="button" onClick={salvarEAvancar} disabled={salvando}>
          {salvando ? 'Salvando…' : 'Próximo'} <ArrowRight className="size-4" />
        </Button>
        <Button type="button" variant="ghost" onClick={onProximo}><SkipForward className="size-4" /> Pular</Button>
        <Button type="button" variant="outline" onClick={onVoltar}><ArrowLeft className="size-4" /> Voltar</Button>
      </div>
    </div>
  );
}

/** Etapa 4: dados fiscais básicos (NFC-e) — CNPJ com autopreenchimento. Certificado A1 e produtos ficam pra depois, em Admin → Lojas. */
function EtapaFiscal({ tenantId, lojaId, email, onVoltar, onConcluir }: {
  tenantId: number; lojaId: number; email: string; onVoltar: () => void; onConcluir: () => void;
}) {
  const { mostrar } = useToast();
  const [ativo, setAtivo] = useState(false);
  const [cnpj, setCnpj] = useState('');
  const [razaoSocial, setRazaoSocial] = useState('');
  const [ie, setIe] = useState('');
  const [uf, setUf] = useState('');
  const [municipio, setMunicipio] = useState('');
  const [cmun, setCmun] = useState('');
  const [logradouro, setLogradouro] = useState('');
  const [numero, setNumero] = useState('');
  const [bairro, setBairro] = useState('');
  const [cep, setCep] = useState('');
  const [buscando, setBuscando] = useState(false);
  const [salvando, setSalvando] = useState(false);

  async function aoDigitarCnpj(bruto: string) {
    const digitos = cnpjDigitos(bruto);
    setCnpj(digitos);
    if (digitos.length !== 14) return;
    setBuscando(true);
    const d = await buscarCnpj(digitos);
    setBuscando(false);
    if (!d) { mostrar({ tipo: 'erro', titulo: 'CNPJ não encontrado.' }); return; }
    setRazaoSocial(d.razao_social || '');
    setUf(d.uf || '');
    setCmun(d.cmun || '');
    setMunicipio(d.municipio || '');
    setLogradouro(d.logradouro || '');
    setNumero(d.numero || '');
    setBairro(d.bairro || '');
    setCep(d.cep || '');
    mostrar({ tipo: 'sucesso', titulo: 'Dados do CNPJ preenchidos!' });
  }

  async function concluir() {
    setSalvando(true);
    try {
      if (cnpj) {
        await api('PUT', `/api/admin/lojas/${lojaId}/fiscal?tenant_id=${tenantId}`, {
          ativo, cnpj, razao_social: razaoSocial, ie, uf, municipio, cmun, logradouro, numero, bairro, cep,
        });
      }
      mostrar({ tipo: 'sucesso', titulo: 'Cliente pronto!', descricao: `Já pode entrar com ${email}.` });
      onConcluir();
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally { setSalvando(false); }
  }

  return (
    <div className="space-y-4">
      <label className="flex items-center gap-2 cursor-pointer">
        <button type="button" onClick={() => setAtivo(v => !v)}
          className={cn('relative h-5 w-9 rounded-full transition-colors shrink-0', ativo ? 'bg-primary' : 'bg-muted-foreground/30')}>
          <span className={cn('absolute top-0.5 size-4 rounded-full bg-white shadow transition-all', ativo ? 'left-[18px]' : 'left-0.5')} />
        </button>
        <span className="text-sm font-medium">Emitir NFC-e nas vendas desta loja</span>
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label>CNPJ</Label>
          <div className="relative">
            <Input value={formatarCnpj(cnpj)} onChange={e => aoDigitarCnpj(e.target.value)} maxLength={18} className="font-mono" placeholder="00.000.000/0000-00" />
            {buscando && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 size-4 animate-spin text-muted-foreground" />}
          </div>
        </div>
        <div>
          <Label>Razão social</Label>
          <Input value={razaoSocial} onChange={e => setRazaoSocial(e.target.value)} />
        </div>
        <div>
          <Label>Inscrição Estadual</Label>
          <Input value={ie} onChange={e => setIe(e.target.value)} />
        </div>
        <div>
          <Label>UF</Label>
          <Input value={uf} onChange={e => setUf(e.target.value.toUpperCase().slice(0, 2))} maxLength={2} className="uppercase font-mono" />
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Certificado A1, CSC e os campos fiscais dos produtos ficam pra depois — em <strong>Admin → Lojas</strong>, clicando nessa loja.
      </p>

      <div className="flex gap-2 pt-2">
        <Button type="button" onClick={concluir} disabled={salvando}>
          {salvando ? 'Salvando…' : 'Concluir'} <Check className="size-4" />
        </Button>
        <Button type="button" variant="ghost" onClick={onConcluir}><SkipForward className="size-4" /> Pular e concluir</Button>
        <Button type="button" variant="outline" onClick={onVoltar}><ArrowLeft className="size-4" /> Voltar</Button>
      </div>
    </div>
  );
}

function TenantCard({ t, onToggle, onSalvarDominio }: {
  t: Tenant; onToggle: () => void; onSalvarDominio: (d: string) => void;
}) {
  const { mostrar } = useToast();
  const [editandoDom, setEditandoDom] = useState(false);
  const [dom, setDom] = useState(t.dominio || '');
  const [baixando, setBaixando] = useState(false);
  const [entrando, setEntrando] = useState(false);
  const master = t.slug === 'padrao';

  async function entrarComoLojista() {
    setEntrando(true);
    try {
      const token = tokenSessao();
      const resp = await fetch(`/api/admin/tenants/${t.id}/impersonar`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const corpo = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(corpo.erro || `Falha ao entrar (HTTP ${resp.status}).`);
      // Mesmo domínio que você está usando agora — o token já carrega qual
      // banco usar, não precisa do domínio próprio desse cliente.
      window.open(`/lojista?entrar=${encodeURIComponent(corpo.token)}`, '_blank');
    } catch (err) {
      mostrar({ tipo: 'erro', titulo: err instanceof Error ? err.message : 'Falha ao entrar como lojista.' });
    } finally {
      setEntrando(false);
    }
  }

  async function baixarBackup() {
    setBaixando(true);
    try {
      const token = tokenSessao();
      const resp = await fetch(`/api/admin/tenants/${t.id}/backup`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!resp.ok) {
        const corpo = await resp.json().catch(() => ({}));
        throw new Error(corpo.erro || `Falha ao gerar o backup (HTTP ${resp.status}).`);
      }
      const blob = await resp.blob();
      const nome = resp.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1]
        || `backup-${t.slug}-${new Date().toISOString().slice(0, 10)}.sql.gz`;
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
    <Card className={cn(!t.ativo && 'opacity-60')}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start gap-3">
          <div className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary shrink-0">
            <Building2 className="size-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold">{t.nome}</span>
              {master && <Badge variant="outline">principal</Badge>}
              {t.ativo ? <Badge variant="success">ativo</Badge> : <Badge variant="secondary">suspenso</Badge>}
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1 flex-wrap">
              <span className="font-mono">{t.slug}</span>
              <span className="flex items-center gap-1"><Store className="size-3" /> {t.lojas} loja(s)</span>
              <span className="flex items-center gap-1"><Database className="size-3" /> {t.db_nome}</span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {!master && (
              <Button variant="ghost" size="sm" onClick={entrarComoLojista} disabled={entrando} title="Entrar no painel dessa loja sem senha">
                {entrando ? <Loader2 className="size-4 animate-spin" /> : <LogIn className="size-4" />}
                <span className="hidden sm:inline">Entrar</span>
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={baixarBackup} disabled={baixando} title="Baixar backup deste cliente">
              {baixando ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
              <span className="hidden sm:inline">Backup</span>
            </Button>
            {!master && (
              <Button variant="ghost" size="sm" onClick={onToggle}>
                <Power className="size-4" /> {t.ativo ? 'Suspender' : 'Ativar'}
              </Button>
            )}
          </div>
        </div>

        {/* Domínio */}
        <div className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2">
          <Globe className="size-4 text-muted-foreground shrink-0" />
          {editandoDom ? (
            <>
              <Input value={dom} onChange={e => setDom(e.target.value)} placeholder="cliente.com.br" className="h-8 font-mono text-sm flex-1" />
              <Button size="sm" onClick={() => { onSalvarDominio(dom); setEditandoDom(false); }}>Salvar</Button>
              <Button size="sm" variant="ghost" onClick={() => { setDom(t.dominio || ''); setEditandoDom(false); }}>Cancelar</Button>
            </>
          ) : (
            <>
              <span className="flex-1 text-sm font-mono truncate">
                {t.dominio || <span className="text-muted-foreground not-italic">sem domínio</span>}
              </span>
              {t.dominio && (
                <button onClick={() => window.open(`https://${t.dominio}`, '_blank')}
                  className="text-muted-foreground hover:text-primary" title="Abrir site">
                  <ExternalLink className="size-4" />
                </button>
              )}
              {!master && (
                <button onClick={() => setEditandoDom(true)} className="text-xs font-semibold text-primary hover:underline">
                  {t.dominio ? 'editar' : 'definir'}
                </button>
              )}
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
