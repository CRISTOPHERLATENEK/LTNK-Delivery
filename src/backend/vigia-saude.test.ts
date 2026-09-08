import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  avaliarCertificado, avaliarDisco, avaliarRejeicoes,
} from './vigia-saude';
import { podeAvisar, voltouAoNormal, _resetarSilencio } from './alerta-destino';

/*
 * O ÚNICO ALERTA PROATIVO DO SISTEMA ERA O DO BACKUP.
 *
 * Certificado a vencer, disco enchendo e nota rejeitada só apareciam em log — e
 * log é onde a informação vai morar quando não há ninguém lendo. Com cliente
 * pagante, "o lojista me avisou" é o pior canal de monitoramento que existe.
 *
 * Os limiares aqui são a decisão, não o código. Um alerta que chega tarde não
 * serve, e um que chega toda hora ensina a ignorar — as duas falhas terminam no
 * mesmo lugar.
 */

const AGORA = Date.parse('2026-09-08T12:00:00Z');
const dias = (n: number) => new Date(AGORA + n * 86_400_000).toISOString();

describe('certificado A1', () => {
  /*
   * TRINTA DIAS, e o motivo é operacional: renovar envolve contador e
   * agendamento. Avisar com 3 dias transforma manutenção em emergência.
   */
  it('avisa a 30 dias do vencimento', () => {
    const a = avaliarCertificado({ id: 1, nome: 'Bar do Zé', validade: dias(25) }, AGORA);
    expect(a).not.toBeNull();
    expect(a!.titulo).toMatch(/vence em 25 dia/);
  });

  it('não avisa quando ainda falta muito', () => {
    expect(avaliarCertificado({ id: 1, nome: 'Bar', validade: dias(120) }, AGORA)).toBeNull();
  });

  /*
   * VENCIDO É OUTRA MENSAGEM, não a mesma com número negativo. "Vence em -3
   * dias" é a frase que faz alguém achar que ainda dá tempo.
   */
  it('vencido tem aviso próprio, e diz que a emissão parou', () => {
    const a = avaliarCertificado({ id: 7, nome: 'Pizzaria', validade: dias(-3) }, AGORA);
    expect(a!.titulo).toMatch(/VENCIDO/);
    expect(a!.corpo).toMatch(/parada/);
    expect(a!.titulo).not.toMatch(/-3/);
  });

  /* Chave diferente por loja E por situação: a loja que venceu não pode ser
     calada pelo aviso de outra que está só a vencer. */
  it('a chave separa loja e situação', () => {
    const vencendo = avaliarCertificado({ id: 1, nome: 'A', validade: dias(10) }, AGORA)!;
    const vencido = avaliarCertificado({ id: 2, nome: 'B', validade: dias(-1) }, AGORA)!;
    expect(vencendo.chave).not.toBe(vencido.chave);
    expect(vencendo.chave).toContain('1');
    expect(vencido.chave).toContain('2');
  });

  it('loja sem certificado não gera aviso', () => {
    expect(avaliarCertificado({ id: 1, nome: 'A', validade: null }, AGORA)).toBeNull();
    expect(avaliarCertificado({ id: 1, nome: 'A', validade: 'nao-e-data' }, AGORA)).toBeNull();
  });
});

describe('disco', () => {
  /*
   * 85% e não 99%: em 99% já não há espaço para gravar o dump do backup nem o
   * log que diria o que aconteceu — o aviso chegaria junto com o estrago.
   */
  it('avisa em 85%', () => {
    expect(avaliarDisco(85)).not.toBeNull();
    expect(avaliarDisco(97)!.titulo).toMatch(/97%/);
  });

  it('não avisa com folga', () => {
    expect(avaliarDisco(84)).toBeNull();
    expect(avaliarDisco(4)).toBeNull();
  });
});

describe('nota rejeitada', () => {
  /*
   * A PARTIR DA PRIMEIRA. Rejeição quase sempre é cadastro errado (CFOP, CSC,
   * intermediador), e cadastro errado rejeita a próxima também — esperar um
   * "limiar razoável" é esperar o problema virar cinquenta notas.
   */
  it('uma rejeição já avisa', () => {
    const a = avaliarRejeicoes('Bar do Zé', 3, 1, 'Rejeicao: CSC invalido');
    expect(a).not.toBeNull();
    expect(a!.titulo).toMatch(/1 nota/);
    expect(a!.corpo).toMatch(/CSC invalido/);
  });

  it('sem rejeição, sem aviso', () => {
    expect(avaliarRejeicoes('Bar', 3, 0, null)).toBeNull();
  });

  it('aguenta rejeição sem motivo registrado', () => {
    expect(avaliarRejeicoes('Bar', 3, 2, null)!.corpo).toMatch(/sem motivo registrado/);
  });
});

describe('silêncio: um aviso por dia POR PROBLEMA', () => {
  beforeEach(() => _resetarSilencio());

  it('o segundo aviso do mesmo problema no mesmo dia não sai', () => {
    expect(podeAvisar('disco', AGORA)).toBe(true);
    expect(podeAvisar('disco', AGORA + 3_600_000)).toBe(false);
  });

  it('depois de um dia, sai de novo', () => {
    expect(podeAvisar('disco', AGORA)).toBe(true);
    expect(podeAvisar('disco', AGORA + 25 * 3_600_000)).toBe(true);
  });

  /*
   * O QUE UM CONTADOR GLOBAL ERRARIA. Se o silêncio fosse um só, disco cheio
   * às 3h calaria certificado vencido às 4h por 24 horas — e o segundo é o que
   * para a emissão fiscal.
   */
  it('um problema não cala o outro', () => {
    expect(podeAvisar('disco', AGORA)).toBe(true);
    expect(podeAvisar('cert-vencido-1', AGORA)).toBe(true);
  });

  it('avisa quando volta ao normal, uma vez só', () => {
    podeAvisar('disco', AGORA);
    expect(voltouAoNormal('disco')).toBe(true);
    expect(voltouAoNormal('disco')).toBe(false);
  });

  /*
   * E NÃO AVISA RECUPERAÇÃO DE PROBLEMA QUE NUNCA EXISTIU. Sem isto, o
   * primeiro ciclo do vigia mandaria "voltou ao normal" de tudo que está bem.
   */
  it('não anuncia recuperação do que nunca quebrou', () => {
    expect(voltouAoNormal('disco')).toBe(false);
  });
});

describe('a fiação do vigia', () => {
  const servidor = fs.readFileSync(path.join(__dirname, 'server.ts'), 'utf8');
  const destino = fs.readFileSync(path.join(__dirname, 'alerta-destino.ts'), 'utf8');

  it('roda no boot e a cada 6 horas', () => {
    expect(servidor).toMatch(/verificarSaude\(\)\.catch/);
    expect(servidor).toMatch(/verificarSaude\(\)\.catch[\s\S]{0,200}6 \* 60 \* 60_000/);
  });

  /*
   * O DESTINO PASSA PELO `suporte_email`. Em produção `ALERTA_EMAIL` não está
   * definido, e o antigo `ALERTA_EMAIL || SMTP_USER` mandava tudo para o
   * endereço da conta de ENVIO — caixa de saída, não caixa de quem cuida.
   */
  it('o destino tenta o suporte_email do painel antes do SMTP_USER', () => {
    /*
     * DENTRO DO CORPO DA FUNÇÃO, não no arquivo. O comentário do topo explica o
     * bug antigo citando `ALERTA_EMAIL || SMTP_USER` — e a asserção de ordem
     * contra o arquivo inteiro batia nessa explicação em vez do código. Mesma
     * armadilha que já apareceu duas vezes nesta base.
     */
    const corpo = destino.slice(
      destino.indexOf('export async function destinatarioDeAlerta'),
      destino.indexOf('export function _resetarSilencio'),
    );
    /*
     * E O QUE VALE É O `return`, não a menção. A primeira versão deste teste
     * procurava a string `suporte_email` — e passou numa sabotagem que
     * mantinha a CONSULTA e jogava o resultado fora. Consultar sem usar é
     * exatamente o defeito que se quer impedir.
     */
    const i = corpo.indexOf('return suporte');
    const j = corpo.indexOf('SMTP_USER');
    expect(corpo).toMatch(/chave = 'suporte_email'/);
    expect(i).toBeGreaterThan(-1);
    expect(j).toBeGreaterThan(-1);
    expect(i).toBeLessThan(j);
  });

  /*
   * AS COLUNAS QUE O VIGIA CONSULTA EXISTEM.
   *
   * Eu escrevi `WHERE excluida = 0` de cabeça, e `lojas` não tem exclusão
   * lógica — o vigia caiu no primeiro ciclo em produção com "Unknown column
   * 'excluida'". Degradou direito (o catch por tenant segurou), mas a checagem
   * não fazia nada, e ninguém saberia sem ler o log do PM2. Consulta de vigia é
   * o pior lugar para uma coluna errada: o silêncio parece "está tudo bem".
   */
  it('as colunas que o vigia consulta existem no schema', () => {
    const vigia = fs.readFileSync(path.join(__dirname, 'vigia-saude.ts'), 'utf8');
    const schema = fs.readFileSync(path.join(__dirname, 'schema-mysql.ts'), 'utf8');
    const lojas = schema.slice(
      schema.indexOf('CREATE TABLE IF NOT EXISTS lojas'),
      schema.indexOf('CREATE TABLE IF NOT EXISTS produtos'),
    );
    expect(lojas).toMatch(/nfce_cert_validade/);
    // A coluna que não existe, pelo nome: se voltar, este teste cai.
    expect(vigia).not.toMatch(/FROM lojas WHERE excluida/);

    const notas = schema.slice(
      schema.indexOf('CREATE TABLE IF NOT EXISTS notas_fiscais'),
      schema.indexOf('CREATE TABLE IF NOT EXISTS zonas_entrega'),
    );
    for (const coluna of ['loja_id', 'status', 'motivo', 'criado_em']) {
      expect(notas).toContain(coluna);
    }
  });

  /*
   * O QUE ESTE VIGIA NÃO FAZ tem que estar escrito nele: processo que morreu
   * não avisa que morreu. Sem essa frase no arquivo, alguém vai contar com o
   * vigia para detectar queda — e é o único caso em que ele não serve.
   */
  it('está escrito que não cobre queda do servidor', () => {
    const vigia = fs.readFileSync(path.join(__dirname, 'vigia-saude.ts'), 'utf8');
    expect(vigia).toMatch(/monitor externo/);
    expect(vigia).toMatch(/n[ãa]o pode avisar que/);
  });
});
