import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/*
 * O AVISO DE PEDIDO NOVO.
 *
 * O LOJISTA DISSE ASSIM: "tenho que ficar visualizando a página pra receber o
 * pedido; se não ficar olhando, ele recebe mas não aponta". E era exatamente
 * isso — medido em 12/09/2026:
 *
 *   servidor manda o push ......... sim (`notificarLojistaNovoPedido`)
 *   VAPID configurado ............. sim (as três chaves no `.env`)
 *   navegador inscrito ............ sim (inscrição FCM válida, de 11/09)
 *   service worker mostra ......... NÃO — `sw.js` só tinha install/activate/fetch
 *
 * O push chegava ao navegador e morria ali, sem ninguém para desenhar a
 * notificação. E com a aba em segundo plano o navegador ainda estrangula o
 * `setInterval` do painel (que busca a cada 4 s), então nem o aviso de dentro
 * da página saía. Pedido entrava e ninguém ficava sabendo.
 *
 * Este arquivo protege a corrente inteira: quem manda, quem mostra e quem leva
 * ao pedido quando alguém toca.
 */

const RAIZ = path.join(__dirname, '../..');
const SW = fs.readFileSync(path.join(RAIZ, 'public/sw.js'), 'utf8');
const SW_FONTE = fs.readFileSync(path.join(RAIZ, 'frontend/public/sw.js'), 'utf8');
const semComentarios = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const CODIGO = semComentarios(SW);

describe('o service worker mostra o pedido novo', () => {
  /*
   * ESTE É O DEFEITO QUE EXISTIA. Sem o `push`, todo o resto da corrente
   * funcionava e não servia para nada.
   */
  it('trata o evento push', () => {
    expect(CODIGO).toContain("addEventListener('push'");
    expect(CODIGO).toContain('showNotification');
  });

  /*
   * FICA NA TELA ATÉ ALGUÉM TOCAR. Notificação que some sozinha em cinco
   * segundos, numa loja com o telefone no bolso e o balcão cheio, é igual a não
   * ter — que é o ponto de partida desta correção.
   */
  it('a notificação não some sozinha', () => {
    expect(CODIGO).toContain('requireInteraction: true');
  });

  /*
   * DOIS PEDIDOS SEGUIDOS SÃO DOIS AVISOS. Com `tag` e sem `renotify`, o
   * segundo substituiria o primeiro EM SILÊNCIO — o pedido apareceria na tela
   * sem som nenhum, que é a falha que esta tela existe para evitar.
   */
  it('pedido seguido volta a avisar', () => {
    expect(CODIGO).toContain('renotify: true');
    expect(CODIGO).toMatch(/tag:\s*d\.tag/);
  });

  it('lê os campos que o servidor manda', () => {
    const envio = fs.readFileSync(path.join(RAIZ, 'src/backend/push.ts'), 'utf8');
    for (const campo of ['titulo', 'corpo', 'url', 'tag']) {
      expect(envio).toContain(campo);
      expect(CODIGO).toContain('d.' + campo);
    }
  });

  /* Payload quebrado não pode engolir o aviso: melhor uma notificação genérica
     que nenhuma. */
  it('payload estranho ainda vira aviso', () => {
    const i = CODIGO.indexOf("addEventListener('push'");
    const corpo = CODIGO.slice(i, i + 700);
    expect(corpo).toContain('try');
    expect(corpo).toContain('catch');
    expect(corpo).toMatch(/titulo\s*=\s*d\.titulo\s*\|\|/);
  });
});

describe('tocar no aviso leva ao pedido', () => {
  it('trata o clique', () => {
    expect(CODIGO).toContain("addEventListener('notificationclick'");
    expect(CODIGO).toContain('notification.close()');
  });

  /*
   * REAPROVEITA A ABA ABERTA. No computador do caixa, cada toque abrindo uma
   * aba nova termina com dez painéis competindo pelo mesmo som.
   */
  it('usa a aba que já está aberta em vez de abrir outra', () => {
    const i = CODIGO.indexOf("addEventListener('notificationclick'");
    const corpo = CODIGO.slice(i, i + 800);
    expect(corpo).toContain('matchAll');
    expect(corpo).toContain('focus()');
    expect(corpo).toContain('openWindow');
    /* A busca pela aba vem ANTES de abrir uma nova. */
    expect(corpo.indexOf('matchAll')).toBeLessThan(corpo.indexOf('openWindow'));
  });
});

describe('o aviso acorda a página, sem esperar o ciclo', () => {
  /*
   * MINIMIZADO, O NAVEGADOR ESTRANGULA O CICLO DA ABA: o `setInterval` de 4 s
   * do painel vira cerca de uma vez por minuto. Era por isso que "se não ficar
   * olhando, ele recebe mas não aponta" — o som da página dependia desse ciclo.
   *
   * O push não sofre estrangulamento: chega ao service worker, que mostra a
   * notificação do sistema E manda um recado para a aba. Aí o alerta sai na
   * hora, minimizado ou não, e a lista recarrega junto.
   */
  it('o service worker avisa as abas abertas', () => {
    const i = CODIGO.indexOf("addEventListener('push'");
    const corpo = CODIGO.slice(i, i + 1400);
    expect(corpo).toContain('postMessage');
    expect(corpo).toContain("tipo: 'pedido-novo'");
  });

  it('a página escuta o recado e apita', () => {
    const alerta = semComentarios(fs.readFileSync(
      path.join(RAIZ, 'frontend/src/lib/alerta-pedido.ts'), 'utf8'));
    expect(alerta).toContain('ouvirAvisoDoServiceWorker');
    const i = alerta.indexOf('ouvirAvisoDoServiceWorker');
    const corpo = alerta.slice(i, i + 700);
    expect(corpo).toContain("e.data.tipo === 'pedido-novo'");
    expect(corpo).toContain('tocarAlerta');
  });

  /* E devolve o desligador: escuta que fica para trás vira dois alertas por
     pedido quando a tela remonta. */
  it('a escuta pode ser desligada', () => {
    const alerta = semComentarios(fs.readFileSync(
      path.join(RAIZ, 'frontend/src/lib/alerta-pedido.ts'), 'utf8'));
    const i = alerta.indexOf('ouvirAvisoDoServiceWorker');
    expect(alerta.slice(i, i + 800)).toContain('removeEventListener');
  });

  it('o painel liga a escuta e recarrega a lista', () => {
    const painel = semComentarios(fs.readFileSync(
      path.join(RAIZ, 'frontend/src/pages/lojista/painel.tsx'), 'utf8'));
    expect(painel).toContain('ouvirAvisoDoServiceWorker');
    const i = painel.indexOf('ouvirAvisoDoServiceWorker(');
    expect(painel.slice(i, i + 300)).toContain('refetch()');
  });
});

describe('as duas cópias do service worker', () => {
  /*
   * `public/sw.js` é o que está no ar; `frontend/public/sw.js` é o que o build
   * publica por cima. Divergir significa a correção viver até o próximo deploy
   * e sumir — já aconteceu neste projeto.
   */
  it('são idênticas', () => {
    expect(SW).toBe(SW_FONTE);
  });

  /*
   * O NOME DO CACHE MUDA JUNTO. O `activate` apaga o que não é o cache atual;
   * sem trocar o nome, o navegador fica com a versão velha do SW servindo a
   * própria cópia antiga e o push continua sem dono.
   */
  it('a versão do cache subiu', () => {
    expect(CODIGO).toContain("const CACHE = 'delivery-app-v7'");
  });
});

describe('o servidor avisa quando o pedido entra', () => {
  const rotaCliente = fs.readFileSync(path.join(RAIZ, 'src/backend/rotas/cliente.ts'), 'utf8');
  const notificacoes = fs.readFileSync(path.join(RAIZ, 'src/backend/notificacoes.ts'), 'utf8');

  it('a criação do pedido chama o aviso do lojista', () => {
    /* A CHAMADA COMO INSTRUCAO, e nao o nome em qualquer lugar do arquivo:
       procurar so o nome passava verde com a chamada desligada por um
       `void 0 &&` na frente (verificado sabotando). */
    expect(rotaCliente).toMatch(/^\s*notificarLojistaNovoPedido\([^)]*\)\.catch\(/m);
  });

  /* O aviso não pode derrubar o pedido: se o push falhar, a venda continua. */
  it('falha no aviso não derruba o pedido', () => {
    const i = rotaCliente.indexOf('notificarLojistaNovoPedido(');
    expect(rotaCliente.slice(i, i + 120)).toContain('catch');
  });

  it('o aviso vai para o dono da loja', () => {
    const i = notificacoes.indexOf('export async function notificarLojistaNovoPedido');
    const corpo = notificacoes.slice(i, i + 800);
    expect(corpo).toContain('l.usuario_id');
    expect(corpo).toContain('enviarPush');
  });
});
