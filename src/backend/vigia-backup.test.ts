/**
 * O VIGIA DO BACKUP.
 *
 * Testes de comportamento sobre pastas de verdade num diretório temporário: o
 * que precisa ser garantido aqui é justamente a leitura do disco, e um teste
 * com `fs` falso provaria só que o mock funciona.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { avaliarBackup } from './vigia-backup';

const HORA = 3_600_000;
let raiz = '';

/** Cria uma pasta de backup com a idade e os arquivos pedidos. */
function pasta(nome: string, horasAtras: number, arquivos: string[]) {
  const p = path.join(raiz, nome);
  fs.mkdirSync(p, { recursive: true });
  for (const a of arquivos) fs.writeFileSync(path.join(p, a), 'x');
  const quando = new Date(Date.now() - horasAtras * HORA);
  fs.utimesSync(p, quando, quando);
}

beforeEach(() => { raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'vigia-')); });
afterEach(() => { fs.rmSync(raiz, { recursive: true, force: true }); });

describe('o vigia olha o RESULTADO, não o processo', () => {
  it('backup de hoje, com dumps: tudo certo', () => {
    pasta('2026-09-04_0312', 2, ['delivery.sql.gz', 'tenant_unimaxx.sql.gz', 'uploads.tar.gz']);
    const r = avaliarBackup(raiz);
    expect(r.ok).toBe(true);
    expect(r.ultimaPasta).toBe('2026-09-04_0312');
    expect(r.arquivos).toBe(3);
  });

  it('pasta de HOJE mas SEM dump nenhum é falha', () => {
    /*
     * O modo de falha mais traiçoeiro: o disco encheu depois do mkdir e antes
     * do primeiro dump. A data está certa, a pasta existe, e não há backup.
     * Quem só olha "existe pasta de hoje?" dorme tranquilo em cima disso.
     */
    pasta('2026-09-04_0312', 2, ['uploads.tar.gz']);
    const r = avaliarBackup(raiz);
    expect(r.ok).toBe(false);
    expect(r.motivo).toMatch(/não tem nenhum dump/);
  });

  it('pasta vazia também é falha', () => {
    pasta('2026-09-04_0312', 1, []);
    expect(avaliarBackup(raiz).ok).toBe(false);
  });

  it('backup velho demais é falha, e o motivo diz de quantas horas', () => {
    /* 30h de tolerância: um backup diário atrasado algumas horas não é
       problema, mas dois dias sem backup é. */
    pasta('2026-09-01_0312', 40, ['delivery.sql.gz']);
    const r = avaliarBackup(raiz);
    expect(r.ok).toBe(false);
    expect(r.motivo).toMatch(/40h atrás/);
  });

  it('29h ainda passa, 31h não', () => {
    /* A borda importa: o cron roda uma vez por dia, então um atraso de algumas
       horas é normal e alertar nele seria alarme falso diário. */
    pasta('ontem', 29, ['delivery.sql.gz']);
    expect(avaliarBackup(raiz).ok).toBe(true);
    fs.rmSync(path.join(raiz, 'ontem'), { recursive: true });
    pasta('anteontem', 31, ['delivery.sql.gz']);
    expect(avaliarBackup(raiz).ok).toBe(false);
  });

  it('olha a pasta MAIS RECENTE, não a primeira em ordem alfabética', () => {
    /*
     * `readdir` devolve em ordem de sistema de arquivos. Ordenar errado faria
     * o vigia julgar pelo backup de duas semanas atrás e alertar todo dia — ou,
     * pior, julgar por um backup velho e achar que está tudo bem.
     */
    pasta('2026-08-20_0312', 300, ['delivery.sql.gz']);
    pasta('2026-09-04_0312', 2, ['delivery.sql.gz']);
    const r = avaliarBackup(raiz);
    expect(r.ok).toBe(true);
    expect(r.ultimaPasta).toBe('2026-09-04_0312');
  });

  it('pasta de backup inexistente é falha, não erro', () => {
    /*
     * Estourar exceção aqui derrubaria o laço de tarefas do servidor por causa
     * de uma pasta faltando — trocando um backup ausente por um servidor com
     * as tarefas paradas.
     */
    const r = avaliarBackup(path.join(raiz, 'nao-existe'));
    expect(r.ok).toBe(false);
    expect(r.motivo).toMatch(/não existe/);
  });

  it('raiz existente mas sem nenhuma pasta é falha', () => {
    const r = avaliarBackup(raiz);
    expect(r.ok).toBe(false);
    expect(r.motivo).toMatch(/nenhuma pasta/);
  });

  it('ignora arquivos soltos na raiz', () => {
    /* O log ou um .tar esquecido na raiz não são backup. Contá-los como pasta
       faria o vigia aprovar uma raiz sem backup nenhum. */
    fs.writeFileSync(path.join(raiz, 'algum.log'), 'x');
    expect(avaliarBackup(raiz).ok).toBe(false);
  });
});

describe('o aviso não vira ruído', () => {
  const fonte = fs.readFileSync(path.join(__dirname, 'vigia-backup.ts'), 'utf8');

  it('avisa no máximo uma vez por dia', () => {
    /* Um e-mail por hora sobre o mesmo problema treina a pessoa a ignorar o
       alerta — e aí o próximo, que é de verdade, também passa. */
    expect(fonte).toContain('const um_dia = 24 * 3_600_000');
    expect(fonte).toMatch(/agora - ultimoAvisoEm < um_dia/);
  });

  it('avisa também quando VOLTA a funcionar', () => {
    /* Sem isso, ninguém sabe se o problema foi resolvido ou se o vigia parou
       junto. */
    expect(fonte).toMatch(/estavaQuebrado = false/);
    expect(fonte).toMatch(/voltou a funcionar/);
  });

  it('nunca lança: o vigia não pode derrubar as tarefas', () => {
    const servidor = fs.readFileSync(path.join(__dirname, 'server.ts'), 'utf8');
    expect(servidor).toMatch(/verificarBackup\(\)\.catch/);
  });

  it('roda só na instância líder', () => {
    /*
     * O PM2 sobe 3 instâncias. Sem a guarda, seriam três e-mails idênticos a
     * cada verificação — e três é o número que faz alguém criar uma regra de
     * filtro no e-mail, que é como o alerta morre.
     */
    const servidor = fs.readFileSync(path.join(__dirname, 'server.ts'), 'utf8');
    const i = servidor.indexOf('verificarBackup()');
    const guarda = servidor.indexOf('if (rodarTarefas) {');
    expect(guarda).toBeGreaterThan(0);
    expect(i).toBeGreaterThan(guarda);
  });
});

describe('o script avisa por e-mail e pinga o heartbeat', () => {
  const script = fs.readFileSync(
    path.join(__dirname, '..', '..', 'infra', 'backup-delivery.sh'), 'utf8');

  it('só manda e-mail em FALHA', () => {
    /* E-mail de "deu tudo certo" todo dia treina a pessoa a arquivar sem ler —
       e aí o dia em que o assunto muda passa batido também. */
    const i = script.indexOf('if [ "$FALHAS" -eq 0 ]; then');
    expect(i).toBeGreaterThan(0);
    const bloco = script.slice(i, i + 700);
    expect(bloco).toContain('avisar_falha');
    /* `avisar_falha` está no ramo do ELSE, não no do sucesso. */
    expect(bloco.indexOf('else')).toBeLessThan(bloco.indexOf('avisar_falha'));
  });

  it('o heartbeat é pingado SÓ no sucesso', () => {
    /*
     * Pingar sempre transformaria o heartbeat em "o script rodou", que não é a
     * pergunta. A pergunta é "houve backup bom" — e é exatamente por isso que
     * ele serve para detectar a máquina fora do ar.
     */
    const i = script.indexOf('if [ "$FALHAS" -eq 0 ]; then');
    const bloco = script.slice(i, i + 700);
    const heartbeat = bloco.indexOf('HEARTBEAT_URL');
    const senao = bloco.indexOf('else');
    expect(heartbeat).toBeGreaterThan(0);
    expect(heartbeat).toBeLessThan(senao);
  });

  it('sem SMTP ou sem heartbeat configurado, o backup NÃO vira falha', () => {
    /* Falta de aviso não pode transformar backup bom em backup falhado: o
       `exit 1` faria o cron reportar erro num dia em que tudo deu certo. */
    expect(script).toMatch(/AVISO nao enviei e-mail: SMTP incompleto/);
    expect(script).toMatch(/\[ -n "\$\{URL:-\}" \]/);
  });

  it('a cópia externa usa `copy`, nunca `sync`', () => {
    /*
     * `sync` espelha: ransomware que cifrasse a pasta local teria a destruição
     * replicada para a cópia externa na execução seguinte, apagando a única
     * sobrevivente.
     */
    expect(script).toContain('rclone copy');
    expect(script).not.toMatch(/rclone sync/);
  });
});
