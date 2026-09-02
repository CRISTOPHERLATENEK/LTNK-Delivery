import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  chaveDeTexto, soDigitos, municipioDoCliente, corpoDaPessoa, idDaPessoa,
  type ClienteParaErp,
} from './maxxgestao-pessoa';

const EMPRESA = { municipio: 'JOINVILLE', uf: 'SC', idIbgeMunicipio: 4209102 };

const cliente = (extra: Partial<ClienteParaErp> = {}): ClienteParaErp => ({
  nome: 'Cris Latenek',
  cpf: '034.309.629-35',
  telefone: '(47) 98450-9781',
  email: 'cris@gmail.com',
  endereco: {
    rua: 'Rua Rio do Braço', numero: '207', complemento: 'casa',
    bairro: 'Jardim Sofia', cidade: 'Joinville', uf: 'SC', cep: '89223-535',
  },
  ...extra,
});

describe('o município do cliente', () => {
  /*
   * `GET /api/municipio/v1` IGNORA filtro: devolve os 5.567 municípios em ordem
   * alfabética, 100 por página. Resolver um nome custaria até 56 requisições
   * contra um limite de 20 por minuto — só para descobrir um número.
   *
   * O atalho pela cidade da empresa cobre quase todo caso real, porque delivery
   * entrega na própria cidade.
   */
  it('mesma cidade e estado da empresa usa o código dela', () => {
    expect(municipioDoCliente('Joinville', 'SC', EMPRESA)).toBe(4209102);
  });

  it('não liga para acento nem caixa', () => {
    expect(municipioDoCliente('JOINVILLE', 'sc', EMPRESA)).toBe(4209102);
    expect(municipioDoCliente('São Paulo', 'SP', { ...EMPRESA, municipio: 'SAO PAULO', uf: 'SP' })).toBe(4209102);
  });

  it('cidade diferente devolve ZERO, não o código da empresa', () => {
    /*
     * A regressão que isto impede: endereço de Curitiba com código de Joinville
     * é endereço fiscal errado — e errado parece certo, então ninguém confere.
     * Zero faz quem chama mandar a pessoa sem endereço.
     */
    expect(municipioDoCliente('Curitiba', 'PR', EMPRESA)).toBe(0);
    expect(municipioDoCliente('Joinville', 'PR', EMPRESA)).toBe(0);
  });

  it('sem cidade, zero', () => {
    expect(municipioDoCliente('', 'SC', EMPRESA)).toBe(0);
    expect(municipioDoCliente('Joinville', '', EMPRESA)).toBe(0);
  });
});

describe('o cadastro da pessoa', () => {
  it('leva nome, CPF só com dígitos e telefone limpo', () => {
    const c = corpoDaPessoa(cliente(), 4209102);
    expect(c.razaoSocial).toBe('Cris Latenek');
    expect(c.tipo).toBe('F');
    expect(c.cnpjCpf).toBe('03430962935');
    expect((c.contato as Record<string, unknown>).fone).toBe('47984509781');
  });

  it('CPF inválido não vai — nem inventado', () => {
    /*
     * Sem CPF a pessoa existe e serve de histórico; com um errado, a nota sai no
     * nome de outra pessoa. Onze dígitos ou nada.
     */
    for (const cpf of ['', '123', '0343096293', '034309629351']) {
      expect(corpoDaPessoa(cliente({ cpf }), 4209102), cpf).not.toHaveProperty('cnpjCpf');
    }
  });

  it('o endereço só vai com município resolvido', () => {
    /* Endereço fiscal com município errado é pior que endereço ausente. */
    expect(corpoDaPessoa(cliente(), 0)).not.toHaveProperty('enderecoPrincipal');
    const com = corpoDaPessoa(cliente(), 4209102).enderecoPrincipal as Record<string, unknown>;
    expect(com.logradouro).toBe('Rua Rio do Braço');
    expect(com.idIbgeMunicipio).toBe(4209102);
    /* CEP é INTEIRO no contrato deles, não texto com traço. */
    expect(com.cep).toBe(89223535);
  });

  it('número vazio vira S/N', () => {
    /* Endereço sem número existe; string vazia num campo fiscal é pior que a
       convenção que todo mundo entende. */
    const c = cliente();
    const com = corpoDaPessoa({ ...c, endereco: { ...c.endereco!, numero: '' } }, 4209102);
    expect((com.enderecoPrincipal as Record<string, unknown>).numero).toBe('S/N');
  });

  it('sem nome, não fica vazio', () => {
    expect(corpoDaPessoa(cliente({ nome: '  ' }), 0).razaoSocial).toBe('CONSUMIDOR');
  });
});

describe('o id da pessoa na resposta deles', () => {
  it('aceita codigo, idPessoa ou id, inclusive aninhado', () => {
    /* A resposta de criação não está documentada; três nomes cobrem o que a API
       usa nos outros endpoints. */
    expect(idDaPessoa({ codigo: 7 })).toBe(7);
    expect(idDaPessoa({ idPessoa: 8 })).toBe(8);
    expect(idDaPessoa({ pessoa: { codigo: 9 } })).toBe(9);
  });

  it('resposta sem id devolve zero, não NaN', () => {
    expect(idDaPessoa({ status: true })).toBe(0);
    expect(idDaPessoa(null)).toBe(0);
    expect(idDaPessoa({ codigo: 0 })).toBe(0);
  });
});

describe('as utilidades', () => {
  it('chaveDeTexto tira acento e caixa', () => {
    expect(chaveDeTexto(' são josé ')).toBe('SAO JOSE');
  });

  it('soDigitos limpa máscara', () => {
    expect(soDigitos('034.309.629-35')).toBe('03430962935');
    expect(soDigitos('(47) 98450-9781')).toBe('47984509781');
  });
});

describe('o encanamento no envio do pedido', () => {
  const fonte = fs.readFileSync(path.join(__dirname, 'maxxgestao-emitir.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('acha pelo CPF ANTES de criar', () => {
    /* Criar sem procurar encheria o cadastro do lojista de duplicatas do mesmo
       cliente — uma por pedido. */
    const iAcha = fonte.indexOf('acharPessoaPorCpf(');
    const iCria = fonte.indexOf('criarPessoa(');
    expect(iAcha).toBeGreaterThan(0);
    expect(iCria).toBeGreaterThan(iAcha);
  });

  it('guarda o id da pessoa no cliente', () => {
    expect(fonte).toContain('UPDATE usuarios SET maxxgestao_pessoa_id = ?');
  });

  it('reaproveita o que já está guardado sem chamar a API', () => {
    expect(fonte).toContain('if (Number(u.pessoa) > 0) return Number(u.pessoa);');
  });

  it('falha no espelho NÃO impede o pedido de subir', () => {
    /*
     * Documento sem o cliente ainda é o pedido registrado; não enviar por causa
     * de um cadastro perderia a venda no ERP. O consumidor final padrão fica
     * como reserva.
     */
    expect(fonte).toContain('vai como consumidor final');
    expect(fonte).toContain('if (doCliente > 0) idPessoa = doCliente;');
  });
});
