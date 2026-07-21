/**
 * Tela "Conta": login + cadastro de cliente. Após login, mostra perfil.
 */
import { useRef, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  UserPlus, User, MapPin, Lock, Pencil, Plus, Trash2, Save, X, Check, Loader2,
  Eye, EyeOff, ArrowRight, ShieldCheck, Phone, Mail,
} from 'lucide-react';
import { api, ApiError, salvarSessao, sessaoUsuario, encerrarSessao, tenantDemoAtivo } from '@/lib/api';
import { useTema } from '@/lib/tema';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';
import { useCarrinho } from '@/lib/carrinho';
import { buscarCep, formatarCep, cepDigitos } from '@/lib/cep';
import { formatarCpf, cpfDigitos, cpfValido } from '@/lib/cpf';
import { telefoneDigitos, formatarTelefone } from '@/lib/telefone';
import type { UsuarioSessao, Endereco } from '@/types';

export function PaginaConta() {
  const usuario = sessaoUsuario();
  const navigate = useNavigate();
  const carrinho = useCarrinho();
  const { mostrar } = useToast();

  if (usuario) {
    return <PainelConta usuario={usuario} aoSair={() => { encerrarSessao(); navigate('/'); window.location.reload(); }} />;
  }

  async function aoLogar(usr: UsuarioSessao) {
    mostrar({ tipo: 'sucesso', titulo: `Bem-vindo(a), ${usr.nome.split(' ')[0]}!` });
    // Na vitrine de demonstração, "/" é a landing do tenant MASTER (não a loja).
    // Volta pra loja demo (/demo/:slug re-resolve pra /loja/:id) em vez de jogar
    // o cliente recém-logado pra fora da loja que ele estava navegando.
    const slugDemo = tenantDemoAtivo();
    if (carrinho) navigate('/carrinho');
    else if (slugDemo) navigate(`/demo/${slugDemo}`);
    else navigate('/');
  }

  return <TelaAuth onLogar={aoLogar} />;
}

/* ─────────────────── Tela de login/cadastro (deslogado) ─────────────────── */
function TelaAuth({ onLogar }: { onLogar: (u: UsuarioSessao) => void }) {
  const { marca } = useTema();
  const cadastroRef = useRef<HTMLDivElement>(null);

  function irParaCadastro() {
    cadastroRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // Foca o primeiro campo do cadastro (depois do scroll no mobile).
    setTimeout(() => cadastroRef.current?.querySelector('input')?.focus(), 400);
  }

  return (
    <div className="lg:grid lg:grid-cols-2 lg:gap-6 lg:items-stretch">
      {/* ── Coluna esquerda: hero + login ── */}
      <div className="animate-[fadeUp_.5s_ease-out] overflow-hidden rounded-3xl border border-border bg-card shadow-sm">
        <HeroAuth nome={marca.nome} banner={marca.login_banner_url} />
        <div className="p-6 sm:p-8">
          <h1 className="text-2xl font-extrabold tracking-tight">
            Bem-vindo de volta! <span className="inline-block">👋</span>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">Entre para continuar acompanhando seus pedidos.</p>
          <FormLogin onLogar={onLogar} irParaCadastro={irParaCadastro} />
        </div>
      </div>

      {/* ── Coluna direita: cadastro ── */}
      <div ref={cadastroRef} className="mt-4 lg:mt-0 animate-[fadeUp_.5s_ease-out_.08s_both] rounded-3xl border border-border bg-card p-6 shadow-sm sm:p-8">
        <div className="flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <UserPlus className="size-5" />
          </div>
          <div>
            <h2 className="text-xl font-extrabold tracking-tight">Criar conta de cliente</h2>
            <p className="text-sm text-muted-foreground">Preencha os dados abaixo para criar sua conta.</p>
          </div>
        </div>
        <FormCadastro onLogar={onLogar} />
      </div>

      {/* keyframe local do fade-up (não depende de config do Tailwind) */}
      <style>{`@keyframes fadeUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}`}</style>
    </div>
  );
}

/* Hero do topo do card de login. Se o admin definiu um banner próprio
   (Admin → Marca → Banner do login), mostra a imagem; senão, a ilustração
   padrão desenhada em SVG com a cor da marca. */
function HeroAuth({ nome, banner }: { nome: string; banner?: string }) {
  if (banner) {
    return (
      <div className="relative h-40 overflow-hidden sm:h-48">
        <img src={banner} alt="" className="absolute inset-0 size-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/10 to-transparent" />
        <div className="absolute bottom-3 left-4 text-[11px] font-bold uppercase tracking-widest text-white/85 drop-shadow">
          {nome}
        </div>
      </div>
    );
  }
  return (
    <div className="relative h-40 overflow-hidden bg-gradient-to-br from-primary via-primary to-primary/70 sm:h-48">
      {/* brilhos decorativos */}
      <div className="absolute -left-10 -top-10 size-40 rounded-full bg-white/15 blur-2xl" />
      <div className="absolute -bottom-16 right-6 size-44 rounded-full bg-black/10 blur-2xl" />
      {/* padrão de bolinhas */}
      <svg className="absolute inset-0 size-full opacity-[0.12]" aria-hidden="true">
        <defs>
          <pattern id="pts" width="22" height="22" patternUnits="userSpaceOnUse">
            <circle cx="2" cy="2" r="1.5" fill="#fff" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#pts)" />
      </svg>

      {/* Composição: telefone com cardápio + itens flutuando + pin */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="relative">
          {/* telefone */}
          <div className="w-28 rotate-[-6deg] rounded-2xl border-4 border-white/90 bg-white p-2 shadow-2xl sm:w-32">
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <div className="flex size-6 items-center justify-center rounded-md bg-primary/15 text-sm">🍕</div>
                <div className="flex-1 space-y-1">
                  <div className="h-1.5 w-10 rounded-full bg-neutral-300" />
                  <div className="h-1.5 w-6 rounded-full bg-primary/40" />
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="flex size-6 items-center justify-center rounded-md bg-primary/15 text-sm">🍔</div>
                <div className="flex-1 space-y-1">
                  <div className="h-1.5 w-9 rounded-full bg-neutral-300" />
                  <div className="h-1.5 w-5 rounded-full bg-primary/40" />
                </div>
              </div>
            </div>
          </div>
          {/* pin de localização */}
          <div className="absolute -left-8 top-1 flex size-9 items-center justify-center rounded-full rounded-bl-none bg-white shadow-lg sm:-left-10">
            <MapPin className="size-4 text-primary" />
          </div>
          {/* sacola de entrega flutuando */}
          <div className="absolute -right-9 bottom-0 flex size-11 items-center justify-center rounded-2xl bg-white text-lg shadow-lg sm:-right-11">🛵</div>
          {/* emojis soltos */}
          <div className="absolute -right-4 -top-6 text-xl drop-shadow">🥤</div>
        </div>
      </div>

      {/* rótulo da marca no canto */}
      <div className="absolute bottom-3 left-4 text-[11px] font-bold uppercase tracking-widest text-white/70">
        {nome}
      </div>
    </div>
  );
}

/* ─────────────────── Painel da conta (logado) ─────────────────── */
function PainelConta({ usuario, aoSair }: { usuario: UsuarioSessao; aoSair: () => void }) {
  return (
    <div className="space-y-4">
      <PerfilSecao usuario={usuario} />
      <EnderecosSecao />
      <SenhaSecao />
      <Button variant="outline" size="lg" className="w-full" onClick={aoSair}>
        Sair da conta
      </Button>
    </div>
  );
}

function PerfilSecao({ usuario }: { usuario: UsuarioSessao }) {
  const { mostrar } = useToast();
  const [editando, setEditando] = useState(false);
  const [nome, setNome] = useState(usuario.nome);
  const [telefone, setTelefone] = useState(formatarTelefone(usuario.telefone || ''));
  const [enviando, setEnviando] = useState(false);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    try {
      await api('PUT', '/api/cliente/perfil', { nome, telefone });
      salvarSessao(localStorage.getItem('token:cliente') || '', { ...usuario, nome, telefone }, 'cliente');
      mostrar({ tipo: 'sucesso', titulo: 'Perfil atualizado!' });
      setEditando(false);
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally { setEnviando(false); }
  }

  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-center gap-4">
          <div className="flex size-16 items-center justify-center rounded-full bg-gradient-to-br from-primary to-rose-500 text-white shrink-0">
            <User className="size-7" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-bold truncate">{usuario.nome}</h2>
            {usuario.cpf && <p className="text-sm text-muted-foreground truncate">CPF {formatarCpf(usuario.cpf)}</p>}
            {usuario.email && !usuario.email.endsWith('@cliente.local') && (
              <p className="text-xs text-muted-foreground truncate">{usuario.email}</p>
            )}
            {usuario.telefone && <p className="text-xs text-muted-foreground">{formatarTelefone(usuario.telefone)}</p>}
          </div>
          {!editando && (
            <Button variant="ghost" size="icon" onClick={() => setEditando(true)} title="Editar perfil">
              <Pencil className="size-4" />
            </Button>
          )}
        </div>

        {editando && (
          <form onSubmit={salvar} className="space-y-3 mt-4 border-t pt-4">
            <div>
              <Label htmlFor="perfil-nome">Nome</Label>
              <Input id="perfil-nome" required value={nome} onChange={e => setNome(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="perfil-tel">Telefone</Label>
              <Input id="perfil-tel" type="tel" value={telefone} onChange={e => setTelefone(formatarTelefone(e.target.value))} placeholder="(11) 99999-9999" />
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={enviando}><Save className="size-4" /> {enviando ? 'Salvando…' : 'Salvar'}</Button>
              <Button type="button" variant="ghost" onClick={() => { setEditando(false); setNome(usuario.nome); setTelefone(formatarTelefone(usuario.telefone || '')); }}>Cancelar</Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

const ENDERECO_VAZIO = { rotulo: 'Casa', rua: '', numero: '', complemento: '', bairro: '', cidade: '', uf: '', cep: '', referencia: '' };

function EnderecosSecao() {
  const { mostrar } = useToast();
  const confirmar = useConfirm();
  const qc = useQueryClient();
  const [form, setForm] = useState<typeof ENDERECO_VAZIO | null>(null);
  const [editId, setEditId] = useState<number | null>(null);

  const consulta = useQuery({
    queryKey: ['enderecos'],
    queryFn: () => api<{ enderecos: Endereco[] }>('GET', '/api/cliente/enderecos').then(r => r.enderecos),
  });
  const enderecos = consulta.data ?? [];

  function abrirNovo() { setEditId(null); setForm({ ...ENDERECO_VAZIO }); }
  function abrirEdicao(e: Endereco) {
    setEditId(e.id);
    setForm({
      rotulo: e.rotulo, rua: e.rua, numero: e.numero, complemento: e.complemento || '',
      bairro: e.bairro, cidade: e.cidade, uf: e.uf, cep: e.cep || '', referencia: e.referencia || '',
    });
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    try {
      if (editId) await api('PUT', `/api/cliente/enderecos/${editId}`, form);
      else await api('POST', '/api/cliente/enderecos', form);
      mostrar({ tipo: 'sucesso', titulo: editId ? 'Endereço atualizado!' : 'Endereço adicionado!' });
      setForm(null); setEditId(null);
      qc.invalidateQueries({ queryKey: ['enderecos'] });
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    }
  }

  async function excluir(e: Endereco) {
    if (!(await confirmar({ titulo: `Excluir o endereço "${e.rotulo}"?`, confirmar: 'Excluir', destrutivo: true }))) return;
    try {
      await api('DELETE', `/api/cliente/enderecos/${e.id}`);
      mostrar({ tipo: 'sucesso', titulo: 'Endereço removido.' });
      qc.invalidateQueries({ queryKey: ['enderecos'] });
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    }
  }

  function set<K extends keyof typeof ENDERECO_VAZIO>(k: K, v: string) {
    setForm(f => f ? { ...f, [k]: v } : f);
  }

  const [buscandoCep, setBuscandoCep] = useState(false);
  async function aoDigitarCep(bruto: string) {
    const cep = formatarCep(bruto);
    setForm(f => f ? { ...f, cep } : f);
    if (cepDigitos(cep).length !== 8) return;
    setBuscandoCep(true);
    const achado = await buscarCep(cep);
    setBuscandoCep(false);
    if (achado) setForm(f => f ? { ...f, cep, rua: achado.rua, bairro: achado.bairro, cidade: achado.cidade, uf: achado.uf } : f);
  }

  return (
    <Card>
      <CardContent className="p-6 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 font-bold"><MapPin className="size-4 text-primary" /> Meus endereços</h3>
          {!form && <Button size="sm" variant="outline" onClick={abrirNovo}><Plus className="size-4" /> Novo</Button>}
        </div>

        {consulta.isLoading && <Skeleton className="h-16" />}
        {!consulta.isLoading && enderecos.length === 0 && !form && (
          <p className="text-sm text-muted-foreground py-2">Nenhum endereço salvo ainda.</p>
        )}

        {enderecos.map(e => (
          <div key={e.id} className="flex items-start gap-3 rounded-xl border border-border p-3">
            <MapPin className="size-4 mt-0.5 text-muted-foreground shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{e.rotulo}</div>
              <div className="text-sm font-semibold">{e.rua}, {e.numero}{e.complemento ? ` · ${e.complemento}` : ''}</div>
              <div className="text-xs text-muted-foreground">{e.bairro} · {e.cidade}/{e.uf}</div>
            </div>
            <button onClick={() => abrirEdicao(e)} className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground shrink-0" title="Editar"><Pencil className="size-3.5" /></button>
            <button onClick={() => excluir(e)} className="p-1.5 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive shrink-0" title="Excluir"><Trash2 className="size-3.5" /></button>
          </div>
        ))}

        {form && (
          <form onSubmit={salvar} className="space-y-2 border-t pt-3">
            <div className="grid grid-cols-2 gap-2">
              <Input placeholder="Rótulo (Casa, Trabalho)" value={form.rotulo} onChange={ev => set('rotulo', ev.target.value)} />
              <div className="relative">
                <Input placeholder="CEP" inputMode="numeric" value={form.cep} onChange={ev => aoDigitarCep(ev.target.value)} />
                {buscandoCep && <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 size-4 animate-spin text-muted-foreground" />}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Input className="col-span-2" placeholder="Rua" required value={form.rua} onChange={ev => set('rua', ev.target.value)} />
              <Input placeholder="Número" required value={form.numero} onChange={ev => set('numero', ev.target.value)} />
            </div>
            <Input placeholder="Complemento (opcional)" value={form.complemento} onChange={ev => set('complemento', ev.target.value)} />
            <div className="grid grid-cols-3 gap-2">
              <Input className="col-span-2" placeholder="Bairro" required value={form.bairro} onChange={ev => set('bairro', ev.target.value)} />
              <Input placeholder="Cidade" required value={form.cidade} onChange={ev => set('cidade', ev.target.value)} />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Input placeholder="UF" maxLength={2} required value={form.uf} onChange={ev => set('uf', ev.target.value)} />
              <Input className="col-span-2" placeholder="Ponto de referência" value={form.referencia} onChange={ev => set('referencia', ev.target.value)} />
            </div>
            <div className="flex gap-2">
              <Button type="submit" size="sm"><Check className="size-4" /> {editId ? 'Salvar' : 'Adicionar'}</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => { setForm(null); setEditId(null); }}><X className="size-4" /> Cancelar</Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function SenhaSecao() {
  const { mostrar } = useToast();
  const [aberto, setAberto] = useState(false);
  const [atual, setAtual] = useState('');
  const [nova, setNova] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    try {
      await api('PUT', '/api/cliente/senha', { senha_atual: atual, senha_nova: nova });
      mostrar({ tipo: 'sucesso', titulo: 'Senha alterada!' });
      setAtual(''); setNova(''); setAberto(false);
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally { setEnviando(false); }
  }

  return (
    <Card>
      <CardContent className="p-6 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 font-bold"><Lock className="size-4 text-primary" /> Segurança</h3>
          {!aberto && <Button size="sm" variant="outline" onClick={() => setAberto(true)}>Trocar senha</Button>}
        </div>
        {aberto && (
          <form onSubmit={salvar} className="space-y-3">
            <div>
              <Label htmlFor="senha-atual">Senha atual</Label>
              <Input id="senha-atual" type="password" required value={atual} onChange={e => setAtual(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="senha-nova">Nova senha (mínimo 6)</Label>
              <Input id="senha-nova" type="password" minLength={6} required value={nova} onChange={e => setNova(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={enviando}><Save className="size-4" /> {enviando ? 'Salvando…' : 'Salvar senha'}</Button>
              <Button type="button" variant="ghost" onClick={() => { setAberto(false); setAtual(''); setNova(''); }}>Cancelar</Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

/* Campo de texto com ícone à esquerda. */
function CampoIcone({ icone: Icone, ...props }: { icone: React.ComponentType<{ className?: string }> } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="relative">
      <Icone className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input {...props} className="pl-10" />
    </div>
  );
}

/* Campo de senha com ícone de cadeado + botão de mostrar/ocultar. */
function CampoSenha({ id, value, onChange, autoComplete, minLength }: {
  id: string; value: string; onChange: (v: string) => void; autoComplete: string; minLength?: number;
}) {
  const [ver, setVer] = useState(false);
  return (
    <div className="relative">
      <Lock className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input id={id} type={ver ? 'text' : 'password'} autoComplete={autoComplete} minLength={minLength}
        required value={value} onChange={e => onChange(e.target.value)} placeholder="Digite sua senha" className="pl-10 pr-11" />
      <button type="button" onClick={() => setVer(v => !v)} tabIndex={-1}
        aria-label={ver ? 'Ocultar senha' : 'Mostrar senha'}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground">
        {ver ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}

function FormLogin({ onLogar, irParaCadastro }: { onLogar: (u: UsuarioSessao) => void; irParaCadastro: () => void }) {
  const [identificador, setIdentificador] = useState('');
  const [senha, setSenha] = useState('');
  const [lembrar, setLembrar] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const { mostrar } = useToast();
  const { marca } = useTema();

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    const valor = identificador.trim();
    if (!valor) { mostrar({ tipo: 'erro', titulo: 'Informe seu e-mail ou telefone.' }); return; }
    // Detecta o formato: tem "@" → e-mail; senão → telefone (backend também
    // aceita CPF nesse mesmo campo como fallback, pra contas antigas).
    const ehEmail = valor.includes('@');
    setEnviando(true);
    try {
      const r = await api<{ token: string; usuario: UsuarioSessao }>(
        'POST', '/api/auth/login',
        {
          email: ehEmail ? valor.toLowerCase() : undefined,
          telefone: ehEmail ? undefined : telefoneDigitos(valor),
          senha, loja_id: marca.loja_id || null,
        },
      );
      // /api/auth/login é compartilhado entre áreas (não sabe se quem chamou
      // quer um cliente, lojista, entregador...) — se o e-mail/telefone bater
      // com uma conta de OUTRO perfil (ex.: o admin/lojista testando com o
      // próprio e-mail aqui), o backend devolve esse perfil numa boa. Sem essa
      // checagem, a área cliente salvava a sessão mesmo assim e toda rota
      // /api/cliente/* subsequente dava 403 (perfil não bate) — sessão "logada"
      // mas quebrada em tudo.
      if (r.usuario.perfil !== 'cliente') {
        mostrar({ tipo: 'erro', titulo: 'Essa conta não é de cliente.', descricao: 'Use a área correta pra entrar (lojista, entregador ou admin).' });
        return;
      }
      salvarSessao(r.token, r.usuario, 'cliente', lembrar);
      onLogar(r.usuario);
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={enviar} className="mt-6 space-y-4">
      <div>
        <Label htmlFor="login-identificador">E-mail ou telefone</Label>
        <CampoIcone icone={User} id="login-identificador" autoComplete="username" placeholder="seu@email.com ou (11) 99999-9999"
          required value={identificador} onChange={e => setIdentificador((e.target as HTMLInputElement).value)} className="mt-1.5" />
      </div>
      <div>
        <Label htmlFor="login-senha">Senha</Label>
        <div className="mt-1.5">
          <CampoSenha id="login-senha" value={senha} onChange={setSenha} autoComplete="current-password" />
        </div>
        <div className="mt-1.5 text-right">
          <Link to="/esqueci-senha" className="text-sm font-medium text-primary hover:underline">
            Esqueci minha senha
          </Link>
        </div>
      </div>

      <label className="flex cursor-pointer select-none items-center gap-2.5 text-sm">
        <input type="checkbox" checked={lembrar} onChange={e => setLembrar(e.target.checked)}
          className="size-4 shrink-0 accent-[hsl(var(--primary))]" />
        Permanecer conectado
      </label>

      <Button type="submit" size="lg" className="w-full" disabled={enviando}>
        {enviando ? 'Entrando…' : <>Entrar <ArrowRight className="size-4" /></>}
      </Button>

      <p className="text-center text-sm text-muted-foreground lg:hidden">
        Não tem uma conta?{' '}
        <button type="button" onClick={irParaCadastro} className="font-semibold text-primary hover:underline">
          Criar conta
        </button>
      </p>
    </form>
  );
}

function FormCadastro({ onLogar }: { onLogar: (u: UsuarioSessao) => void }) {
  const [nome, setNome] = useState('');
  const [cpf, setCpf] = useState('');
  const [email, setEmail] = useState('');
  const [telefone, setTelefone] = useState('');
  const [senha, setSenha] = useState('');
  const [enviando, setEnviando] = useState(false);
  const { mostrar } = useToast();
  const { marca } = useTema();

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!cpfValido(cpf)) { mostrar({ tipo: 'erro', titulo: 'Informe um CPF válido.' }); return; }
    setEnviando(true);
    try {
      const r = await api<{ token: string; usuario: UsuarioSessao }>(
        'POST', '/api/auth/registrar',
        { nome, cpf: cpfDigitos(cpf), email, telefone, senha, perfil: 'cliente', loja_id: marca.loja_id || null },
      );
      salvarSessao(r.token, r.usuario);
      mostrar({ tipo: 'sucesso', titulo: 'Conta criada com sucesso!' });
      onLogar(r.usuario);
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={enviar} className="mt-6 space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="cad-nome">Nome completo</Label>
          <CampoIcone icone={User} id="cad-nome" autoComplete="name" placeholder="Seu nome completo"
            required value={nome} onChange={e => setNome((e.target as HTMLInputElement).value)} className="mt-1.5" />
        </div>
        <div>
          <Label htmlFor="cad-cpf">CPF</Label>
          <CampoIcone icone={User} id="cad-cpf" inputMode="numeric" placeholder="000.000.000-00" required
            value={cpf} onChange={e => setCpf(formatarCpf((e.target as HTMLInputElement).value))} className="mt-1.5" />
        </div>
        <div>
          <Label htmlFor="cad-tel">Telefone / WhatsApp</Label>
          <CampoIcone icone={Phone} id="cad-tel" type="tel" placeholder="(11) 99999-9999"
            value={telefone} onChange={e => setTelefone(formatarTelefone((e.target as HTMLInputElement).value))} className="mt-1.5" />
          <p className="mt-1 text-[11px] text-muted-foreground">Também pode ser usado pra entrar na sua conta.</p>
        </div>
        <div>
          <Label htmlFor="cad-email">E-mail <span className="font-normal text-muted-foreground">(opcional)</span></Label>
          <CampoIcone icone={Mail} id="cad-email" type="email" autoComplete="email" placeholder="seu@email.com"
            value={email} onChange={e => setEmail((e.target as HTMLInputElement).value)} className="mt-1.5" />
        </div>
      </div>
      <div>
        <Label htmlFor="cad-senha">Senha <span className="font-normal text-muted-foreground">(mínimo 6 caracteres)</span></Label>
        <div className="mt-1.5">
          <CampoSenha id="cad-senha" value={senha} onChange={setSenha} autoComplete="new-password" minLength={6} />
        </div>
      </div>

      <div className="flex items-center gap-2.5 rounded-xl bg-primary/5 px-4 py-3 text-sm text-muted-foreground">
        <ShieldCheck className="size-4 shrink-0 text-primary" />
        Seus dados estão protegidos e nunca serão compartilhados.
      </div>

      <Button type="submit" size="lg" variant="outline" className="w-full" disabled={enviando}>
        {enviando ? 'Criando…' : <><UserPlus className="size-4" /> Cadastrar</>}
      </Button>
    </form>
  );
}
