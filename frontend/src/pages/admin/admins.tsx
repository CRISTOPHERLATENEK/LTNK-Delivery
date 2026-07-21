/**
 * Gestão de admins — apenas o super admin acessa.
 * Cria/remove admins operacionais (que NÃO podem editar marca/comissão).
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Users, UserPlus, Trash2, Crown, Shield, ArrowUpCircle, ArrowDownCircle, Lock, X, KeyRound } from 'lucide-react';
import { AdminLayout } from './layout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';
import { api, ApiError, sessaoUsuario } from '@/lib/api';
import { dataLocal } from '@/lib/format';
import { cn } from '@/lib/utils';

interface Admin {
  id: number;
  nome: string;
  email: string;
  telefone: string;
  super_admin: 0 | 1;
  bloqueado: 0 | 1;
  criado_em: string;
}

export function TelaAdmins() {
  const { mostrar } = useToast();
  const confirmar = useConfirm();
  const eu = sessaoUsuario();

  const consulta = useQuery({
    queryKey: ['admins'],
    queryFn: () => api<{ admins: Admin[] }>('GET', '/api/admin/admins').then(r => r.admins),
  });

  const [form, setForm] = useState({ nome: '', email: '', telefone: '', senha: '' });
  const [enviando, setEnviando] = useState(false);
  const [alvoPromocao, setAlvoPromocao] = useState<{ admin: Admin; acao: 'promover' | 'rebaixar' } | null>(null);
  const [senhaPromocao, setSenhaPromocao] = useState('');
  const [enviandoPromocao, setEnviandoPromocao] = useState(false);

  const [formSenha, setFormSenha] = useState({ senha_atual: '', senha_nova: '', senha_confirma: '' });
  const [trocandoSenha, setTrocandoSenha] = useState(false);

  async function trocarMinhaSenha(e: React.FormEvent) {
    e.preventDefault();
    if (formSenha.senha_nova !== formSenha.senha_confirma) {
      mostrar({ tipo: 'erro', titulo: 'As senhas novas não coincidem.' });
      return;
    }
    setTrocandoSenha(true);
    try {
      await api('PUT', '/api/admin/minha-senha', {
        senha_atual: formSenha.senha_atual,
        senha_nova: formSenha.senha_nova,
      });
      mostrar({ tipo: 'sucesso', titulo: 'Senha alterada com sucesso!' });
      setFormSenha({ senha_atual: '', senha_nova: '', senha_confirma: '' });
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally {
      setTrocandoSenha(false);
    }
  }

  async function criar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    try {
      await api('POST', '/api/admin/admins', form);
      mostrar({ tipo: 'sucesso', titulo: 'Admin operacional criado!', descricao: `${form.nome} já pode entrar.` });
      setForm({ nome: '', email: '', telefone: '', senha: '' });
      consulta.refetch();
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally {
      setEnviando(false);
    }
  }

  async function remover(admin: Admin) {
    if (!(await confirmar({ titulo: `Remover ${admin.nome}?`, descricao: 'Ele perderá o acesso imediatamente.', confirmar: 'Remover', destrutivo: true }))) return;
    try {
      await api('DELETE', `/api/admin/admins/${admin.id}`);
      mostrar({ tipo: 'info', titulo: 'Admin removido.' });
      consulta.refetch();
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    }
  }

  async function confirmarPromocao() {
    if (!alvoPromocao) return;
    setEnviandoPromocao(true);
    try {
      await api('POST', `/api/admin/admins/${alvoPromocao.admin.id}/${alvoPromocao.acao}`, { senha: senhaPromocao });
      mostrar({
        tipo: 'sucesso',
        titulo: alvoPromocao.acao === 'promover' ? 'Promovido a super admin!' : 'Rebaixado a admin operacional.',
        descricao: alvoPromocao.admin.nome,
      });
      setAlvoPromocao(null);
      setSenhaPromocao('');
      consulta.refetch();
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally {
      setEnviandoPromocao(false);
    }
  }

  return (
    <AdminLayout titulo="Admins">
    <div className="space-y-5 max-w-3xl mx-auto">
      <div className="flex items-center gap-3">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
          <Users className="size-6" />
        </div>
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Gerenciar admins</h1>
          <p className="text-sm text-muted-foreground">
            Admins operacionais podem aprovar lojas e ver pedidos, mas não mexem na marca nem na comissão.
          </p>
        </div>
      </div>

      <Card>
        <CardContent className="p-5">
          <h2 className="flex items-center gap-2 font-bold mb-4">
            <KeyRound className="size-5 text-primary" />
            Trocar minha senha
          </h2>
          <form onSubmit={trocarMinhaSenha} className="space-y-3">
            <div>
              <Label htmlFor="senha-atual">Senha atual</Label>
              <Input
                id="senha-atual" type="password" required autoComplete="current-password"
                value={formSenha.senha_atual}
                onChange={e => setFormSenha(f => ({ ...f, senha_atual: e.target.value }))}
              />
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <Label htmlFor="senha-nova">Nova senha (mín. 6)</Label>
                <Input
                  id="senha-nova" type="password" minLength={6} required autoComplete="new-password"
                  value={formSenha.senha_nova}
                  onChange={e => setFormSenha(f => ({ ...f, senha_nova: e.target.value }))}
                />
              </div>
              <div>
                <Label htmlFor="senha-confirma">Confirmar nova senha</Label>
                <Input
                  id="senha-confirma" type="password" minLength={6} required autoComplete="new-password"
                  value={formSenha.senha_confirma}
                  onChange={e => setFormSenha(f => ({ ...f, senha_confirma: e.target.value }))}
                />
              </div>
            </div>
            <Button type="submit" size="lg" className="w-full" disabled={trocandoSenha}>
              <KeyRound className="size-4" />
              {trocandoSenha ? 'Salvando…' : 'Trocar senha'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-5">
          <h2 className="flex items-center gap-2 font-bold mb-4">
            <UserPlus className="size-5 text-primary" />
            Novo admin operacional
          </h2>
          <form onSubmit={criar} className="space-y-3">
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <Label htmlFor="nome">Nome</Label>
                <Input id="nome" required value={form.nome} onChange={e => setForm(f => ({ ...f, nome: e.target.value }))} />
              </div>
              <div>
                <Label htmlFor="email">E-mail</Label>
                <Input id="email" type="email" required value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
              </div>
              <div>
                <Label htmlFor="tel">Telefone (opcional)</Label>
                <Input id="tel" type="tel" value={form.telefone} onChange={e => setForm(f => ({ ...f, telefone: e.target.value }))} />
              </div>
              <div>
                <Label htmlFor="senha">Senha inicial (mín. 6)</Label>
                <Input id="senha" type="password" minLength={6} required value={form.senha} onChange={e => setForm(f => ({ ...f, senha: e.target.value }))} />
              </div>
            </div>
            <Button type="submit" size="lg" className="w-full" disabled={enviando}>
              <UserPlus className="size-4" />
              {enviando ? 'Criando…' : 'Criar admin operacional'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <div>
        <h2 className="text-lg font-bold px-1 mb-3">Admins cadastrados</h2>
        {consulta.isLoading && <div className="space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-20" />)}</div>}
        <div className="space-y-3">
          {consulta.data?.map(a => (
            <Card key={a.id}>
              <CardContent className="p-4 flex items-center gap-3">
                <div className="flex size-12 items-center justify-center rounded-2xl bg-accent shrink-0">
                  {a.super_admin
                    ? <Crown className="size-6 text-amber-500" />
                    : <Shield className="size-6 text-primary" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <strong>{a.nome}</strong>
                    {a.super_admin
                      ? <Badge variant="warning" className="text-[10px]">SUPER</Badge>
                      : <Badge variant="info" className="text-[10px]">OPERACIONAL</Badge>}
                    {!!a.bloqueado && <Badge variant="danger" className="text-[10px]">BLOQUEADO</Badge>}
                    {a.id === eu?.id && <Badge variant="outline" className="text-[10px]">VOCÊ</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {a.email} · desde {dataLocal(a.criado_em)}
                  </div>
                </div>
                {a.id !== eu?.id && (
                  <div className="flex items-center gap-1.5 shrink-0">
                    {a.super_admin ? (
                      <Button variant="outline" size="sm" onClick={() => setAlvoPromocao({ admin: a, acao: 'rebaixar' })}>
                        <ArrowDownCircle className="size-4" /> Rebaixar
                      </Button>
                    ) : (
                      <Button variant="outline" size="sm" onClick={() => setAlvoPromocao({ admin: a, acao: 'promover' })}>
                        <ArrowUpCircle className="size-4" /> Promover
                      </Button>
                    )}
                    {!a.super_admin && (
                      <Button variant="destructive" size="sm" onClick={() => remover(a)}>
                        <Trash2 className="size-4" />
                      </Button>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      <Card className="border-amber-500/40 bg-amber-500/5">
        <CardContent className="p-4 flex items-start gap-3 text-sm">
          <Crown className="size-5 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <strong className="text-amber-700 dark:text-amber-300">Sobre o super admin:</strong>{' '}
            <span className="text-muted-foreground">
              Super admins têm acesso total (marca, comissão, financeiro, outros admins e clientes do SaaS).
              Promover ou rebaixar exige sua senha como segunda confirmação, e o último super admin não pode ser rebaixado.
            </span>
          </div>
        </CardContent>
      </Card>
    </div>

    {alvoPromocao && (
      <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => !enviandoPromocao && setAlvoPromocao(null)} />
        <Card className="relative w-full max-w-sm">
          <CardContent className="p-6 space-y-4">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <div className={cn(
                  'flex size-10 items-center justify-center rounded-2xl',
                  alvoPromocao.acao === 'promover' ? 'bg-amber-500/12 text-amber-600' : 'bg-muted text-muted-foreground',
                )}>
                  {alvoPromocao.acao === 'promover' ? <Crown className="size-5" /> : <ArrowDownCircle className="size-5" />}
                </div>
                <div>
                  <h2 className="font-extrabold leading-tight">
                    {alvoPromocao.acao === 'promover' ? 'Promover a super admin' : 'Rebaixar super admin'}
                  </h2>
                  <p className="text-xs text-muted-foreground">{alvoPromocao.admin.nome}</p>
                </div>
              </div>
              <button onClick={() => setAlvoPromocao(null)} className="p-1 rounded-lg hover:bg-muted text-muted-foreground">
                <X className="size-4" />
              </button>
            </div>
            <p className="text-sm text-muted-foreground">
              {alvoPromocao.acao === 'promover'
                ? 'Ele passará a ter acesso total à plataforma (marca, comissão, financeiro e outros admins). Confirme sua senha para continuar.'
                : 'Ele perderá o acesso total e volta a ser admin operacional. Confirme sua senha para continuar.'}
            </p>
            <div>
              <Label htmlFor="senha-promocao">Sua senha</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <Input
                  id="senha-promocao" type="password" autoFocus className="pl-9"
                  value={senhaPromocao} onChange={e => setSenhaPromocao(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && confirmarPromocao()}
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setAlvoPromocao(null)} disabled={enviandoPromocao}>
                Cancelar
              </Button>
              <Button className="flex-1" onClick={confirmarPromocao} disabled={enviandoPromocao || !senhaPromocao}>
                {enviandoPromocao ? 'Confirmando…' : 'Confirmar'}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )}
    </AdminLayout>
  );
}
