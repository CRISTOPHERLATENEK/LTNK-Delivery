/**
 * Fluxo de 2FA (TOTP) exigido no login de lojista/admin — depois de validar
 * email+senha, o backend devolve um token de pré-autenticação (sem acesso a
 * nada) e um `modo`: 'configurar' (primeiro login, ainda sem TOTP) ou
 * 'verificar' (login normal). Este componente cobre os dois; quem usa só
 * passa `tokenPreAuth`/`modo` e recebe `onSucesso(token, usuario)` quando o
 * 2FA é validado — a partir daí segue como um login normal.
 */
import { useEffect, useState } from 'react';
import { ShieldCheck, KeyRound, Copy, Check, AlertTriangle } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';

interface Props {
  tokenPreAuth: string;
  modo: 'configurar' | 'verificar';
  onSucesso: (token: string, usuario: any) => void;
  onCancelar: () => void;
}

export function Portal2FA({ tokenPreAuth, modo, onSucesso, onCancelar }: Props) {
  const { mostrar } = useToast();
  const [carregandoQr, setCarregandoQr] = useState(modo === 'configurar');
  const [qr, setQr] = useState<string | null>(null);
  const [chaveManual, setChaveManual] = useState('');
  const [codigo, setCodigo] = useState('');
  const [usarBackup, setUsarBackup] = useState(false);
  const [codigoBackup, setCodigoBackup] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const [codigosBackup, setCodigosBackup] = useState<string[] | null>(null);
  const [tokenFinal, setTokenFinal] = useState<{ token: string; usuario: any } | null>(null);

  useEffect(() => {
    if (modo !== 'configurar') return;
    api<{ qr: string; chaveManual: string }>('POST', '/api/auth/2fa/configurar', undefined, tokenPreAuth)
      .then(r => { setQr(r.qr); setChaveManual(r.chaveManual); })
      .catch(err => mostrar({ tipo: 'erro', titulo: err instanceof ApiError ? err.message : 'Não foi possível gerar o QR do 2FA.' }))
      .finally(() => setCarregandoQr(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modo]);

  async function copiarChave() {
    try {
      await navigator.clipboard.writeText(chaveManual);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch { /* ignora — usuário pode selecionar manualmente */ }
  }

  async function confirmarSetup(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    try {
      const r = await api<{ token: string; usuario: any; codigosBackup: string[] }>(
        'POST', '/api/auth/2fa/confirmar', { codigo }, tokenPreAuth
      );
      setTokenFinal({ token: r.token, usuario: r.usuario });
      setCodigosBackup(r.codigosBackup);
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally {
      setEnviando(false);
    }
  }

  async function verificar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    try {
      const corpo = usarBackup ? { codigoBackup } : { codigo };
      const r = await api<{ token: string; usuario: any }>('POST', '/api/auth/2fa/verificar', corpo, tokenPreAuth);
      onSucesso(r.token, r.usuario);
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally {
      setEnviando(false);
    }
  }

  // Tela final do setup: mostra os códigos de backup UMA vez só, antes de liberar a sessão.
  if (codigosBackup && tokenFinal) {
    return (
      <div className="w-full max-w-sm space-y-4">
        <div className="text-center">
          <div className="mx-auto mb-3 flex size-14 items-center justify-center rounded-2xl bg-warning/15">
            <AlertTriangle className="size-7 text-warning" />
          </div>
          <h2 className="text-lg font-extrabold">Guarde seus códigos de backup</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Cada código funciona uma vez, caso perca acesso ao app autenticador. Salve num lugar seguro — depois de sair desta tela não é possível ver de novo.
          </p>
        </div>
        <Card>
          <CardContent className="p-4">
            <div className="grid grid-cols-2 gap-2 font-mono text-sm">
              {codigosBackup.map(c => (
                <div key={c} className="rounded-lg bg-muted px-2 py-1.5 text-center">{c}</div>
              ))}
            </div>
          </CardContent>
        </Card>
        <Button size="lg" className="w-full" onClick={() => onSucesso(tokenFinal.token, tokenFinal.usuario)}>
          Já salvei os códigos — continuar
        </Button>
      </div>
    );
  }

  if (modo === 'configurar') {
    return (
      <div className="w-full max-w-sm space-y-4">
        <div className="text-center">
          <div className="mx-auto mb-3 flex size-14 items-center justify-center rounded-2xl bg-primary/15">
            <ShieldCheck className="size-7 text-primary" />
          </div>
          <h2 className="text-lg font-extrabold">Configure a verificação em duas etapas</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Obrigatório nessa conta. Escaneie o QR com Google Authenticator, Authy ou outro app autenticador.
          </p>
        </div>
        <Card>
          <CardContent className="p-5 space-y-4">
            {carregandoQr && <div className="py-8 text-center text-sm text-muted-foreground">Gerando QR…</div>}
            {qr && (
              <>
                <div className="flex justify-center">
                  <img src={qr} alt="QR code do 2FA" className="size-48 rounded-xl border" />
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground mb-1">Não consegue escanear? Digite a chave manualmente no app:</p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 truncate rounded-lg bg-muted px-2 py-1.5 text-xs font-mono">{chaveManual}</code>
                    <Button type="button" variant="outline" size="icon" className="shrink-0" onClick={copiarChave}>
                      {copiado ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
                    </Button>
                  </div>
                </div>
                <form onSubmit={confirmarSetup} className="space-y-3">
                  <div>
                    <Label htmlFor="codigo-setup-2fa">Código de 6 dígitos do app</Label>
                    <Input id="codigo-setup-2fa" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
                      className="mt-1.5 text-center text-lg tracking-[0.3em] font-mono"
                      value={codigo} onChange={e => setCodigo(e.target.value.replace(/\D/g, ''))} autoFocus />
                  </div>
                  <Button type="submit" size="lg" className="w-full" disabled={enviando || codigo.length < 6}>
                    {enviando ? 'Confirmando…' : 'Ativar 2FA'}
                  </Button>
                </form>
              </>
            )}
          </CardContent>
        </Card>
        <button type="button" onClick={onCancelar} className="block w-full text-center text-sm text-muted-foreground hover:text-primary">
          Voltar
        </button>
      </div>
    );
  }

  // modo === 'verificar'
  return (
    <div className="w-full max-w-sm space-y-4">
      <div className="text-center">
        <div className="mx-auto mb-3 flex size-14 items-center justify-center rounded-2xl bg-primary/15">
          <KeyRound className="size-7 text-primary" />
        </div>
        <h2 className="text-lg font-extrabold">Verificação em duas etapas</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {usarBackup ? 'Digite um dos seus códigos de backup.' : 'Digite o código de 6 dígitos do seu app autenticador.'}
        </p>
      </div>
      <Card>
        <CardContent className="p-5">
          <form onSubmit={verificar} className="space-y-3">
            {usarBackup ? (
              <div>
                <Label htmlFor="codigo-backup-2fa">Código de backup</Label>
                <Input id="codigo-backup-2fa" autoComplete="off" maxLength={11}
                  className="mt-1.5 text-center text-lg tracking-widest font-mono"
                  placeholder="xxxxx-xxxxx"
                  value={codigoBackup} onChange={e => setCodigoBackup(e.target.value.trim())} autoFocus />
              </div>
            ) : (
              <div>
                <Label htmlFor="codigo-verificar-2fa">Código de 6 dígitos</Label>
                <Input id="codigo-verificar-2fa" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
                  className="mt-1.5 text-center text-lg tracking-[0.3em] font-mono"
                  value={codigo} onChange={e => setCodigo(e.target.value.replace(/\D/g, ''))} autoFocus />
              </div>
            )}
            <Button type="submit" size="lg" className="w-full"
              disabled={enviando || (usarBackup ? codigoBackup.length < 5 : codigo.length < 6)}>
              {enviando ? 'Verificando…' : 'Verificar'}
            </Button>
          </form>
          <button type="button" onClick={() => { setUsarBackup(v => !v); setCodigo(''); setCodigoBackup(''); }}
            className="mt-3 block w-full text-center text-xs text-muted-foreground hover:text-primary">
            {usarBackup ? 'Usar código do app em vez disso' : 'Perdeu o app? Usar código de backup'}
          </button>
        </CardContent>
      </Card>
      <button type="button" onClick={onCancelar} className="block w-full text-center text-sm text-muted-foreground hover:text-primary">
        Voltar
      </button>
    </div>
  );
}
