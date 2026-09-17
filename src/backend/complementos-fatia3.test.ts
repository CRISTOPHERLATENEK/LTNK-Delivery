import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/*
 * EXCLUIR COM DESFAZER, E O SELO DE SALVO ONDE ELE É VERDADE.
 *
 * Duas coisas do desenho "Mobile Polido", e as duas são sobre confiança:
 *
 *  - CONFIRMAR CADA EXCLUSÃO custa um clique em toda vez para evitar um engano
 *    que quase nunca acontece. Numa lista de dezesseis itens isso é caro. O
 *    desfazer inverte a conta: o caminho comum fica rápido e o engano tem
 *    conserto.
 *  - O RODAPÉ dizia "Salvar alterações" enquanto o texto da aba dizia que os
 *    itens são salvos na hora. As duas frases estavam certas sobre coisas
 *    diferentes, e juntas não faziam sentido.
 */

const raiz = path.join(__dirname, '..', '..');
const ler = (...p: string[]) => fs.readFileSync(path.join(raiz, ...p), 'utf8');
const semComentarios = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

const TELA = semComentarios(ler('frontend', 'src', 'pages', 'lojista', 'produtos.tsx'));
const TOAST = semComentarios(ler('frontend', 'src', 'components', 'ui', 'toast.tsx'));

describe('o toast com ação', () => {
  it('aceita uma ação e a mostra', () => {
    expect(TOAST).toContain('acao?: { rotulo: string; aoClicar: () => void };');
    expect(TOAST).toContain('{t.acao.rotulo}');
  });

  /* Clicar resolve e fecha: deixar o botão na tela convida a clicar de novo no
     que já foi desfeito. */
  it('a ação fecha o toast', () => {
    expect(TOAST).toContain('onClick={() => { t.acao?.aoClicar(); setToasts(a => a.filter(x => x.id !== t.id)); }}');
  });

  /*
   * COM AÇÃO, O TOAST DURA MAIS. Quatro segundos é tempo de LER "excluído", não
   * de perceber o engano, decidir e ainda acertar o botão.
   */
  it('o toast com ação fica mais tempo na tela', () => {
    expect(TOAST).toContain('t.acao ? 9000 : 4000');
  });
});

describe('excluir item do complemento', () => {
  it('não pede confirmação: oferece desfazer', () => {
    const i = TELA.indexOf('async function excluirOpcao');
    const corpo = TELA.slice(i, TELA.indexOf('\n  }', i));
    expect(corpo).not.toContain('confirmar(');
    expect(corpo).toContain("rotulo: 'Desfazer'");
  });

  /*
   * O DESFAZER RECRIA O ITEM COM TUDO. Faltar um campo é o item voltar
   * diferente do que era — e "desfazer" que devolve outra coisa é pior que não
   * ter desfazer.
   */
  it('restaura preço, seção, ingredientes, foto e vínculo', () => {
    const i = TELA.indexOf('async function restaurarOpcao');
    const corpo = TELA.slice(i, TELA.indexOf('\n  }', i));
    for (const campo of ['nome', 'preco_adicional', 'secao', 'descricao', 'imagem', 'sabores', 'produto_id']) {
      expect(corpo, campo).toContain(campo);
    }
    expect(corpo).toContain('sem_estoque: !!o.sem_estoque');
    expect(corpo).toContain('disponivel: !!o.disponivel');
  });

  /* Recriado vai para o fim da lista, e voltar no fim não é desfazer. */
  it('devolve o item à posição que ele ocupava', () => {
    const i = TELA.indexOf('async function restaurarOpcao');
    const corpo = TELA.slice(i, TELA.indexOf('\n  }', i));
    expect(corpo).toContain('const ordemAntiga = grupo.opcoes.map(x => (x.id === o.id ? r.opcao_id : x.id));');
    expect(corpo).toContain('/opcoes/ordem');
  });
});

describe('o selo de salvo', () => {
  /*
   * FICA NA ABA, NÃO NO TOPO DO MODAL. Nome, preço e foto NÃO são salvos
   * sozinhos: quem lesse "salvo automaticamente" no cabeçalho fecharia a janela
   * com o nome novo perdido.
   */
  it('mora na aba dos complementos', () => {
    expect(TELA).toContain('Salvo automaticamente · {salvoEm}');
    const i = TELA.indexOf('Salvo automaticamente');
    const antes = TELA.slice(Math.max(0, i - 700), i);
    expect(antes).toContain('Valem só para este produto e são salvos na hora');
  });

  /* Nasce vazio: selo de "salvo" antes de qualquer gravação é promessa sobre
     coisa nenhuma. */
  it('só aparece depois da primeira gravação', () => {
    expect(TELA).toContain('const [salvoEm, setSalvoEm] = useState<string | null>(null);');
    expect(TELA).toContain('{salvoEm && (');
  });

  it('cada gravação da aba atualiza a hora', () => {
    expect(TELA).toContain('marcarSalvo();');
    /* Toda gravação desta aba termina relendo a lista — é ali que o selo se
       atualiza, e não em cada função uma por uma. */
    const marcas = TELA.split('await qc.refetchQueries({ queryKey }); marcarSalvo();').length - 1;
    expect(marcas).toBeGreaterThan(10);
  });
});
