/**
 * Recuperação de senha — duas telas independentes de área:
 *  - /esqueci-senha: pede o e-mail, dispara o link por e-mail (best-effort)
 *  - /redefinir-senha?token=...: define a nova senha a partir do link recebido
 * Login por CPF (cliente) não muda: a recuperação sempre passa pelo e-mail
 * cadastrado, já que é o único canal de contato que temos hoje.
 */
import { useState } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { Mail, KeyRound, CheckCircle2, ArrowLeft } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { useTema } from '@/lib/tema';

function Moldura({ icone, titulo, subtitulo, children }: {
  icone: React.ReactNode; titulo: string; subtitulo: string; children: React.ReactNode;
}) {
  const { marca } = useTema();
  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-1">
          <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            {icone}
          </div>
          <h1 className="text-xl font-extrabold mt-2">{titulo}</h1>
          <p className="text-sm text-muted-foreground">{subtitulo}</p>
          {marca.nome && <p className="text-xs text-muted-foreground/70">{marca.nome}</p>}
        </div>
        <Card><CardContent className="p-6">{children}</CardContent></Card>
      </div>
    </div>
  );
}

export function EsqueciSenha() {
  const [email, setEmail] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const { mostrar } = useToast();

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    try {
      await api('POST', '/api/auth/esqueci-senha', { email });
      setEnviado(true);
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally {
      setEnviando(false);
    }
  }

  if (enviado) {
    return (
      <Moldura icone={<CheckCircle2 className="size-7" />} titulo="Verifique seu e-mail"
        subtitulo="Se esse e-mail estiver cadastrado, o link de redefinição já está a caminho.">
        <div className="text-center space-y-4">
          <p className="text-sm text-muted-foreground">
            Não recebeu? Confira a caixa de spam, ou tente de novo em alguns minutos.
          </p>
          <Button asChild variant="outline" className="w-full"><Link to="/"><ArrowLeft className="size-4" /> Voltar</Link></Button>
        </div>
      </Moldura>
    );
  }

  return (
    <Moldura icone={<Mail className="size-7" />} titulo="Esqueceu sua senha?"
      subtitulo="Informe o e-mail da sua conta pra receber o link de redefinição.">
      <form onSubmit={enviar} className="space-y-4">
        <div>
          <Label htmlFor="email-recuperar">E-mail cadastrado</Label>
          <Input id="email-recuperar" type="email" required autoFocus
            placeholder="seu@email.com" value={email} onChange={e => setEmail(e.target.value)} />
        </div>
        <Button type="submit" size="lg" className="w-full" disabled={enviando}>
          {enviando ? 'Enviando…' : 'Enviar link de redefinição'}
        </Button>
        <Button asChild variant="ghost" className="w-full"><Link to="/"><ArrowLeft className="size-4" /> Voltar</Link></Button>
      </form>
    </Moldura>
  );
}

export function RedefinirSenha() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const navigate = useNavigate();
  const [senha, setSenha] = useState('');
  const [confirmar, setConfirmar] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [concluido, setConcluido] = useState(false);
  const { mostrar } = useToast();

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (senha !== confirmar) { mostrar({ tipo: 'erro', titulo: 'As senhas não coincidem.' }); return; }
    setEnviando(true);
    try {
      await api('POST', '/api/auth/redefinir-senha', { token, senha });
      setConcluido(true);
      setTimeout(() => navigate('/'), 2500);
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally {
      setEnviando(false);
    }
  }

  if (!token) {
    return (
      <Moldura icone={<KeyRound className="size-7" />} titulo="Link inválido"
        subtitulo="Esse link de redefinição está incompleto ou expirou.">
        <Button asChild className="w-full"><Link to="/esqueci-senha">Pedir um novo link</Link></Button>
      </Moldura>
    );
  }

  if (concluido) {
    return (
      <Moldura icone={<CheckCircle2 className="size-7" />} titulo="Senha redefinida!"
        subtitulo="Já pode entrar com a nova senha. Redirecionando…">
        <Button asChild className="w-full"><Link to="/">Ir para o login agora</Link></Button>
      </Moldura>
    );
  }

  return (
    <Moldura icone={<KeyRound className="size-7" />} titulo="Escolha uma nova senha"
      subtitulo="Mínimo de 6 caracteres.">
      <form onSubmit={enviar} className="space-y-4">
        <div>
          <Label htmlFor="nova-senha">Nova senha</Label>
          <Input id="nova-senha" type="password" required minLength={6}
            placeholder="••••••••" value={senha} onChange={e => setSenha(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="confirmar-senha">Confirmar nova senha</Label>
          <Input id="confirmar-senha" type="password" required minLength={6}
            placeholder="••••••••" value={confirmar} onChange={e => setConfirmar(e.target.value)} />
        </div>
        <Button type="submit" size="lg" className="w-full" disabled={enviando}>
          {enviando ? 'Salvando…' : 'Redefinir senha'}
        </Button>
      </form>
    </Moldura>
  );
}
