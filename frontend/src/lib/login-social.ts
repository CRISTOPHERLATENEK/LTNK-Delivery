/**
 * Retorno do login social — separado do componente dos botões porque exportar
 * hook e componente do mesmo arquivo quebra o fast refresh do Vite (e o lint
 * avisa). Ver components/login-social.tsx e src/backend/oauth.ts.
 */
import { useEffect } from 'react';
import { api, salvarSessao } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import type { UsuarioSessao } from '@/types';

/**
 * Consome o retorno do provedor: `#oauth=<código>` (sucesso) ou `#oauth_erro=...`.
 *
 * POR QUE NO FRAGMENTO: fragmento não é enviado ao servidor, não entra em log de
 * acesso e não viaja no cabeçalho Referer. E é limpo da URL na primeira coisa que
 * este efeito faz — o código morre no primeiro uso de qualquer jeito, mas deixá-lo
 * na barra de endereços convida a copiar o link inteiro.
 */
export function useRetornoLoginSocial(onLogar: (u: UsuarioSessao) => void) {
  const { mostrar } = useToast();

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const codigo = hash.get('oauth');
    const erro = hash.get('oauth_erro');
    if (!codigo && !erro) return;

    // Limpa antes de qualquer await: se a troca demorar e a pessoa recarregar, o
    // código não é reenviado (e viria como "já utilizado", assustando sem motivo).
    history.replaceState(null, '', window.location.pathname + window.location.search);

    if (erro) {
      mostrar({ tipo: 'erro', titulo: erro });
      return;
    }
    api<{ token: string; usuario: UsuarioSessao }>('POST', '/api/auth/oauth/trocar', { codigo })
      .then(r => {
        // Sempre `lembrar` no login social: quem escolheu não digitar senha não
        // deve ser obrigado a refazer isso em 12h.
        salvarSessao(r.token, r.usuario, 'cliente', true);
        onLogar(r.usuario);
        mostrar({ tipo: 'sucesso', titulo: `Bem-vindo, ${r.usuario.nome.split(' ')[0]}!` });
      })
      .catch(e => mostrar({ tipo: 'erro', titulo: e?.message || 'Não foi possível concluir o login.' }));
    // Só na montagem: o retorno chega uma vez, na carga da página.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
