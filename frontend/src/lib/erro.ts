/**
 * Traduz erro de API no que a pessoa precisa saber.
 *
 * Fica em `lib/` e não junto do componente de propósito: misturar função
 * utilitária com componente no mesmo arquivo desliga o fast refresh do Vite
 * (regra `react-refresh/only-export-components`) — editar o texto de um erro
 * passaria a recarregar a página inteira.
 *
 * Regra que isto impõe: a tela nunca mostra código de status. "404" não diz nada
 * a quem está com fome; "esse link não existe mais" diz.
 */
import { WifiOff, ServerCrash, SearchX, Lock } from 'lucide-react';
import { ApiError } from './api';

export interface AparenciaErro {
  Icone: typeof WifiOff;
  titulo: string;
  texto: string;
  /** Falha que não se resolve tentando de novo não deve oferecer "Tentar de novo". */
  temRetentativa: boolean;
}

export function aparenciaDoErro(erro: unknown): AparenciaErro {
  const api = erro instanceof ApiError ? erro : null;

  if (api?.semRede) {
    const offline = !navigator.onLine;
    return {
      Icone: WifiOff,
      titulo: offline ? 'Você está sem internet' : 'Não conseguimos falar com o servidor',
      texto: offline
        ? 'Verifique o wi-fi ou os dados do celular. Seus dados não foram perdidos.'
        : 'A conexão está funcionando, mas o servidor não respondeu. Costuma ser rápido — tente de novo.',
      temRetentativa: true,
    };
  }
  if (api && (api.status === 401 || api.status === 403)) {
    return {
      Icone: Lock,
      titulo: 'Sua sessão expirou',
      texto: 'Entre de novo para continuar de onde parou.',
      // Retentar com sessão morta só repete o 401 — quem resolve é entrar de novo.
      temRetentativa: false,
    };
  }
  if (api?.status === 404) {
    return {
      Icone: SearchX,
      titulo: 'Não encontramos isso',
      texto: 'O endereço pode ter mudado ou o item saiu do ar. Confira o link.',
      temRetentativa: false,
    };
  }
  return {
    Icone: ServerCrash,
    titulo: 'Algo deu errado aqui',
    texto: api?.message || 'Tivemos um problema ao carregar esta tela. Tente de novo.',
    temRetentativa: true,
  };
}
