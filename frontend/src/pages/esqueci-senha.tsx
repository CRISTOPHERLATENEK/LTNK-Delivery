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
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { useTema } from '@/lib/tema';
import { TelaLogin, CampoSenha, ErroLogin } from '@/components/ui/tela-login';

/**
 * A moldura daqui era uma cópia da moldura dos logins, e as duas divergiram: a
 * dos logins ganhou `min-h-dvh` (o `vh` do celular conta a barra do navegador
 * que some ao rolar, e o formulário ficava cortado) e esta ficou no `min-h-screen`.
 * Agora as duas são a mesma — quem vem do login não sente troca de tela.
 */
function Moldura({ icone, titulo, subtitulo, children }: {
  icone: React.ReactNode; titulo: string; subtitulo: string; children: React.ReactNode;
}) {
  const { marca } = useTema();
  return (
    <TelaLogin icone={icone} titulo={titulo} subtitulo={subtitulo} rodape={marca.nome || undefined}>
      {children}
    </TelaLogin>
  );
}

export function EsqueciSenha() {
  const [email, setEmail] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const { mostrar } = useToast();

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    try {
      setErro(null);
      await api('POST', '/api/auth/esqueci-senha', { email });
      setEnviado(true);
    } catch (err) {
      if (err instanceof ApiError) { setErro(err.message); mostrar({ tipo: 'erro', titulo: err.message }); }
    } finally {
      setEnviando(false);
    }
  }

  if (enviado) {
    return (
      <Moldura icone={<CheckCircle2 className="size-8" />} titulo="Verifique seu e-mail"
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
    <Moldura icone={<Mail className="size-8" />} titulo="Esqueceu sua senha?"
      subtitulo="Informe o e-mail da sua conta pra receber o link de redefinição.">
      <form onSubmit={enviar} className="space-y-4">
        <ErroLogin mensagem={erro} />
        <div>
          <Label htmlFor="email-recuperar">E-mail cadastrado</Label>
          <Input id="email-recuperar" type="email" required autoFocus
            autoComplete="email" inputMode="email" enterKeyHint="go"
            placeholder="seu@email.com" value={email} onChange={e => setEmail(e.target.value)} />
        </div>
        <Button type="submit" size="lg" className="w-full" loading={enviando} loadingText="Enviando…">
          Enviar link de redefinição
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
  const [erro, setErro] = useState<string | null>(null);
  const { mostrar } = useToast();

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (senha !== confirmar) {
      setErro('As senhas não coincidem.');
      mostrar({ tipo: 'erro', titulo: 'As senhas não coincidem.' });
      return;
    }
    setEnviando(true);
    setErro(null);
    try {
      await api('POST', '/api/auth/redefinir-senha', { token, senha });
      setConcluido(true);
      setTimeout(() => navigate('/'), 2500);
    } catch (err) {
      if (err instanceof ApiError) { setErro(err.message); mostrar({ tipo: 'erro', titulo: err.message }); }
    } finally {
      setEnviando(false);
    }
  }

  if (!token) {
    return (
      <Moldura icone={<KeyRound className="size-8" />} titulo="Link inválido"
        subtitulo="Esse link de redefinição está incompleto ou expirou.">
        <Button asChild className="w-full"><Link to="/esqueci-senha">Pedir um novo link</Link></Button>
      </Moldura>
    );
  }

  if (concluido) {
    return (
      <Moldura icone={<CheckCircle2 className="size-8" />} titulo="Senha redefinida!"
        subtitulo="Já pode entrar com a nova senha. Redirecionando…">
        <Button asChild className="w-full"><Link to="/">Ir para o login agora</Link></Button>
      </Moldura>
    );
  }

  return (
    <Moldura icone={<KeyRound className="size-8" />} titulo="Escolha uma nova senha"
      subtitulo="Mínimo de 6 caracteres.">
      <form onSubmit={enviar} className="space-y-4">
        <ErroLogin mensagem={erro} />
        {/* `new-password` nos dois: sem isso o gerenciador de senhas oferece a
            senha ANTIGA justamente na tela de trocar de senha. */}
        <CampoSenha id="nova-senha" rotulo="Nova senha" autoComplete="new-password"
          valor={senha} aoMudar={setSenha} required minLength={6} placeholder="••••••••" />
        <CampoSenha id="confirmar-senha" rotulo="Confirmar nova senha" autoComplete="new-password"
          valor={confirmar} aoMudar={setConfirmar} required minLength={6} placeholder="••••••••" />
        <Button type="submit" size="lg" className="w-full" loading={enviando} loadingText="Salvando…">
          Redefinir senha
        </Button>
      </form>
    </Moldura>
  );
}
