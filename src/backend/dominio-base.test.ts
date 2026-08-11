import { describe, it, expect } from 'vitest';
import { basesDe, slugDoHost, urlDeSlug } from './dominio-base';

describe('basesDe', () => {
  it('lê lista separada por vírgula, normalizando', () => {
    expect(basesDe(' MaxxPedidos.com.br , www.maxxdelivery.app.br '))
      .toEqual(['maxxpedidos.com.br', 'maxxdelivery.app.br']);
  });

  it('um valor só continua funcionando', () => {
    expect(basesDe('maxxdelivery.app.br')).toEqual(['maxxdelivery.app.br']);
  });

  it('vazio ou ausente vira lista vazia, não [""]', () => {
    // Uma base "" casaria com QUALQUER host terminado em ponto e mandaria todo
    // mundo pro tenant de slug esquisito.
    expect(basesDe('')).toEqual([]);
    expect(basesDe(undefined)).toEqual([]);
    expect(basesDe(' , , ')).toEqual([]);
  });
});

describe('slugDoHost', () => {
  const bases = ['maxxpedidos.com.br', 'maxxdelivery.app.br'];

  it('reconhece subdomínio em QUALQUER uma das bases', () => {
    // É o ponto do módulo: durante a troca de domínio, o endereço antigo que já
    // foi entregue a alguém não pode parar de funcionar.
    expect(slugDoHost('cris.maxxpedidos.com.br', bases)).toBe('cris');
    expect(slugDoHost('cris.maxxdelivery.app.br', bases)).toBe('cris');
  });

  it('o domínio base pelado não é subdomínio de ninguém', () => {
    // Sem isso o site principal seria lido como um cliente.
    expect(slugDoHost('maxxpedidos.com.br', bases)).toBeNull();
    expect(slugDoHost('maxxdelivery.app.br', bases)).toBeNull();
  });

  it('ignora host de outro domínio', () => {
    expect(slugDoHost('maxxtalk.com.br', bases)).toBeNull();
    expect(slugDoHost('cris.outrodominio.com', bases)).toBeNull();
  });

  it('recusa subdomínio de segundo nível', () => {
    expect(slugDoHost('a.b.maxxpedidos.com.br', bases)).toBeNull();
  });

  it('não casa domínio que só TERMINA parecido', () => {
    // "fakemaxxpedidos.com.br" termina com "maxxpedidos.com.br" se a comparação
    // esquecer o ponto — e um domínio de terceiro viraria porta de entrada.
    expect(slugDoHost('sub.fakemaxxpedidos.com.br', bases)).toBeNull();
  });

  it('sem base configurada, não reconhece nada', () => {
    expect(slugDoHost('cris.maxxpedidos.com.br', [])).toBeNull();
  });
});

describe('urlDeSlug', () => {
  it('usa a PRIMEIRA base — a canônica', () => {
    expect(urlDeSlug('cris', ['maxxpedidos.com.br', 'maxxdelivery.app.br']))
      .toBe('https://cris.maxxpedidos.com.br');
  });

  it('sem base, devolve null em vez de uma URL quebrada', () => {
    expect(urlDeSlug('cris', [])).toBeNull();
  });
});
