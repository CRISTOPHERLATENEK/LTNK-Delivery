/**
 * `lazy()` que sobrevive a um deploy com a aba aberta.
 *
 * O PROBLEMA: os chunks têm hash no nome (`painel-a1b2c3.js`). Quando sobe uma
 * versão nova, os arquivos antigos deixam de existir no servidor — mas o JS que
 * está rodando na aba do lojista continua apontando pros nomes velhos. Aí ele
 * clica em "Cozinha", o import() dá 404 e a tela fica branca (ou cai no
 * ErrorBoundary). Acontece com quem deixa o painel aberto o dia todo, ou seja,
 * exatamente quem mais usa o sistema.
 *
 * A SOLUÇÃO: falha de carregamento de chunk quase sempre significa "sua aba está
 * velha". Recarregar a página resolve — o HTML novo aponta pros nomes novos. O
 * `sessionStorage` garante UMA tentativa: se o recarregamento não resolver (o
 * problema era outro, tipo rede caindo), o erro sobe normalmente pro
 * ErrorBoundary em vez de entrar em loop de reload.
 */
import { lazy, type ComponentType } from 'react';

const CHAVE = 'chunk-recarregado';

// `ComponentType<any>` é a mesma restrição que o React usa em `lazy` — trocar por
// algo mais fechado (unknown/never) impede o T de casar com a assinatura dele.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazySeguro<T extends ComponentType<any>>(
  carregar: () => Promise<{ default: T }>,
) {
  return lazy(() =>
    carregar()
      .then(m => {
        // Carregou: libera a próxima tentativa de recarregar, senão o primeiro
        // erro da sessão gastaria a única chance para sempre.
        sessionStorage.removeItem(CHAVE);
        return m;
      })
      .catch((erro: unknown) => {
        if (sessionStorage.getItem(CHAVE) !== '1') {
          sessionStorage.setItem(CHAVE, '1');
          window.location.reload();
          // Devolve uma Promise que nunca resolve: o reload já está em curso e
          // renderizar um erro no meio do caminho só piscaria a tela.
          return new Promise<{ default: T }>(() => {});
        }
        throw erro;
      }),
  );
}
