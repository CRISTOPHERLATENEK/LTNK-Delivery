/**
 * Proteção contra perder edição não salva nas telas de configuração.
 *
 * O painel usa `BrowserRouter`, não data router — então `useBlocker` do React
 * Router não está disponível, e bloquear navegação interna exige interceptar o
 * clique no link. É o que este módulo faz, junto do `beforeunload` que cobre
 * recarregar e fechar a aba.
 *
 * NÃO cobre o botão VOLTAR do navegador: cancelar um `popstate` sem data router
 * exige reempilhar histórico, o que quebra o botão pra frente e deixa a URL
 * mentindo. Preferi não cobrir a fingir que cobre.
 */
import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * Dois estados têm o mesmo conteúdo?
 *
 * Compara por JSON com CHAVES ORDENADAS: a ordem em que as chaves entram num
 * objeto muda conforme o caminho (carregado do servidor vs. montado por
 * `setState`), e `JSON.stringify` cru é sensível a ela — a tela ficaria "suja"
 * sem ninguém ter digitado nada.
 */
export function mesmoConteudo(a: unknown, b: unknown): boolean {
  return estavel(a) === estavel(b);
}

function estavel(v: unknown): string {
  return JSON.stringify(v, (_chave, valor) => {
    if (valor && typeof valor === 'object' && !Array.isArray(valor)) {
      const ordenado: Record<string, unknown> = {};
      for (const k of Object.keys(valor as Record<string, unknown>).sort()) {
        ordenado[k] = (valor as Record<string, unknown>)[k];
      }
      return ordenado;
    }
    /*
     * `undefined` NÃO é convertido pra nada aqui de propósito.
     *
     * A intenção é que campo opcional ausente e campo com `undefined` sejam a
     * mesma coisa — um `turnos?: Turno[]` que o servidor não mandou e a tela
     * inicializou como `undefined` não é edição. `JSON.stringify` já OMITE
     * chave com `undefined`, então basta não interferir: mapear pra `null`
     * fazia a chave APARECER e marcava a tela como suja, o inverso do
     * pretendido.
     */
    return valor;
  });
}

/**
 * Marca a tela como suja quando `valor` difere do último ponto salvo.
 *
 * `marcarSalvo()` fixa o ponto de comparação — chame depois de CARREGAR e
 * depois de GRAVAR. Sem a chamada no carregamento, a tela nasceria suja e
 * avisaria sobre uma edição que não existe.
 */
export function useRascunho<T>(valor: T): { sujo: boolean; marcarSalvo: () => void } {
  const [base, setBase] = useState<string | null>(null);
  const atual = estavel(valor);
  const ref = useRef(atual);
  ref.current = atual;
  const marcarSalvo = useCallback(() => { setBase(ref.current); }, []);
  return { sujo: base !== null && base !== atual, marcarSalvo };
}

/**
 * Pede confirmação antes de sair com edição pendente.
 *
 * O clique é interceptado na fase de CAPTURA: o `Link` do React Router trata o
 * clique no bubbling, então na fase de borbulha a navegação já teria começado.
 */
export function useAvisoNaoSalvo(sujo: boolean, pergunta = 'Você tem alterações não salvas. Sair e perder?'): void {
  useEffect(() => {
    if (!sujo) return;

    const aoFechar = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      /* Navegador moderno ignora o texto e mostra o diálogo padrão; atribuir
         `returnValue` é o que ainda dispara o diálogo em alguns deles. */
      e.returnValue = '';
    };

    const aoClicar = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
      const alvo = e.target as HTMLElement | null;
      const link = alvo?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!link) return;
      /* Só navegação interna: download e link pra fora já saem da aba e caem no
         `beforeunload`, que é o diálogo do navegador. */
      if (link.target === '_blank' || link.hasAttribute('download')) return;
      if (link.origin !== window.location.origin) return;
      if (link.pathname === window.location.pathname) return;
      if (!window.confirm(pergunta)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    window.addEventListener('beforeunload', aoFechar);
    document.addEventListener('click', aoClicar, true);
    return () => {
      window.removeEventListener('beforeunload', aoFechar);
      document.removeEventListener('click', aoClicar, true);
    };
  }, [sujo, pergunta]);
}
