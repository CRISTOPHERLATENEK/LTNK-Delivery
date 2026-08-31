import { describe, it, expect } from 'vitest';
import { normalizarBaseUrl, tefConfigurado, pendenciasTef, type CredenciaisTef } from './smarttef-config';

const PRONTA: CredenciaisTef = {
  ativo: true,
  baseUrl: 'https://api.smarttef.com.br',
  usuario: 'loja@exemplo',
  senha: 'senha-da-api',
  gatewayToken: 'gw-key',
  serialPos: '',
};

describe('normalizarBaseUrl', () => {
  it('aceita uma URL https limpa', () => {
    expect(normalizarBaseUrl('https://api.smarttef.com.br')).toBe('https://api.smarttef.com.br');
  });

  it('apara espaço e barra sobrando', () => {
    /* Colar de PDF e de WhatsApp traz os dois. */
    expect(normalizarBaseUrl('  https://api.smarttef.com.br/  ')).toBe('https://api.smarttef.com.br');
  });

  it('joga fora o caminho colado junto', () => {
    /* O lojista cola a URL do endpoint inteiro. Concatenar geraria
       /smarttef/.../smarttef/... e um 404 que ninguém liga a este campo. */
    expect(normalizarBaseUrl('https://api.smarttef.com.br/smarttef/commands/erp/order/create'))
      .toBe('https://api.smarttef.com.br');
  });

  it('preserva a porta quando existe', () => {
    expect(normalizarBaseUrl('https://api.smarttef.com.br:8443/x')).toBe('https://api.smarttef.com.br:8443');
  });

  it('recusa http, inclusive "só pra testar"', () => {
    /* O que trafega é o Bearer da loja. Em http ele vaza na rede do
       restaurante, que é onde tem wifi de cliente. */
    expect(normalizarBaseUrl('http://api.smarttef.com.br')).toBe('');
  });

  it('recusa host sem ponto', () => {
    expect(normalizarBaseUrl('https://localhost')).toBe('');
    expect(normalizarBaseUrl('https://api')).toBe('');
  });

  it('recusa lixo sem explodir', () => {
    /* Devolve vazio em vez de lançar: a tela precisa avisar, não dar 500. */
    for (const v of ['', '   ', 'api.smarttef.com.br', 'não sei', null, undefined, 42, {}]) {
      expect(normalizarBaseUrl(v)).toBe('');
    }
  });
});

describe('tefConfigurado', () => {
  it('com as três peças e ativo, está pronto', () => {
    expect(tefConfigurado(PRONTA)).toBe(true);
  });

  it('desligado não cobra, mesmo com tudo preenchido', () => {
    /* Desligar sem apagar é o caso da maquininha em manutenção. */
    expect(tefConfigurado({ ...PRONTA, ativo: false })).toBe(false);
  });

  it('falta qualquer uma das quatro e não está pronto', () => {
    /* Quatro, não três: o Bearer virou usuário + senha, porque é um JWT que o
       sistema gera — token colado à mão expira e falha na venda. */
    expect(tefConfigurado({ ...PRONTA, baseUrl: '' })).toBe(false);
    expect(tefConfigurado({ ...PRONTA, usuario: '' })).toBe(false);
    expect(tefConfigurado({ ...PRONTA, senha: null })).toBe(false);
    expect(tefConfigurado({ ...PRONTA, gatewayToken: null })).toBe(false);
  });

  it('credencial só com espaço não conta como preenchida', () => {
    expect(tefConfigurado({ ...PRONTA, senha: '   ' })).toBe(false);
    expect(tefConfigurado({ ...PRONTA, usuario: '  ' })).toBe(false);
    expect(tefConfigurado({ ...PRONTA, gatewayToken: '\t' })).toBe(false);
  });

  it('base URL inválida não conta, mesmo preenchida', () => {
    /* Este é o caso perigoso: o campo tem texto, a tela parece configurada, e a
       venda travaria esperando uma maquininha que nunca receberia nada. */
    expect(tefConfigurado({ ...PRONTA, baseUrl: 'http://api.smarttef.com.br' })).toBe(false);
    expect(tefConfigurado({ ...PRONTA, baseUrl: 'api.smarttef.com.br' })).toBe(false);
  });

  it('serial do POS é opcional', () => {
    /* Vazio = ordem cai na lista geral e qualquer POS da loja pega. */
    expect(tefConfigurado({ ...PRONTA, serialPos: '' })).toBe(true);
    expect(tefConfigurado({ ...PRONTA, serialPos: 'POS123' })).toBe(true);
  });
});

describe('pendenciasTef', () => {
  it('loja zerada lista as quatro de uma vez', () => {
    /* Uma por vez faria a pessoa salvar quatro vezes pra descobrir as quatro. */
    const faltas = pendenciasTef({
      ativo: true, baseUrl: '', usuario: '', senha: null, gatewayToken: null, serialPos: '',
    });
    expect(faltas).toHaveLength(4);
    expect(faltas.join(' ')).toContain('endereço da API');
    expect(faltas.join(' ')).toContain('usuário da API');
    expect(faltas.join(' ')).toContain('senha da API');
    expect(faltas.join(' ')).toContain('gateway token');
  });

  it('distingue campo vazio de campo inválido', () => {
    /* "Falta o endereço" para quem não colou nada manda procurar o que já está
       lá. O aviso tem que dizer qual dos dois problemas é. */
    const vazio = pendenciasTef({ ...PRONTA, baseUrl: '' });
    const invalido = pendenciasTef({ ...PRONTA, baseUrl: 'http://api.smarttef.com.br' });
    expect(vazio[0]).not.toBe(invalido[0]);
    expect(invalido[0]).toContain('https://');
  });

  it('loja pronta não tem pendência', () => {
    expect(pendenciasTef(PRONTA)).toEqual([]);
  });
});
