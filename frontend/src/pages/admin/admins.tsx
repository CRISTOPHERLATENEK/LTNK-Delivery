/**
 * Gestão de admins — apenas o super admin acessa.
 * Cria/remove admins operacionais (que NÃO podem editar marca/comissão).
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Users, UserPlus, Trash2, Crown, Shield } from 'lucide-react';
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

  return (
    <AdminLayout titulo="Admins">
    <div className="space-y-5 max-w-3xl">
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
                {!a.super_admin && a.id !== eu?.id && (
                  <Button variant="destructive" size="sm" onClick={() => remover(a)}>
                    <Trash2 className="size-4" />
                  </Button>
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
              Por segurança, novos super admins não podem ser criados pela UI. Para promover alguém,
              um operador do banco precisa rodar{' '}
              <code className="px-1 py-0.5 rounded bg-muted text-foreground">
                UPDATE usuarios SET super_admin = 1 WHERE email = 'x@y.com'
              </code>.
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
    </AdminLayout>
  );
}
