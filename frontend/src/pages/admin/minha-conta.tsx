/**
 * Minha conta — o que é SEU, separado de administrar os outros.
 *
 * "Trocar minha senha" e "Resetar meu 2FA" moravam dentro de Admins, no meio da
 * lista de gerenciar terceiros. São coisas diferentes: uma é a sua credencial,
 * a outra é permissão de gente. Misturadas, o admin procurava a própria conta
 * numa tela de administrar os outros — e corria o risco de mexer na conta
 * errada por estar tudo junto.
 */
import { useState } from 'react';
import { KeyRound, ShieldCheck, UserCog } from 'lucide-react';
import { AdminLayout } from './layout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import { api, ApiError, sessaoUsuario, ehSuperAdmin } from '@/lib/api';

export function TelaMinhaConta() {
  const { mostrar } = useToast();
  const u = sessaoUsuario();
  const superAdmin = ehSuperAdmin();

  const [formSenha, setFormSenha] = useState({ senha_atual: '', senha_nova: '', senha_confirma: '' });
  const [trocandoSenha, setTrocandoSenha] = useState(false);
  const [senhaReset2fa, setSenhaReset2fa] = useState('');
  const [resetando2fa, setResetando2fa] = useState(false);

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
      mostrar({ tipo: 'sucesso', titulo: 'Senha alterada.' });
      setFormSenha({ senha_atual: '', senha_nova: '', senha_confirma: '' });
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally {
      setTrocandoSenha(false);
    }
  }

  async function resetar2fa(e: React.FormEvent) {
    e.preventDefault();
    setResetando2fa(true);
    try {
      await api('POST', '/api/admin/2fa/resetar', { senha: senhaReset2fa });
      mostrar({
        tipo: 'sucesso',
        titulo: '2FA resetado.',
        descricao: 'No próximo login você configura o autenticador de novo.',
      });
      setSenhaReset2fa('');
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally {
      setResetando2fa(false);
    }
  }

  return (
    <AdminLayout titulo="Minha conta">
      <div className="mx-auto max-w-2xl space-y-4">
        <div>
          <h1 className="text-xl font-bold">Minha conta</h1>
          <p className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {u?.email}
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-bold text-primary">
              {superAdmin ? 'Super Admin' : 'Operacional'}
            </span>
          </p>
        </div>

        <Card>
          <CardContent className="p-5">
            <h2 className="mb-4 flex items-center gap-2 font-bold">
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
              <div className="grid gap-3 sm:grid-cols-2">
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
            <h2 className="mb-1 flex items-center gap-2 font-bold">
              <ShieldCheck className="size-5 text-primary" />
              Resetar meu 2FA
            </h2>
            <p className="mb-4 text-xs text-muted-foreground">
              Perdeu o celular ou trocou de aparelho? Isso apaga o app autenticador atual e os códigos de
              backup — no próximo login você configura um novo, do zero. O 2FA continua obrigatório.
            </p>
            <form onSubmit={resetar2fa} className="space-y-3">
              <div>
                <Label htmlFor="senha-reset-2fa">Confirme sua senha</Label>
                <Input
                  id="senha-reset-2fa" type="password" required autoComplete="current-password"
                  value={senhaReset2fa} onChange={e => setSenhaReset2fa(e.target.value)}
                />
              </div>
              <Button type="submit" variant="outline" disabled={resetando2fa || !senhaReset2fa}>
                <UserCog className="size-4" />
                {resetando2fa ? 'Resetando…' : 'Resetar 2FA'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
