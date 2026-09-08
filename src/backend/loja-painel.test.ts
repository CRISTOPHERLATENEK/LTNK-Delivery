/**
 * A TELA DE DETALHE DA LOJA — o que o servidor precisa entregar, e o que a tela
 * não pode prometer.
 *
 * Testes de fonte: o valor aqui não é um cálculo, é a estrutura — uma chamada
 * só, campos que existem de verdade, e nenhum controle que o servidor desfaz
 * por trás.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const semComentarios = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/*
 * A FONTE VEM SEM COMENTÁRIO.
 *
 * O primeiro teste do histórico falhou por causa do MEU comentário: ele explica
 * que o `.catch(() => [])` foi removido, e continha o próprio texto que o teste
 * procurava. Comentário que fala do erro não pode ser confundido com o erro.
 */
const admin = semComentarios(fs.readFileSync(path.join(__dirname, 'rotas', 'admin.ts'), 'utf8'));
const servidor = fs.readFileSync(path.join(__dirname, 'server.ts'), 'utf8');
const tela = fs.readFileSync(
  path.join(__dirname, '..', '..', 'frontend', 'src', 'pages', 'admin', 'loja-detalhe.tsx'), 'utf8');
const lista = fs.readFileSync(
  path.join(__dirname, '..', '..', 'frontend', 'src', 'pages', 'admin', 'lojas.tsx'), 'utf8');

const rota = () => {
  const i = admin.indexOf("router.get('/lojas/:id/painel'");
  expect(i).toBeGreaterThan(0);
  return admin.slice(i, admin.indexOf('\n});', i));
};

describe('a tela monta com UMA chamada', () => {
  it('a rota devolve loja, resumo, pedidos e auditoria juntos', () => {
    /*
     * Cinco requisições fariam a tela montar em cascata — cada bloco aparecendo
     * num momento diferente, com o layout pulando enquanto a pessoa já está
     * lendo.
     */
    const t = rota();
    for (const campo of ['loja,', 'resumo:', 'pedidos,', 'auditoria,', 'comissao_padrao:']) {
      expect(t, campo).toContain(campo);
    }
  });

  it('o histórico lê a tabela CERTA e não engole o erro', () => {
    /*
     * A tabela é `admin_auditoria`. Na primeira versão escrevi `auditoria` com
     * um `.catch(() => [])` em volta — o histórico apareceria vazio para
     * sempre, parecendo "esta loja nunca foi mexida" em vez de "a consulta está
     * quebrada".
     */
    const t = rota();
    expect(t).toContain('FROM admin_auditoria');
    expect(t).not.toMatch(/admin_auditoria[\s\S]{0,200}catch\(\(\) => \[\]\)/);
  });

  it('os números têm recorte de período', () => {
    /* Sem recorte, "faturamento" é o histórico inteiro: um número que só cresce
       e não responde nada. */
    const t = rota();
    expect(t).toMatch(/periodo_dias/);
    expect(t).toMatch(/criado_em >= \?/);
    /*
     * E o padrão é LIMITADO. Testado só por "existe recorte", passava com o
     * padrão trocado por 99999 dias — que é o histórico inteiro com outro nome.
     */
    expect(t).toMatch(/Math\.min\(365, Math\.max\(1, Number\(req\.query\.dias\) \|\| 30\)\)/);
  });

  it('a lista de pedidos tem teto', () => {
    /* A coluna do meio filtra e busca localmente; trazer o histórico inteiro de
       uma loja movimentada travaria a tela. */
    expect(rota()).toMatch(/LIMIT 200/);
  });
});

describe('a tela não promete o que o sistema não faz', () => {
  it('as abas cobrem os seis assuntos', () => {
    /*
     * Uma aba por assunto foi a razão da v2: três colunas espremiam endereço e
     * razão social em quatro linhas, e a configuração pesada só cabia atrás de
     * um botão "avançado".
     */
    for (const id of ['resumo', 'pedidos', 'cadastro', 'configuracao', 'fiscal', 'historico']) {
      expect(tela, id).toContain(`id: '${id}'`);
    }
  });

  it('o contador de pendências do Resumo e o da aba são o MESMO cálculo', () => {
    /* Se o Resumo dissesse "3 pendências" e a aba mostrasse 2, a pessoa
       deixaria de confiar nos dois números. */
    expect(tela).toContain('contagem: atencao.length || undefined');
    expect((tela.match(/const atencao:/g) ?? []).length).toBe(1);
  });

  it('a faixa da aba Fiscal libera o módulo sem sair dali', () => {
    /*
     * Quem abre "Fiscal" e encontra tudo cinza precisa saber por quê e poder
     * resolver ali — e o alvo vai por parâmetro, senão `salvar` leria o estado
     * anterior do React e o clique não faria nada.
     */
    expect(tela).toContain('Liberar módulo');
    expect(tela).toContain('void salvar(true)');
    expect(tela).toMatch(/async function salvar\(forcarFiscal\?: boolean\)/);
  });

  /*
   * O CHAT ESTÁ DESLIGADO A PEDIDO, enquanto a metade de IA não tem crédito de
   * API pago. Este teste mudou de lado de propósito: antes ele exigia que o
   * botão aparecesse, e a razão era justamente evitar um `false &&` acidental
   * que deixasse a marca na fonte e o chat fechado para sempre. Agora o
   * desligamento é a decisão — então o que ele guarda é OUTRA coisa: que o
   * desligamento seja de UM interruptor só, e que a fiação continue inteira,
   * para religar custar uma palavra em vez de uma arqueologia.
   */
  it('o chat está fora da tela por um interruptor só', () => {
    expect(tela).toMatch(/const SUPORTE_NA_TELA = false;/);
    /* Os DOIS blocos atrás do mesmo interruptor. Se só o botão ficasse
       escondido, o painel ainda abriria por outro caminho (deep link, estado
       inicial) e a pessoa cairia na pergunta que não responde. */
    expect(tela).toMatch(/\{SUPORTE_NA_TELA && !chat && \(/);
    expect(tela).toMatch(/\{SUPORTE_NA_TELA && chat && \(\s*<ChatSuporte/);
    /* E nenhum outro `SUPORTE_NA_TELA` ligado em outro lugar. */
    expect(tela.match(/SUPORTE_NA_TELA/g)).toHaveLength(3); // a declaração + os 2 usos
  });

  it('a fiação do chat continua inteira, para religar em uma palavra', () => {
    /*
     * Sem isto, "desativar" viraria apagar o código, e voltar atrás custaria
     * reescrever o painel. O botão, o estado e o componente seguem no arquivo.
     */
    expect(tela).toContain('onClick={() => setChat(true)}');
    expect(tela).toContain('<MarcaX tamanho={22} />');
    expect(tela).toContain('<ChatSuporte lojaId={l.id}');
    /*
     * E continua não sendo aba: aba daria a ele o mesmo peso de "Pedidos" e
     * "Fiscal", que são assuntos da loja. O suporte é ferramenta — chama-se de
     * qualquer aba, sem perder a aba onde a pessoa estava. Vale enquanto está
     * desligado também, senão religar traz a decisão errada de volta.
     */
    expect(tela).not.toMatch(/id: 'suporte'|id: 'chat'/);
  });

  it('"loja aberta" é LEITURA, não interruptor', () => {
    /*
     * Com `auto_horario`, um job a cada 60s força `aberta` conforme a agenda da
     * loja. Um interruptor aqui seria desfeito sozinho em um minuto — e
     * controle que não obedece é pior que controle que não existe, porque
     * ensina a desconfiar dos outros.
     */
    expect(servidor).toContain("UPDATE lojas SET aberta = ? WHERE id = ?");
    expect(rota()).toContain('abertura_automatica');
    /* Os interruptores da tela são só os dois módulos. */
    /* `<Interruptor` com o espaço/quebra a seguir: sem isso o `<Interruptor`
       da linha de definição do componente entraria na conta. */
    const interruptores = tela.match(/<Interruptor[\s]/g) ?? [];
    expect(interruptores.length).toBe(2);
    /* A frase mudou na v2 para a do desenho ("o admin não altera"). O que o
       teste garante continua sendo o mesmo: a tela DIZ por que é leitura, em
       vez de deixar a pessoa achando que o controle sumiu. */
    expect(tela).toContain('o admin não altera');
  });

  it('"último acesso" vem do banco, não de estimativa', () => {
    /*
     * ESTE TESTE MUDOU DE LADO, e o motivo fica registrado.
     *
     * Ele garantia que a tela NÃO mostrasse "último acesso": o desenho pedia a
     * linha e nada no banco registrava o dado, então mostrar um traço pareceria
     * defeito da tela. A coluna passou a existir (`usuarios.ultimo_acesso`,
     * gravada no login), então a garantia deixou de ser "não mostre" e passou a
     * ser "mostre o valor REAL" — nada de derivar de último pedido, que diz se
     * a LOJA vendeu e não se o dono entrou.
     */
    expect(tela).toContain('dono_ultimo_acesso');
    const i = admin.indexOf("router.get('/lojas/:id/painel'");
    expect(admin.slice(i, i + 2000)).toContain('u.ultimo_acesso AS dono_ultimo_acesso');
  });
});

describe('último acesso e IP', () => {
  const login = fs.readFileSync(path.join(__dirname, 'rotas', 'autenticacao.ts'), 'utf8');
  const acesso = fs.readFileSync(path.join(__dirname, 'ultimo-acesso.ts'), 'utf8');
  const schema = fs.readFileSync(path.join(__dirname, 'schema-mysql.ts'), 'utf8');

  it('o acesso é marcado no LOGIN, não a cada requisição', () => {
    /*
     * Marcar em toda chamada autenticada daria "visto há 30 segundos" ao preço
     * de um UPDATE por requisição na tabela mais lida do sistema. A pergunta
     * real é "entrou esta semana?", e o login responde.
     */
    expect(schema).toContain("['usuarios', 'ultimo_acesso'");
    expect(acesso).toContain('UPDATE usuarios SET ultimo_acesso = ?');
    /* Os TRÊS pontos que concedem sessão: login, 2FA configurado, 2FA
       verificado. Faltar um deixaria uma parte dos usuários sem registro para
       sempre, e ninguém notaria — o campo simplesmente ficaria velho. */
    expect((login.match(/registrarAcesso\(usuario\.id\)/g) ?? []).length).toBe(3);
  });

  it('falhar ao marcar o acesso NÃO impede de entrar', () => {
    /* Seria trocar um dado de conveniência por um cliente sem acesso. */
    expect(acesso).toMatch(/catch \{[^}]*\}/);
    expect(semComentarios(acesso)).not.toMatch(/throw/);
  });

  it('vazio é "sem registro", não "nunca entrou"', () => {
    /*
     * Quem entrou ANTES de a coluna existir aparece vazio até o próximo login.
     * Escrever "nunca entrou" acusaria de inativo um cliente que usa o sistema
     * todo dia — e é com base nessa tela que alguém decide ligar cobrando uso.
     */
    expect(tela).toContain("'sem registro'");
    /* Sem comentário: o comentário da própria tela explica por que a frase é
       proibida, e citá-la lá não é usá-la. */
    expect(semComentarios(tela)).not.toMatch(/nunca entrou/);
  });

  it('a auditoria grava o IP, com espaço para IPv6', () => {
    /*
     * 45 caracteres: IPv6 mapeado em IPv4 chega a esse tamanho
     * (`::ffff:255.255.255.255`). VARCHAR(15) cortaria o endereço no meio e
     * guardaria um IP que não existe.
     */
    expect(schema).toContain("['admin_auditoria', 'ip', \"ip VARCHAR(45)");
    const i = admin.indexOf('INSERT INTO admin_auditoria');
    const t = admin.slice(i, i + 700);
    expect(t).toContain('ip, criado_em');
    expect(t).toContain('String(req.ip');
  });

  it('o IP vai truncado, e vem do req.ip (que depende do trust proxy)', () => {
    /*
     * Sem `trust proxy` configurado, atrás da Cloudflare todo registro sairia
     * com o IP do proxy — um dado que parece informação e não identifica
     * ninguém. O `slice` existe porque endereço maior que a coluna faria o
     * INSERT falhar e o registro de auditoria simplesmente não acontecer.
     */
    const i = admin.indexOf('INSERT INTO admin_auditoria');
    expect(admin.slice(i, i + 700)).toContain('.slice(0, 45)');
    expect(servidor).toContain("app.set('trust proxy', saltosConfiaveis)");
  });

  it('as duas telas mostram a origem', () => {
    expect(tela).toContain('<span>Origem</span>');
    const auditoria = fs.readFileSync(
      path.join(__dirname, '..', '..', 'frontend', 'src', 'pages', 'admin', 'auditoria.tsx'), 'utf8');
    expect(auditoria).toContain('<span>Origem</span>');
    /* E o CSV também: quem exporta para investigar acesso precisa do IP. */
    expect(auditoria).toContain("'Origem'],");
  });
});

describe('nada do painel antigo se perdeu', () => {
  it('os editores que só existiam lá continuam alcançáveis', () => {
    /*
     * Domínio, WhatsApp, canal de liberação e cadastro fiscal moravam dentro do
     * painel lateral que esta tela substituiu. Sem eles, o refactor teria
     * apagado funcionalidade em vez de reorganizá-la.
     */
    for (const c of ['DominioLojaEditor', 'WhatsAppPermissoesEditor', 'ModulosDaLoja', 'FiscalLojaAdmin']) {
      expect(lista, c).toContain(`export function ${c}(`);
      expect(tela, c).toContain(`<${c}`);
    }
  });

  it('a lista leva para a TELA, não abre painel', () => {
    expect(lista).toContain("navegar(`/painel-admin/lojas/${l.id}");
    expect(lista).not.toContain('PainelLateral');
  });

  it('o tenant viaja na URL', () => {
    /*
     * No painel master o id da loja se repete entre clientes: sem o tenant, a
     * consulta cairia no banco errado e mostraria a loja de OUTRO cliente com o
     * mesmo id.
     */
    expect(lista).toContain('?tenant_id=${l.tenant_id}');
    expect(tela).toContain("params.get('tenant_id')");
    expect(tela).toContain('comTenant(`/api/admin/lojas/${id}/painel`)');
  });

  it('impersonar usa a rota do TENANT, que é a que existe', () => {
    /* Não existe `/lojas/:id/impersonar`. Chamá-la daria 404 no clique. */
    expect(tela).toContain('/api/admin/tenants/${tenantId}/impersonar');
    expect(admin).toContain("router.post('/tenants/:id/impersonar'");
  });
});
