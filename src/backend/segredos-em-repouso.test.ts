import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { COLUNAS_CIFRADAS, CONFIGURACOES_CIFRADAS } from './segredos-em-repouso';
import { classificar } from './rotacionar-chave';
import { cifrarCom } from './cripto';

/*
 * A LISTA DE SEGREDOS EM REPOUSO TEM QUE ESTAR COMPLETA.
 *
 * É a coisa mais frágil da rotação de chave, e a única cujo erro não tem
 * conserto: coluna esquecida na lista fica cifrada com a chave VELHA depois
 * que a velha já não existe. O valor não volta. Não é bug, é perda.
 *
 * Então este teste não confia na lista — ele VARRE o código procurando toda
 * chamada de `criptografar`/`descriptografar` e exige que a coluna
 * correspondente esteja registrada. E quando não consegue entender uma
 * chamada, FALHA em vez de ignorar: forma nova de gravar segredo tem que
 * passar por aqui.
 */

const BACKEND = __dirname;
const ARQUIVOS = ['rotas/admin.ts', 'rotas/lojista.ts', 'rotas/autenticacao.ts', 'rotas/pagamentos.ts'];

/**
 * Nomes de coluna/chave que o código cifra ou decifra, achados na fonte.
 *
 * PEGA O MAIS PRÓXIMO, não todos os da vizinhança. A primeira versão desta
 * varredura juntava todo `sets.push('x = ?')` de uma janela de 10 linhas em
 * volta da chamada — e acusou `mercadopago_public_key` e `onz_pix_key`, que
 * são gravadas em TEXTO (public key aparece na tela, não é segredo). O par é
 * sempre `sets.push(coluna)` seguido de `vals.push(criptografar(valor))`, então
 * o dono da chamada é a coluna imediatamente ACIMA dela — nunca a do vizinho.
 */
function segredosNoCodigo(): { colunas: Set<string>; chaves: Set<string>; naoEntendidos: string[] } {
  const colunas = new Set<string>();
  const chaves = new Set<string>();
  const naoEntendidos: string[] = [];
  const ehSegredo = (n: string) => /token|senha|secret|csc|api_key|client_id/.test(n);

  for (const rel of ARQUIVOS) {
    const fonte = fs.readFileSync(path.join(BACKEND, rel), 'utf8');
    const linhas = fonte.split('\n');

    for (let i = 0; i < linhas.length; i++) {
      const l = linhas[i];
      const t = l.trimStart();
      if (t.startsWith('*') || t.startsWith('//') || t.startsWith('/*')) continue;
      if (!/\b(criptografar|descriptografar)\(/.test(l)) continue;

      /*
       * HELPER GENÉRICO: `descriptografar(c)`, `descriptografar(cifrado)`. O
       * nome da coluna não está aqui — quem chama passa `row.a_coluna`. Esses
       * pontos são LEITURA por função auxiliar, e a coluna já é registrada pelo
       * ponto de escrita. Tratar como "não entendido" enterraria o teste em
       * ruído e ninguém olharia mais para a lista.
       */
      const arg = l.match(/descriptografar\(([a-zA-Z_.?]+)\)?/);
      if (arg && !arg[1].includes('.') && !ehSegredo(arg[1])) continue;

      // 1. O destino está na PRÓPRIA linha? (quem decifra direto da linha)
      const naLinha = l.match(/descriptografar\((?:[a-z]+\??\.)?([a-z_]+)/);
      if (naLinha && ehSegredo(naLinha[1])) { colunas.add(naLinha[1]); continue; }

      const gravar = l.match(/gravarSegredo\('([a-z_]+)'/);
      if (gravar) { colunas.add(gravar[1]); continue; }

      const centralNaLinha = l.match(/upsertCentral\('([a-z_]+)',\s*criptografar/);
      if (centralNaLinha) { chaves.add(centralNaLinha[1]); continue; }

      /*
       * 2. UPDATE DE VÁRIAS COLUNAS: a coluna certa é a da POSIÇÃO do
       * argumento, não a primeira do `SET`. Foi o que fez esta varredura
       * acusar `whatsapp_oficial_numero` — a primeira de um SET de cinco —
       * quando o cifrado era o `whatsapp_oficial_token`, o quinto.
       */
      const bloco = linhas.slice(Math.max(0, i - 12), i + 1).join('\n');
      const porPosicao = colunaPorPosicao(bloco);
      if (porPosicao) { colunas.add(porPosicao); continue; }

      /*
       * COLUNA DINÂMICA: `sets.push(`${campo} = ?`)` dentro de um helper. O
       * nome vem por parâmetro, então quem responde são as CHAMADAS — que
       * `colunasDeGravarSegredo()` coleta à parte, e o teste abaixo exige que
       * tenham sido achadas. Sem esta regra, a definição do helper apareceria
       * eternamente como "não entendida" e o teste viraria ruído ignorado.
       */
      const dinamica = linhas.slice(Math.max(0, i - 4), i + 1)
        .some(x => /(?:sets|campos)\.push\(\`\$\{/.test(x));
      if (dinamica) continue;

      // 3. Senão, o par `push(coluna)` + `push(criptografar(valor))`.
      let achou = false;
      for (let k = i; k >= Math.max(0, i - 12) && !achou; k--) {
        const push = linhas[k].match(/(?:sets|campos)\.push\(['"`]([a-z_]+) = \?/);
        const setSql = linhas[k].match(/SET\s+([a-z_]+)\s*=\s*\?/);
        const nome = push?.[1] || setSql?.[1];
        if (nome) { colunas.add(nome); achou = true; }
      }
      if (!achou) naoEntendidos.push(rel + ':' + (i + 1) + '  ' + l.trim().slice(0, 80));
    }
  }
  return { colunas, chaves, naoEntendidos };
}

/** Divide os argumentos de uma chamada respeitando parênteses aninhados. */
function dividirArgumentos(texto: string): string[] {
  const partes: string[] = [];
  let atual = '', nivel = 0;
  for (const ch of texto) {
    if (ch === '(') nivel++;
    if (ch === ')') nivel--;
    if (ch === ',' && nivel === 0) { partes.push(atual); atual = ''; continue; }
    atual += ch;
  }
  if (atual.trim()) partes.push(atual);
  return partes.map(p => p.trim());
}

/**
 * Num `UPDATE ... SET a = ?, b = ?` com `.run(x, criptografar(y), id)`, devolve
 * a coluna que está na MESMA posição do argumento cifrado.
 */
function colunaPorPosicao(bloco: string): string | null {
  const set = bloco.match(/SET([\s\S]*?)WHERE/);
  const run = bloco.match(/\.run\(([\s\S]*)$/);
  if (!set || !run) return null;
  const cols = [...set[1].matchAll(/([a-z_]+)\s*=\s*\?/g)].map(m => m[1]);
  if (cols.length < 2) return null;
  const args = dividirArgumentos(run[1]);
  const idx = args.findIndex(a => /criptografar\(/.test(a));
  if (idx < 0 || idx >= cols.length) return null;
  return cols[idx];
}

/** As chamadas de `gravarSegredo('coluna', ...)`, que ficam longe da definição. */
function colunasDeGravarSegredo(): string[] {
  const fonte = fs.readFileSync(path.join(BACKEND, 'rotas', 'lojista.ts'), 'utf8');
  return [...fonte.matchAll(/gravarSegredo\('([a-z_]+)'/g)].map(m => m[1]);
}

describe('lista de segredos em repouso', () => {
  const { colunas, chaves, naoEntendidos } = segredosNoCodigo();
  for (const c of colunasDeGravarSegredo()) colunas.add(c);
  const registradas = new Set(COLUNAS_CIFRADAS.map(c => c.coluna));
  const registradasChaves = new Set(CONFIGURACOES_CIFRADAS.map(c => c.chave));

  /*
   * A CONTRAPARTIDA da regra de coluna dinâmica: se as chamadas do helper não
   * fossem achadas, a definição seria pulada, as chamadas ignoradas, e nenhuma
   * das colunas do TEF entraria na conferência — silêncio total no caminho que
   * grava senha de maquininha.
   */
  it('as colunas passadas por parâmetro ao helper foram achadas', () => {
    const doHelper = colunasDeGravarSegredo();
    expect(doHelper.length).toBeGreaterThanOrEqual(2);
    expect(doHelper).toContain('smarttef_senha');
    expect(doHelper).toContain('smarttef_gateway_token');
  });

  it('a varredura encontrou algo de verdade', () => {
    /*
     * Sem isto, uma regex que parou de casar faz o teste passar comparando
     * conjuntos vazios — o jeito mais silencioso de perder a proteção.
     */
    expect(colunas.size).toBeGreaterThanOrEqual(8);
    expect(chaves.size).toBeGreaterThanOrEqual(2);
    expect(colunas.has('nfce_cert_senha')).toBe(true);
    expect(colunas.has('totp_secret')).toBe(true);
  });

  it('toda chamada de cifra foi entendida pela varredura', () => {
    /*
     * Falhar aqui NÃO significa que há um bug: significa que apareceu uma
     * forma nova de gravar segredo que esta varredura não reconhece. Aí ou se
     * ensina a forma nova ao teste, ou se muda o código para uma das formas
     * conhecidas. O que não pode é passar batido.
     */
    expect(naoEntendidos).toEqual([]);
  });

  it('toda coluna cifrada no código está na lista da rotação', () => {
    const faltando = [...colunas].filter(c => !registradas.has(c)).sort();
    expect(faltando).toEqual([]);
  });

  it('toda linha de configuracoes cifrada está na lista', () => {
    const faltando = [...chaves].filter(c => !registradasChaves.has(c)).sort();
    expect(faltando).toEqual([]);
  });

  /*
   * `mercadopago_token` é lida e nunca escrita — nada a cifra hoje, mas o
   * código a DECIFRA como reserva e loja antiga pode ter valor. Uma varredura
   * que olhasse só escrita a perderia, e o pagamento daquela loja viraria erro
   * silencioso depois da rotação.
   */
  it('a coluna que só é lida também está na lista', () => {
    expect(registradas.has('mercadopago_token')).toBe(true);
  });

  /* Hash não é cifra: não há o que recifrar, e incluir na rotação faria o
     script tentar decifrar um hash e abortar tudo. */
  it('o que é hash fica FORA da lista', () => {
    expect(registradas.has('senha_hash')).toBe(false);
    expect(registradas.has('totp_backup_codes')).toBe(false);
    expect(registradas.has('reset_token_hash')).toBe(false);
  });
});

describe('classificar: o que fazer com cada valor', () => {
  const VELHA = 'chave-velha-com-trinta-e-dois-caracteres-ok';
  const NOVA = 'chave-nova-com-trinta-e-dois-caracteres-ok';

  it('valor da chave velha é recifrado, e o resultado NÃO é o original', () => {
    const guardado = cifrarCom('token-secreto', VELHA);
    const r = classificar(guardado, VELHA, NOVA);
    expect(r.estado).toBe('recifrado');
    expect(r.novo).toBeTruthy();
    expect(r.novo).not.toBe(guardado);
  });

  /*
   * O RAMO QUE PERMITE REPETIR. Execução interrompida no meio deixa parte na
   * chave nova; sem reconhecer isso, a segunda tentativa chamaria esses
   * valores de ilegíveis e abortaria — deixando o banco meio convertido para
   * sempre, que é o estado do qual não se sai.
   */
  it('valor JÁ na chave nova é reconhecido, não tratado como ilegível', () => {
    const guardado = cifrarCom('token-secreto', NOVA);
    expect(classificar(guardado, VELHA, NOVA).estado).toBe('ja-na-nova');
  });

  it('valor que não abre com nenhuma das duas é ilegível', () => {
    const guardado = cifrarCom('token-secreto', 'uma-terceira-chave-completamente-outra');
    expect(classificar(guardado, VELHA, NOVA).estado).toBe('ilegivel');
  });

  it('lixo que não é nem base64 de cifra é ilegível, não estoura', () => {
    expect(classificar('isto-nao-e-cifra', VELHA, NOVA).estado).toBe('ilegivel');
  });

  it('vazio e nulo não são problema', () => {
    expect(classificar(null, VELHA, NOVA).estado).toBe('ja-na-nova');
    expect(classificar('', VELHA, NOVA).estado).toBe('ja-na-nova');
    expect(classificar('   ', VELHA, NOVA).estado).toBe('ja-na-nova');
  });

  /* Ida e volta: o valor recifrado tem que abrir com a chave nova e dar o
     texto original. Sem isto, "recifrado" poderia ser lixo bem formatado. */
  it('o recifrado abre com a chave nova e devolve o mesmo texto', async () => {
    const { decifrarCom } = await import('./cripto');
    const r = classificar(cifrarCom('valor-original-123', VELHA), VELHA, NOVA);
    expect(decifrarCom(r.novo!, NOVA)).toBe('valor-original-123');
  });
});

describe('o script protege quem roda', () => {
  const fonte = fs.readFileSync(path.join(BACKEND, 'rotacionar-chave.ts'), 'utf8');
  const exec = fonte.split('\n').filter(l => {
    const t = l.trimStart();
    return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*');
  }).join('\n');

  /* Ensaio é o PADRÃO. Se valendo fosse o padrão, o primeiro uso do script
     seria também a primeira vez que ele escreve — sem ninguém ter conferido. */
  it('ensaio é o padrão; gravar exige --valendo', () => {
    expect(exec).toMatch(/includes\('--valendo'\)/);
    expect(exec).toMatch(/if \(!valendo\)/);
  });

  /* Chave por argumento aparece em `ps` para qualquer usuário da máquina. */
  it('as chaves vêm do ambiente, não de argv', () => {
    expect(exec).toMatch(/process\.env\.APP_SECRET_VELHO/);
    expect(exec).toMatch(/process\.env\.APP_SECRET_NOVO/);
    expect(exec).not.toMatch(/argv\[2\]/);
  });

  /* Um ilegível e nada é escrito: rotação parcial é pior que nenhuma. */
  it('um valor ilegível aborta antes de gravar', () => {
    const abort = exec.indexOf('ilegiveis.length > 0');
    const grava = exec.indexOf('gravando (central)');
    expect(abort).toBeGreaterThan(-1);
    expect(grava).toBeGreaterThan(-1);
    expect(abort).toBeLessThan(grava);
  });

  it('exige 32 caracteres na chave nova, como a aplicação em produção', () => {
    expect(exec).toMatch(/novo\.length < 32/);
  });

  /* O relatório é contagem e nome de coluna. Valor de segredo em log de
     terminal fica no scrollback, no histórico e na captura de tela. */
  it('não imprime valor de segredo', () => {
    expect(exec).not.toMatch(/console\.log\([^)]*l\.novo/);
    expect(exec).not.toMatch(/console\.log\([^)]*row\.v/);
    expect(exec).not.toMatch(/console\.log\([^)]*velho\b/);
  });
});
