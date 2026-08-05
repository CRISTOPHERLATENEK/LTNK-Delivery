/**
 * "Você entrou, mas essa conta é de outra área."
 *
 * O BUG QUE ISSO FECHA: cada painel decidia o acesso com uma linha do tipo
 * `if (perfil !== 'lojista') return <Login />`. Quem entrasse com a conta de
 * outra área fazia o login inteiro — senha, 2FA, tudo — a sessão era gravada, a
 * página recarregava, a comparação dava false e a tela voltava pro FORMULÁRIO DE
 * LOGIN. Sem mensagem nenhuma: do lado de quem usa, o login simplesmente não
 * funcionou, e nada sugeria que o problema era o endereço, não a senha. A pessoa
 * repete a senha, tenta "esqueci minha senha", troca a senha — e continua batendo
 * na mesma porta.
 *
 * A checagem de perfil que existia no formulário é INALCANÇÁVEL para as contas que
 * mais importam: lojista e admin sempre passam pelo 2FA, e o caminho do 2FA grava
 * a sessão e recarrega sem conferir perfil. Por isso a guarda tem que ficar onde
 * TODA entrada passa — na renderização do painel —, não no submit do formulário.
 */
import { ShieldAlert } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { encerrarSessao, type Area } from '@/lib/api';

/** Para onde cada perfil deve ir, com o nome que a pessoa reconhece. */
const AREA_DO_PERFIL: Record<string, { rotulo: string; rota: string }> = {
  admin:      { rotulo: 'painel da plataforma', rota: '/admin' },
  lojista:    { rotulo: 'painel do lojista',    rota: '/lojista' },
  entregador: { rotulo: 'app do entregador',    rota: '/entregador' },
  cliente:    { rotulo: 'área do cliente',      rota: '/conta' },
};

interface Props {
  /** Perfil da conta que entrou. */
  perfil: string;
  nome?: string;
  /** Nome desta área, pra dizer o que a pessoa tentou abrir. */
  areaAtual: string;
  /** Chave de sessão a limpar no "entrar com outra conta". */
  chaveSessao: Area;
}

/**
 * Diz TRÊS coisas, e nenhuma é dispensável: que o login deu certo (senão a pessoa
 * repete a senha), que a conta pertence a outra área, e onde essa área fica. O
 * botão de sair vem junto porque o caso mais comum é ter entrado com a conta
 * errada, e sem ele a sessão gravada trava a tela nesse estado.
 */
export function ContaDeOutroPerfil({ perfil, nome, areaAtual, chaveSessao }: Props) {
  const destino = AREA_DO_PERFIL[perfil];
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4 py-10">
      <Card className="w-full max-w-md">
        <CardContent className="space-y-4 p-8 text-center">
          <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-accent">
            <ShieldAlert className="size-8 text-amber-500" />
          </div>
          <h2 className="text-xl font-extrabold">Login feito — mas esta conta é de outra área</h2>
          <p className="text-sm text-muted-foreground">
            {nome ? <>Você entrou como <strong>{nome}</strong>.</> : 'Você entrou com sucesso.'}{' '}
            {destino
              ? <>Essa conta é do <strong>{destino.rotulo}</strong>; o {areaAtual} usa outra conta.</>
              : <>Essa conta não tem acesso ao {areaAtual}.</>}
          </p>
          <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:justify-center">
            {destino && (
              <Button asChild size="lg"><a href={destino.rota}>Ir para o {destino.rotulo}</a></Button>
            )}
            <Button size="lg" variant="outline"
              onClick={() => { encerrarSessao(chaveSessao); window.location.reload(); }}>
              Entrar com outra conta
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
