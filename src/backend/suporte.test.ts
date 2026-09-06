/**
 * O AGENTE DE SUPORTE.
 *
 * O que precisa ser garantido aqui não é a qualidade da resposta — isso depende
 * do modelo. É que ele NÃO possa agir, que segredo nenhum saia da máquina, e
 * que o dossiê continue existindo sem a IA.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const semComentarios = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const ia = fs.readFileSync(path.join(__dirname, 'suporte-ia.ts'), 'utf8');
/*
 * As asserções NEGATIVAS leem sem comentário.
 *
 * Os comentários deste projeto citam o erro que evitam — o de `content[0].text`
 * explica justamente por que não se usa `content[0].text`. Procurar o texto na
 * fonte comentada acusa a explicação como se fosse o defeito.
 */
const iaSemComentarios = semComentarios(ia);
const dossieFonte = fs.readFileSync(path.join(__dirname, 'suporte-dossie.ts'), 'utf8');
const admin = semComentarios(fs.readFileSync(path.join(__dirname, 'rotas', 'admin.ts'), 'utf8'));

describe('o agente lê e explica — nunca age', () => {
  it('a chamada não declara ferramenta nenhuma', () => {
    /*
     * Não é limitação técnica, é o desenho: um agente que pode agir transforma
     * "cancela tudo" digitado por alguém irritado num incidente — e a culpa
     * seria de quem desenhou, não de quem digitou.
     */
    const sem = semComentarios(ia);
    expect(sem).not.toMatch(/\btools\s*:/);
    expect(sem).not.toMatch(/tool_runner|toolRunner|tool_choice/);
  });

  it('a instrução diz, por escrito, que ele não executa nada', () => {
    /* O modelo lê isto antes de cada resposta. Sem a frase, ele descreve o que
       "fez" e a pessoa acredita. */
    expect(ia).toMatch(/Não afirme que executou nada/);
    expect(ia).toMatch(/quem age é a pessoa|quem age é você/i);
  });

  it('a rota é só do super admin', () => {
    const linha = admin.split('\n').find(l => l.includes("router.post('/lojas/:id/suporte'"));
    expect(linha).toBeDefined();
    expect(linha).toContain('exigirSuperAdmin');
  });
});

describe('nenhum segredo sai da máquina', () => {
  /*
   * O dossiê vai para a API da Anthropic e para a tela de quem atende. Token do
   * Mercado Pago, do Maxx Gestão, senha de certificado e hash de senha nunca
   * entram — nem cifrados. O que entra é se EXISTE.
   */
  const SEGREDOS = [
    'mercadopago_token', 'nfce_csc', 'nfce_cert_senha', 'whatsapp_oficial_token',
    'smarttef_token', 'smarttef_gateway_token', 'smarttef_senha', 'maxxgestao_token',
    'senha_hash',
  ];

  it('o SELECT do dossiê não traz valor de credencial', () => {
    const i = dossieFonte.indexOf('SELECT l.id, l.nome');
    const sql = dossieFonte.slice(i, dossieFonte.indexOf('WHERE l.id = ?', i));
    for (const seg of SEGREDOS) {
      /*
       * A coluna PODE aparecer, mas só dentro de um teste de existência
       * (`IS NOT NULL AND <> ''`). O que não pode é ela vir como valor.
       */
      const solta = new RegExp(`(^|[,\\s])l\\.${seg}\\s*(,|$)`, 'm');
      expect(sql, seg).not.toMatch(solta);
    }
  });

  it('o que vem de credencial vira sim/não, nunca o valor', () => {
    expect(dossieFonte).toMatch(/tem_token_erp/);
    expect(dossieFonte).toMatch(/tem_csc/);
    /* E as linhas do texto usam o booleano, não a coluna. */
    const i = dossieFonte.indexOf('const linhas: string[] = []');
    const texto = dossieFonte.slice(i);
    for (const seg of SEGREDOS) {
      expect(texto, seg).not.toContain(`l.${seg}`);
    }
  });

  it('a instrução proíbe pedir ou repetir credencial', () => {
    expect(ia).toMatch(/Não peça nem repita senha, token ou chave/);
  });
});

describe('o dossiê existe sem a IA', () => {
  it('sem pergunta, a rota devolve só o estado — sem chamar a API', () => {
    /*
     * Metade dos chamados se resolve lendo o estado. Essa metade não deveria
     * custar uma chamada de API nem parar quando a Anthropic estiver fora do ar.
     */
    const i = admin.indexOf("router.post('/lojas/:id/suporte'");
    const t = admin.slice(i, i + 1600);
    expect(t).toMatch(/if \(!pergunta\)/);
    const semPergunta = t.slice(t.indexOf('if (!pergunta)'), t.indexOf('const r = await responderSuporte'));
    expect(semPergunta).not.toContain('responderSuporte');
  });

  it('o dossiê não depende do módulo da IA', () => {
    /* Se `suporte-dossie` importasse o SDK, uma chave ausente derrubaria também
       o retrato — que é a parte que sempre funciona. */
    expect(dossieFonte).not.toContain('@anthropic-ai/sdk');
    expect(dossieFonte).not.toContain('suporte-ia');
  });

  it('sem chave configurada, o erro DIZ o que fazer', () => {
    /* Um 500 genérico faria a primeira pessoa a clicar abrir um chamado sobre
       o chamado. */
    expect(ia).toContain('falta ANTHROPIC_API_KEY');
    const i = admin.indexOf("router.post('/lojas/:id/suporte'");
    expect(admin.slice(i, i + 2000)).toContain('SemChaveSuporte');
  });
});

describe('custo e rastro', () => {
  it('o modelo e o teto de tokens são explícitos', () => {
    expect(ia).toMatch(/claude-opus-5/);
    expect(ia).toMatch(/const MAX_TOKENS = \d+/);
    /* Trocar de modelo é decisão de custo — fica no .env, não escondido. */
    expect(ia).toContain('process.env.SUPORTE_MODELO');
  });

  it('a instrução estável é cacheada', () => {
    /*
     * É o único trecho idêntico em toda chamada. Sem `cache_control` nele, cada
     * pergunta paga o prompt inteiro de novo.
     */
    expect(ia).toMatch(/cache_control: \{ type: 'ephemeral' \}/);
  });

  it('a pergunta fica na auditoria', () => {
    /* É dado de cliente saindo para um serviço externo: "quem perguntou o quê
       sobre qual loja" precisa ter resposta. */
    const i = admin.indexOf("router.post('/lojas/:id/suporte'");
    expect(admin.slice(i, i + 2000)).toContain("registrarAuditoria(req, 'suporte.ia'");
  });

  it('a resposta junta os blocos de TEXTO, não o primeiro bloco', () => {
    /*
     * `content` é uma união: com pensamento adaptativo ligado, o primeiro bloco
     * costuma ser o raciocínio. `content[0].text` devolveria vazio.
     */
    expect(ia).toContain("b.type === 'text'");
    expect(iaSemComentarios).not.toMatch(/content\[0\]\.text/);
  });
});
