import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { ORIGENS_DELIVERY, filtroOrigemDelivery } from './util';

describe('origem de pedido no fluxo de delivery', () => {
  it('inclui app e ifood', () => {
    expect([...ORIGENS_DELIVERY]).toEqual(['app', 'ifood']);
  });

  it('monta o SQL com o prefixo pedido', () => {
    expect(filtroOrigemDelivery()).toBe("p.origem IN ('app','ifood')");
    expect(filtroOrigemDelivery('pedidos')).toBe("pedidos.origem IN ('app','ifood')");
  });

  it('NENHUMA rota volta a filtrar origem = \'app\' na mão', () => {
    /*
     * O defeito que este teste guarda: o primeiro pedido do iFood foi gravado
     * correto e ficou INVISÍVEL — seis consultas filtravam `origem = 'app'`
     * literal, e a intenção delas nunca foi "veio do nosso app", era "é um
     * pedido que a loja precisa aceitar, preparar e entregar".
     *
     * Quem acrescentar a próxima origem (outro marketplace) não tem como
     * adivinhar que existem seis lugares. Este teste conta.
     */
    const dir = path.join(__dirname, 'rotas');
    const achados: string[] = [];
    for (const arq of fs.readdirSync(dir).filter(f => f.endsWith('.ts') && !f.includes('.test.'))) {
      const codigo = fs.readFileSync(path.join(dir, arq), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      if (/origem\s*=\s*'app'/.test(codigo)) achados.push(arq);
    }
    expect(achados).toEqual([]);
  });
});
