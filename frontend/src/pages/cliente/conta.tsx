/**
 * Tela "Conta": login + cadastro de cliente. Após login, mostra perfil.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LogIn, UserPlus, User, MapPin, Lock, Pencil, Plus, Trash2, Save, X, Check } from 'lucide-react';
import { api, ApiError, salvarSessao, sessaoUsuario, encerrarSessao } from '@/lib/api';
import { useTema } from '@/lib/tema';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { useCarrinho } from '@/lib/carrinho';
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
    if (carrinho) navigate('/carrinho');
    else navigate('/');
  }

  return (
    <div className="space-y-4">
      <FormLogin onLogar={aoLogar} />
      <FormCadastro onLogar={aoLogar} />
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
  const [telefone, setTelefone] = useState(usuario.telefone || '');
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
            <p className="text-sm text-muted-foreground truncate">{usuario.email}</p>
            {usuario.telefone && <p className="text-xs text-muted-foreground">{usuario.telefone}</p>}
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
              <Input id="perfil-tel" type="tel" value={telefone} onChange={e => setTelefone(e.target.value)} placeholder="(11) 99999-9999" />
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={enviando}><Save className="size-4" /> {enviando ? 'Salvando…' : 'Salvar'}</Button>
              <Button type="button" variant="ghost" onClick={() => { setEditando(false); setNome(usuario.nome); setTelefone(usuario.telefone || ''); }}>Cancelar</Button>
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
    if (!confirm(`Excluir o endereço "${e.rotulo}"?`)) return;
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
              <Input placeholder="CEP" value={form.cep} onChange={ev => set('cep', ev.target.value)} />
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

function FormLogin({ onLogar }: { onLogar: (u: UsuarioSessao) => void }) {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [enviando, setEnviando] = useState(false);
  const { mostrar } = useToast();
  const { marca } = useTema();

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    try {
      const r = await api<{ token: string; usuario: UsuarioSessao }>(
        'POST', '/api/auth/login',
        { email, senha, loja_id: marca.loja_id || null },
      );
      salvarSessao(r.token, r.usuario);
      onLogar(r.usuario);
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Card>
      <CardContent className="p-6">
        <h2 className="flex items-center gap-2 text-lg font-bold mb-4">
          <LogIn className="size-5 text-primary" />
          Entrar
        </h2>
        <form onSubmit={enviar} className="space-y-3">
          <div>
            <Label htmlFor="login-email">E-mail</Label>
            <Input id="login-email" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="login-senha">Senha</Label>
            <Input id="login-senha" type="password" autoComplete="current-password" required value={senha} onChange={e => setSenha(e.target.value)} />
          </div>
          <Button type="submit" size="lg" className="w-full" disabled={enviando}>
            {enviando ? 'Entrando…' : 'Entrar'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function FormCadastro({ onLogar }: { onLogar: (u: UsuarioSessao) => void }) {
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [telefone, setTelefone] = useState('');
  const [senha, setSenha] = useState('');
  const [enviando, setEnviando] = useState(false);
  const { mostrar } = useToast();
  const { marca } = useTema();

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    try {
      const r = await api<{ token: string; usuario: UsuarioSessao }>(
        'POST', '/api/auth/registrar',
        { nome, email, telefone, senha, perfil: 'cliente', loja_id: marca.loja_id || null },
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
    <Card>
      <CardContent className="p-6">
        <h2 className="flex items-center gap-2 text-lg font-bold mb-4">
          <UserPlus className="size-5 text-primary" />
          Criar conta de cliente
        </h2>
        <form onSubmit={enviar} className="space-y-3">
          <div>
            <Label htmlFor="cad-nome">Nome completo</Label>
            <Input id="cad-nome" autoComplete="name" required value={nome} onChange={e => setNome(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="cad-email">E-mail</Label>
            <Input id="cad-email" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="cad-tel">Telefone/WhatsApp</Label>
            <Input id="cad-tel" type="tel" placeholder="(11) 99999-9999" value={telefone} onChange={e => setTelefone(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="cad-senha">Senha (mínimo 6)</Label>
            <Input id="cad-senha" type="password" minLength={6} required value={senha} onChange={e => setSenha(e.target.value)} />
          </div>
          <Button type="submit" size="lg" variant="outline" className="w-full" disabled={enviando}>
            {enviando ? 'Criando…' : 'Cadastrar'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
