import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  enderecoDeRetirada, acharEnderecoNosso, corpoDoEndereco,
  REFERENCIA_RETIRADA, DESCRICAO_RETIRADA,
} from './maxxgestao-endereco-retirada';
import { montarDocumento, type DadosDoPedido, type ConfigDocumento } from './maxxgestao-documento';

/*
 * O ENDEREÇO DA LOJA NO CAMPO DE ENDEREÇO DO DOCUMENTO.
 *
 * "não tem como sair com o endereço do lojista?"
 *
 * Tem, e o caminho não é óbvio: o `POST /api/documento/v1` não aceita endereço
 * como texto. O bloco `pessoa` tem `idPessoa`, `idEndereco` e `observacao`, e
 * `idEndereco` é "o código do endereço DA PESSOA" — para aparecer no documento,
 * o endereço precisa estar cadastrado na ficha de alguém.
 *
 * Na retirada pelo app o cliente está logado, então a pessoa é ELE. O lojista
 * escolheu, com o custo na mesa: o endereço da loja entra na ficha do cliente
 * como um endereço extra, "Retirada na loja", com `principal: 'N'`.
 *
 * ─────────────── A ARMADILHA ───────────────
 *
 * "Quando for o primeiro endereço da pessoa, ele será definido como principal
 * automaticamente" — e pessoa sem endereço EXISTE aqui: `pessoaDoCliente` cria
 * assim quando a cidade do cliente não é a da empresa.
 *
 * Nessa ficha, o nosso viraria o principal, e toda ENTREGA futura para esse
 * cliente sairia com o endereço da loja — a mercadoria voltando ao balcão de
 * onde saiu. Por isso ficha sem nenhum endereço fica de fora.
 */

const raiz = path.join(__dirname, '..', '..');
const ler = (...p: string[]) => fs.readFileSync(path.join(raiz, ...p), 'utf8');
const semComentarios = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const EMITIR = semComentarios(ler('src', 'backend', 'maxxgestao-emitir.ts'));
const SCHEMA = semComentarios(ler('src', 'backend', 'schema-mysql.ts'));

const EMPRESA = {
  logradouro: 'Rua Dilson Funaro', numero: '1705', complemento: '',
  bairro: 'Centro', idIbgeMunicipio: 4209102, cep: 89219000, uf: 'SC',
};

describe('achar o endereço que já criamos', () => {
  /*
   * PELA MARCA, e não pela descrição: descrição é texto que o lojista edita na
   * tela do ERP, e um endereço renomeado viraria um segundo criado por nós na
   * próxima retirada — e um terceiro na seguinte.
   */
  it('acha pela referência de integração', () => {
    expect(acharEnderecoNosso([
      { idEndereco: 10, descricao: 'Casa' },
      { idEndereco: 11, descricao: 'Qualquer nome', referenciaIntegracao: REFERENCIA_RETIRADA },
    ])).toBe(11);
  });

  it('descrição igual sem a marca não conta', () => {
    expect(acharEnderecoNosso([{ idEndereco: 10, descricao: DESCRICAO_RETIRADA }])).toBe(0);
  });

  it('lista vazia ou ausente devolve zero', () => {
    expect(acharEnderecoNosso([])).toBe(0);
    expect(acharEnderecoNosso(null)).toBe(0);
  });
});

describe('o corpo do endereço', () => {
  it('copia o cadastro da empresa', () => {
    const c = corpoDoEndereco(EMPRESA)!;
    expect(c.logradouro).toBe('Rua Dilson Funaro');
    expect(c.idIbgeMunicipio).toBe(4209102);
    expect(c.uf).toBe('SC');
    expect(c.descricao).toBe(DESCRICAO_RETIRADA);
    expect(c.referenciaIntegracao).toBe(REFERENCIA_RETIRADA);
  });

  /* `N` explícito. Não basta sozinho — a API promove o primeiro endereço da
     ficha —, mas sem ele nem o segundo estaria garantido. */
  it('nunca pede para ser o principal', () => {
    expect(corpoDoEndereco(EMPRESA)!.principal).toBe('N');
  });

  /* `cep` é INTEIRO nesta API ("informe 0 quando não houver valor"): texto com
     hífen viraria recusa. */
  it('o CEP vai como número', () => {
    expect(corpoDoEndereco({ ...EMPRESA, cep: '89219-000' })!.cep).toBe(0);
    expect(corpoDoEndereco({ ...EMPRESA, cep: 89219000 })!.cep).toBe(89219000);
  });

  /*
   * ENDEREÇO PELA METADE É PIOR QUE NENHUM: ele PARECE preenchido na tela e não
   * serve para nada, e ninguém confere de novo um campo que já está escrito.
   */
  it('sem logradouro ou sem município, não monta', () => {
    expect(corpoDoEndereco({ ...EMPRESA, logradouro: '' })).toBeNull();
    expect(corpoDoEndereco({ ...EMPRESA, idIbgeMunicipio: 0 })).toBeNull();
    expect(corpoDoEndereco(null)).toBeNull();
  });
});

/** ERP de mentira: devolve a lista combinada e registra o que foi criado. */
function erpFalso(items: unknown[] | null) {
  const criados: Record<string, unknown>[] = [];
  return {
    criados,
    listar: async () => (items === null ? null : { items }) as never,
    criar: async (corpo: Record<string, unknown>) => {
      criados.push(corpo);
      return { endereco: { idEndereco: 99 } } as never;
    },
  };
}

describe('quando criar o endereço na ficha do cliente', () => {
  it('reusa o que já existe, sem criar outro', async () => {
    const erp = erpFalso([{ idEndereco: 42, referenciaIntegracao: REFERENCIA_RETIRADA }]);
    expect(await enderecoDeRetirada(erp.listar, erp.criar, EMPRESA)).toBe(42);
    expect(erp.criados.length).toBe(0);
  });

  it('cria quando a ficha já tem outro endereço', async () => {
    const erp = erpFalso([{ idEndereco: 7, descricao: 'Casa' }]);
    expect(await enderecoDeRetirada(erp.listar, erp.criar, EMPRESA)).toBe(99);
    expect(erp.criados.length).toBe(1);
    expect(erp.criados[0].principal).toBe('N');
  });

  /*
   * ESTA É A ASSERÇÃO QUE PROTEGE A ENTREGA. Ficha vazia: o nosso viraria
   * principal, e a próxima entrega para este cliente sairia com o endereço da
   * loja. Um campo bonito no documento não vale uma entrega perdida.
   */
  it('ficha SEM endereço nenhum não recebe nada', async () => {
    const erp = erpFalso([]);
    expect(await enderecoDeRetirada(erp.listar, erp.criar, EMPRESA)).toBe(0);
    expect(erp.criados.length).toBe(0);
  });

  it('empresa sem endereço utilizável não cria', async () => {
    const erp = erpFalso([{ idEndereco: 7, descricao: 'Casa' }]);
    expect(await enderecoDeRetirada(erp.listar, erp.criar, { logradouro: '' })).toBe(0);
    expect(erp.criados.length).toBe(0);
  });

  /* Listagem que não respondeu conta como ficha vazia — e ficha vazia não
     recebe. Criar às cegas é exatamente o caso perigoso. */
  it('listagem sem resposta não cria', async () => {
    const erp = erpFalso(null);
    expect(await enderecoDeRetirada(erp.listar, erp.criar, EMPRESA)).toBe(0);
    expect(erp.criados.length).toBe(0);
  });
});

const PEDIDO: DadosDoPedido = {
  id: 77, tipoEntrega: 'retirada', totalCentavos: 1000, formaPagamento: 'dinheiro',
  itens: [{ nome: 'ÁGUA', quantidade: 1, precoUnitarioCentavos: 1000, variacaoErp: 985 }],
};
const CONFIG: ConfigDocumento = {
  idNaturezaOperacao: 1, idPessoa: 1, idUsuario: 5470, idPagamento: 1,
  modelo: 'PA', idCaixa: 0, dataHora: '2026-09-17T16:29:06', serie: '1', numero: 14,
};
const pessoaDo = (c: ConfigDocumento) =>
  (montarDocumento(PEDIDO, c).corpo as { pessoa: Record<string, unknown> }).pessoa;

describe('o documento', () => {
  it('leva o idEndereco quando há', () => {
    expect(pessoaDo({ ...CONFIG, idEndereco: 99 })).toEqual({ idPessoa: 1, idEndereco: 99 });
  });

  /*
   * ZERO NÃO VAI. O ERP leria "endereço zero" em vez de "não informado", e a
   * regra do campo é cair no principal do cadastro quando ausente — que é o
   * comportamento certo para entrega.
   */
  it('zero e ausente não viram campo', () => {
    expect(pessoaDo({ ...CONFIG, idEndereco: 0 })).toEqual({ idPessoa: 1 });
    expect(pessoaDo(CONFIG)).toEqual({ idPessoa: 1 });
  });
});

describe('o envio', () => {
  it('só prepara na retirada, e só com cliente identificado', () => {
    expect(EMITIR).toContain("if (dados.tipoEntrega === 'retirada' && idPessoa > 0 && Number(pedido.cliente_id) > 0)");
  });

  /* Guardado na ficha do cliente: sem isso seriam duas chamadas (listar e
     criar) em toda retirada, contra um teto de 20 por minuto, para um id que
     nunca muda. */
  it('guarda o id para não repetir as chamadas', () => {
    expect(SCHEMA).toContain("['usuarios', 'maxxgestao_endereco_retirada', 'maxxgestao_endereco_retirada INT NOT NULL DEFAULT 0']");
    expect(EMITIR).toContain('COALESCE(maxxgestao_endereco_retirada, 0) AS e FROM usuarios WHERE id = ?');
    expect(EMITIR).toContain('UPDATE usuarios SET maxxgestao_endereco_retirada = ? WHERE id = ?');
    /* E só chama o ERP quando não tem guardado. */
    expect(EMITIR).toContain('if (idEnderecoRetirada <= 0) {');
  });

  /* A empresa é lida UMA vez e reaproveitada: `/api/empresa/v1` já era
     consultado para o município do cliente, e ler de novo seria uma requisição
     a mais por pedido para o mesmo dado. */
  it('reaproveita a leitura da empresa', () => {
    expect(EMITIR).toContain('empresaDoErp = empresa as EnderecoDaEmpresa | null;');
    expect(EMITIR).toContain('empresaDoErp,');
    expect((EMITIR.match(/'\/api\/empresa\/v1'/g) || []).length).toBe(1);
  });

  /* Falha não segura o pedido: sem o campo, o endereço continua saindo na
     observação — que é como estava antes desta função existir. */
  it('falha em silêncio e deixa o pedido subir', () => {
    const i = EMITIR.indexOf('idEnderecoRetirada = await enderecoDeRetirada(');
    const bloco = EMITIR.slice(i, i + 1200);
    expect(bloco).toContain('} catch (e) {');
    expect(bloco).toContain('vai só na observação');
  });

  /* A observação continua indo. Não é redundância: é o que aparece quando o
     campo não deu — e ele não dá em toda ficha. */
  it('a observação não foi substituída', () => {
    expect(EMITIR).toContain('observacao: observacaoDoDocumento(');
    expect(EMITIR).toContain('idEndereco: idEnderecoRetirada,');
  });
});
