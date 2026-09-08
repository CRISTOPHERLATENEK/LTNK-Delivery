import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  montarEnderecoTexto, lerPartes, temAlgumaParte, semearFiscal, cepDigitos,
} from './endereco-loja';

/*
 * O ENDEREÇO DA LOJA ERA DIGITADO DUAS VEZES.
 *
 * O passo "Endereço" do cadastro de cliente pedia uma linha de texto livre, e
 * dois passos depois o "Fiscal" pedia o endereço INTEIRO outra vez, em pedaços
 * (a SEFAZ exige logradouro, número, bairro, município, cMun, UF e CEP em
 * campos separados). Nada garantia que as duas versões combinassem — e a
 * divergência só aparece quando a nota é recusada ou a entrega vai pro lugar
 * errado, que é tarde.
 *
 * Agora as partes são coletadas uma vez e daqui saem os dois formatos.
 */

describe('montarEnderecoTexto: o texto que vai pro geocoder', () => {
  it('endereço completo no formato que o geocoder entende', () => {
    expect(montarEnderecoTexto({
      rua: 'Av. Brasil', numero: '123', bairro: 'Centro', cidade: 'Joinville', uf: 'SC',
    })).toBe('Av. Brasil, 123 - Centro, Joinville - SC');
  });

  /*
   * PEDAÇO AUSENTE LEVA A PONTUAÇÃO EMBORA. "Av. Brasil, - , Joinville - " não
   * é um endereço curto: é um endereço com vírgula solta, e o geocoder tenta
   * casar a vírgula e devolve coordenada errada em vez de nenhuma. Coordenada
   * errada manda a entrega pro lugar errado; coordenada nenhuma só desliga o
   * cálculo de distância.
   */
  it('sem número, não sobra vírgula pendurada', () => {
    expect(montarEnderecoTexto({ rua: 'Av. Brasil', bairro: 'Centro', cidade: 'Joinville', uf: 'SC' }))
      .toBe('Av. Brasil - Centro, Joinville - SC');
  });

  it('sem bairro, não sobra vírgula pendurada', () => {
    expect(montarEnderecoTexto({ rua: 'Av. Brasil', numero: '123', cidade: 'Joinville', uf: 'SC' }))
      .toBe('Av. Brasil, 123 - Joinville - SC');
  });

  it('sem UF, não sobra hífen pendurado', () => {
    expect(montarEnderecoTexto({ rua: 'Av. Brasil', numero: '123', bairro: 'Centro', cidade: 'Joinville' }))
      .toBe('Av. Brasil, 123 - Centro, Joinville');
  });

  it('só a cidade ainda dá um texto usável', () => {
    expect(montarEnderecoTexto({ cidade: 'Joinville', uf: 'SC' })).toBe('Joinville - SC');
  });

  it('nada preenchido dá string vazia, não pontuação', () => {
    expect(montarEnderecoTexto({})).toBe('');
    expect(montarEnderecoTexto({ rua: '', numero: '  ' })).toBe('');
  });

  /*
   * O COMPLEMENTO FICA FORA DE PROPÓSITO. "Apto 42" não é lugar no mapa: entra
   * como termo de busca e PIORA o casamento do geocoder. Ele é guardado nas
   * partes e usado onde serve — na nota e na tela.
   */
  it('complemento não entra no texto do geocoder', () => {
    const texto = montarEnderecoTexto({
      rua: 'Av. Brasil', numero: '123', complemento: 'Sala 2', bairro: 'Centro', cidade: 'Joinville', uf: 'SC',
    });
    expect(texto).not.toMatch(/Sala 2/);
    expect(texto).toBe('Av. Brasil, 123 - Centro, Joinville - SC');
  });

  it('UF sai maiúscula mesmo digitada minúscula', () => {
    expect(montarEnderecoTexto({ cidade: 'Joinville', uf: 'sc' })).toBe('Joinville - SC');
  });
});

describe('lerPartes: não confia no que chega', () => {
  it('tira máscara do CEP e limita a 8 dígitos', () => {
    expect(cepDigitos('89.201-500')).toBe('89201500');
    expect(cepDigitos('892015001234')).toBe('89201500');
    expect(cepDigitos(undefined)).toBe('');
  });

  it('ignora o que não é texto', () => {
    const p = lerPartes({ rua: 42, cidade: null, uf: ['SC'] } as unknown as Record<string, unknown>);
    expect(p.rua).toBe('');
    expect(p.cidade).toBe('');
    expect(p.uf).toBe('');
  });

  it('corta espaço repetido e apara as pontas', () => {
    expect(lerPartes({ rua: '  Av.   Brasil  ' }).rua).toBe('Av. Brasil');
  });

  it('cMun fica só com dígitos', () => {
    expect(lerPartes({ cmun: '42-09.102' }).cmun).toBe('4209102');
  });

  it('nada preenchido é "deixa pra depois", não erro', () => {
    expect(temAlgumaParte(lerPartes({}))).toBe(false);
    expect(temAlgumaParte(lerPartes({ cep: '89201500' }))).toBe(true);
    /* Complemento sozinho não é endereço: não dispara nada. */
    expect(temAlgumaParte(lerPartes({ complemento: 'Sala 2' }))).toBe(false);
  });
});

describe('semearFiscal: adianta a nota sem passar por cima do oficial', () => {
  const partes = {
    cep: '89201500', rua: 'Av. Brasil', numero: '123',
    bairro: 'Centro', cidade: 'Joinville', uf: 'SC', cmun: '4209102',
  };

  it('campo fiscal vazio é preenchido', () => {
    const semear = semearFiscal(partes, {});
    expect(semear.nfce_logradouro).toBe('Av. Brasil');
    expect(semear.nfce_cmun).toBe('4209102');
    expect(semear.nfce_uf).toBe('SC');
  });

  /*
   * ESTA É A REGRA QUE IMPORTA. O endereço fiscal, quando existe, veio do CNPJ
   * na Receita Federal — fonte oficial, e pode divergir do endereço de entrega
   * DE PROPÓSITO (matriz cadastrada num lugar, operação em outro). Sobrescrever
   * com o que foi digitado no passo de entrega troca o dado oficial pelo
   * aproximado, e o erro aparece numa nota recusada semanas depois.
   */
  it('campo fiscal já preenchido NÃO é sobrescrito', () => {
    const semear = semearFiscal(partes, {
      nfce_logradouro: 'Rua da Matriz', nfce_numero: '1000', nfce_cmun: '3550308',
    });
    expect(semear.nfce_logradouro).toBeUndefined();
    expect(semear.nfce_numero).toBeUndefined();
    expect(semear.nfce_cmun).toBeUndefined();
    /* E os que estavam vazios seguem sendo preenchidos. */
    expect(semear.nfce_bairro).toBe('Centro');
  });

  it('espaço em branco no fiscal conta como vazio', () => {
    expect(semearFiscal(partes, { nfce_logradouro: '   ' }).nfce_logradouro).toBe('Av. Brasil');
  });

  it('parte vazia não apaga o que está no fiscal', () => {
    const semear = semearFiscal({ rua: 'Av. Brasil' }, {});
    expect(semear.nfce_logradouro).toBe('Av. Brasil');
    expect('nfce_numero' in semear).toBe(false);
    expect('nfce_uf' in semear).toBe(false);
  });
});

describe('a fiação: rota e tela', () => {
  const admin = fs.readFileSync(path.join(__dirname, 'rotas', 'admin.ts'), 'utf8');
  const tela = fs.readFileSync(
    path.join(__dirname, '..', '..', 'frontend', 'src', 'pages', 'admin', 'tenants.tsx'), 'utf8');
  const cep = fs.readFileSync(
    path.join(__dirname, '..', '..', 'frontend', 'src', 'lib', 'cep.ts'), 'utf8');

  it('a rota monta o texto a partir das partes', () => {
    const rota = admin.slice(admin.indexOf("router.put('/lojas/:id/detalhes'"));
    const corpo = rota.slice(0, rota.indexOf('\nrouter.'));
    expect(corpo).toMatch(/lerPartes\(req\.body/);
    expect(corpo).toMatch(/montarEnderecoTexto\(partes\)/);
    expect(corpo).toMatch(/semearFiscal\(partes/);
  });

  /*
   * `endereco` cru continua aceito: a tela do lojista e chamadas antigas ainda
   * mandam a linha pronta. Quebrar isso para trocar o formato de um campo
   * seria trocar um problema por outro.
   */
  it('a rota ainda aceita o endereço em texto, como antes', () => {
    const rota = admin.slice(admin.indexOf("router.put('/lojas/:id/detalhes'"));
    expect(rota.slice(0, 3000)).toMatch(/req\.body\.endereco !== undefined/);
  });

  it('a tela busca o CEP e manda as partes', () => {
    expect(tela).toMatch(/buscarCep\(/);
    expect(tela).toMatch(/cep, rua, numero, complemento, bairro, cidade, uf, cmun/);
  });

  /* Busca ao completar os 8 dígitos, sem botão: um botão a mais é um passo que
     a pessoa esquece, e aí ela digita o endereço inteiro à mão. */
  it('a busca dispara nos 8 dígitos, sem botão', () => {
    expect(tela).toMatch(/cepDigitos\(bruto\)\.length !== 8/);
  });

  /*
   * O cMun vem do ViaCEP e era jogado fora. Sem ele, quem cadastra o fiscal
   * procura o código do município numa tabela do IBGE e digita sete dígitos na
   * mão — errar um rejeita a nota.
   */
  it('o CEP devolve o código IBGE do município', () => {
    expect(cep).toMatch(/cmun: String\(j\.ibge/);
  });
});
