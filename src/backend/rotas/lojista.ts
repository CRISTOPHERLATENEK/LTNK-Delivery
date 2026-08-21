/**
 * Módulo do LOJISTA: cadastro/configuração da loja, CRUD completo de
 * produtos com grupos de opções, painel de pedidos e relatórios.
 */
import { Router, Request } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import bcrypt from 'bcrypt';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import db, { comTransacao, bancoTenantAtual } from '../db-mysql';
import { tenantPorDbNome } from '../tenants-mysql';
import { autenticar, exigirPerfil } from '../auth';
import { agoraUTC, inicioDoDiaBR, textoLimpo, inteiroPositivo, reaisParaCentavos, erroHttp, lojaAbertaPorAgenda, emailValido, normalizarBairro, dataBrasilia} from '../util';
import { precoVigente } from '../preco-produto';
import { resolverCanais } from '../disponibilidade-produto';
import { transicionarStatus } from '../fluxoPedido';
import { enviarPush } from '../push';
import { comissaoPercentualDaLoja } from '../comissao';
import { poligonoValido } from '../geometria';
import { validarCertificado, lerCertificadoPfx, assinarXmlNfce, assinarPorTag, type CertificadoLido } from '../assinatura';
import QRCode from 'qrcode';
import { montarXmlNfce, urlQrCode, CODIGO_UF, type EmitenteNfce, type VendaNfce } from '../nfce';
import { competenciasDaLoja, montarPacoteXml, enviarPacoteAoContador } from '../xml-contador';
import { destinatariosDe } from '../envio-contador';
import { emailHabilitado } from '../email';
import { codigoProdutoNfce } from '../codigo-produto';
import { tipoPagamentoNfce } from '../tipo-pagamento-nfce';
import {
  transmitirNfce, montarEventoCancelamento, transmitirCancelamento,
  montarInutilizacao, transmitirInutilizacao,
} from '../sefaz';
import { criptografar, descriptografar } from '../cripto';
import { cashInDisponivel, registrarWebhookCashIn, consultarWebhookCashIn } from '../onz';
// Sem ciclo: pagamentos.ts não importa lojista.ts.
import { credenciaisOnzDaLoja } from './pagamentos';
import { testarCredenciaisOficial } from '../whatsapp';
import { wbapiConfigurado, statusSessaoPlataforma } from '../whatsapp-nao-oficial';
import { geocodificarTexto, buscarLocais } from '../geo';
import { resolverFrete } from '../frete';
import { distanciaKm } from '../geometria';
import { sugerirFreteCentavos, explicarSugestao } from '../sugestao-frete';
import { somarVendas, montarResumo, diferencaDeCaixa, classificarDiferenca, somarMovimentos, tempoAberto } from '../caixa';
import { resolverPeriodo, rotuloPeriodo, periodoAnterior, variacaoPercentual, type NomePeriodo } from '../periodo';
import { classificarCurvaAbc, resumirClassesAbc } from '../curva-abc';
import { GrupoOpcao, Loja, OpcaoItem, Produto } from '../../tipos/modelos';

/**
 * Slugs que colidem com rotas fixas do frontend (App.tsx) — a URL da loja é
 * a raiz do domínio (/slug), então nenhum desses nomes pode virar slug.
 */
const SLUGS_RESERVADOS = new Set([
  'demo', 'carrinho', 'pedidos', 'pedido', 'conta', 'esqueci-senha',
  'redefinir-senha', 'lojista', 'entregador', 'cozinha', 'painel-admin', 'api',
]);

/** Pasta protegida do certificado de uma loja (namespeada por tenant). */
export function caminhoCertificado(lojaId: number): string {
  const base = bancoTenantAtual();
  const dir = path.resolve('./dados/certificados');
  // 0700: só o dono lista/entra. Sem isso o umask deixa 0755 e qualquer
  // usuário do servidor consegue enumerar de quais lojas há certificado.
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return path.join(dir, `${base}__loja-${lojaId}.pfx`);
}

// Upload do certificado em memória (validamos antes de gravar em disco).
const uploadCert = multer({ storage: multer.memoryStorage(), limits: { fileSize: 512 * 1024 } });

const router = Router();
router.use(autenticar, exigirPerfil('lojista'));

/* ───────────────────── Permissão por área do painel ───────────────────── */

/**
 * Áreas do painel. A chave vai gravada no usuário; o rótulo é o que o dono lê
 * na hora de marcar as caixinhas.
 */
export const AREAS_PAINEL = [
  { chave: 'pedidos', rotulo: 'Pedidos' },
  { chave: 'vendas', rotulo: 'Vendas (balcão, mesas e comandas)' },
  { chave: 'caixa', rotulo: 'Caixa (abertura, sangria e fechamento)' },
  { chave: 'produtos', rotulo: 'Produtos e categorias' },
  { chave: 'cupons', rotulo: 'Cupons' },
  { chave: 'clientes', rotulo: 'Clientes' },
  { chave: 'avaliacoes', rotulo: 'Avaliações' },
  { chave: 'relatorios', rotulo: 'Relatórios' },
  { chave: 'fiscal', rotulo: 'Fiscal (NFC-e)' },
  { chave: 'config', rotulo: 'Configurações da loja' },
] as const;

/** Prefixo da rota → área. O que não estiver aqui cai em `config`. */
const AREA_POR_PREFIXO: Record<string, string> = {
  pedidos: 'pedidos',
  balcao: 'vendas', mesas: 'vendas', comandas: 'vendas',
  'comandas-historico': 'vendas', 'itens-comanda': 'vendas',
  caixa: 'caixa',
  produtos: 'produtos', grupos: 'produtos', opcoes: 'produtos', categorias: 'produtos',
  cupons: 'cupons',
  clientes: 'clientes',
  avaliacoes: 'avaliacoes',
  relatorios: 'relatorios',
  nfce: 'fiscal', fiscal: 'fiscal',
};

/**
 * Leituras que TODO usuário da loja precisa, seja qual for a permissão.
 *
 * `GET /loja` é chamada por praticamente toda tela (nome da loja, se está
 * aberta, cor da marca). Sem esta exceção, quem não tem `config` não conseguiria
 * nem abrir o painel — o cabeçalho quebraria antes de qualquer área carregar.
 * As outras duas são listas de apoio (categorias em filtros, setores na
 * impressão), sem informação sensível.
 */
const LEITURAS_LIVRES = new Set(['loja', 'categorias', 'setores']);

/** Área exigida por uma requisição. */
export function areaDaRota(metodo: string, caminho: string): string {
  const prefixo = caminho.split('?')[0].split('/').filter(Boolean)[0] ?? '';
  if (metodo === 'GET' && LEITURAS_LIVRES.has(prefixo)) return 'livre';
  /*
   * O QUE NÃO ESTÁ NO MAPA CAI EM `config`, e isso é de propósito: rota nova
   * nasce restrita ao dono em vez de nascer aberta a todo mundo. O contrário
   * — liberar por omissão — transformaria cada rota esquecida num vazamento
   * silencioso de permissão.
   */
  return AREA_POR_PREFIXO[prefixo] ?? 'config';
}

/** Permissões gravadas no usuário; `null` = ainda não configurado. */
function lerPermissoes(json: string | null): string[] | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter(x => typeof x === 'string') : null;
  } catch { return null; }
}

/**
 * Bloqueia no SERVIDOR o que o usuário não pode acessar.
 *
 * Esconder item de menu não é permissão: basta digitar a URL, ou chamar a API
 * direto. A verificação tem que morar aqui, onde o dado sai.
 */
router.use(async (req, res, next) => {
  try {
    const loja = await minhaLoja(req, false);
    if (!loja) return next(); // ainda não cadastrou loja: o resto trata

    // O dono tem tudo, sempre — e é ele quem distribui o resto.
    if (ehDonoDaLoja(req, loja)) return next();

    const area = areaDaRota(req.method, req.path);
    if (area === 'livre') return next();

    const row = await db.prepare('SELECT permissoes FROM usuarios WHERE id = ?')
      .get(req.usuario!.id) as { permissoes: string | null } | undefined;
    const permitidas = lerPermissoes(row?.permissoes ?? null);

    /*
     * SEM PERMISSÃO GRAVADA = ACESSO TOTAL, e isso é compatibilidade, não
     * descuido: os usuários criados antes deste recurso não têm a coluna
     * preenchida, e trancá-los de repente derrubaria quem já estava
     * trabalhando. Todo usuário novo nasce com a lista explícita.
     */
    if (permitidas === null) return next();
    if (permitidas.includes(area)) return next();

    throw erroHttp(403, 'Seu acesso não inclui esta área. Fale com o dono da loja.');
  } catch (e) { next(e); }
});

/**
 * A loja de quem está pedindo — pelo DONO ou pelo VÍNCULO.
 *
 * `lojas.usuario_id` é o dono, e por muito tempo foi o único jeito de alguém
 * enxergar uma loja: um login por estabelecimento. Na prática a loja tem caixa,
 * gerente e balconista, e todos acabavam usando a mesma senha — sem saber quem
 * fez o quê, e sem poder cortar o acesso de quem saiu sem trocar a senha de
 * todo mundo.
 *
 * `usuarios.loja_id` passa a valer como segundo caminho: um usuário criado pelo
 * dono aponta pra loja dele e usa o painel normalmente. O dono continua sendo
 * `lojas.usuario_id` — é ele quem administra os outros (ver `/usuarios`).
 */
async function minhaLoja(req: Request, obrigatoria = true): Promise<Loja> {
  let loja = await db.prepare('SELECT * FROM lojas WHERE usuario_id = ?')
    .get(req.usuario!.id) as Loja | undefined;
  if (!loja) {
    const vinculo = await db.prepare('SELECT loja_id FROM usuarios WHERE id = ?')
      .get(req.usuario!.id) as { loja_id: number | null } | undefined;
    if (vinculo?.loja_id) {
      loja = await db.prepare('SELECT * FROM lojas WHERE id = ?').get(vinculo.loja_id) as Loja | undefined;
    }
  }
  if (!loja && obrigatoria) throw erroHttp(404, 'Você ainda não cadastrou sua loja.');
  return loja as Loja;
}

/** É o DONO da loja? Só ele administra os usuários. */
function ehDonoDaLoja(req: Request, loja: Loja): boolean {
  return (loja as unknown as { usuario_id: number }).usuario_id === req.usuario!.id;
}

async function exigirDono(req: Request, loja: Loja): Promise<void> {
  if (!ehDonoDaLoja(req, loja)) {
    throw erroHttp(403, 'Só o dono da loja pode gerenciar os usuários.');
  }
}

async function meuProduto(loja: Loja, produtoId: number | string): Promise<Produto> {
  const produto = await db.prepare(
    'SELECT * FROM produtos WHERE id = ? AND loja_id = ? AND excluido = 0'
  ).get(produtoId, loja.id) as Produto | undefined;
  if (!produto) throw erroHttp(404, 'Produto não encontrado.');
  return produto;
}

// ----- Loja ----------------------------------------------------------------

router.get('/loja', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    // slug do tenant atual — usado pelo preview do editor Visual (iframe
    // /loja/:id?preview=1&tenant=<slug>) pra achar a loja certa mesmo quando
    // ela não tem domínio próprio configurado (SILO: sem isso, o iframe cairia
    // no tenant errado só pelo Host da aba).
    const tenant = await tenantPorDbNome(bancoTenantAtual());
    /*
     * As permissões vêm JUNTO da loja porque esta é a chamada que todo painel
     * faz ao abrir — assim o menu já monta sabendo o que esconder, sem uma
     * segunda requisição e sem piscar itens que a pessoa não pode abrir.
     *
     * Isto é só pra ESCONDER. O bloqueio de verdade está no middleware, que
     * roda em toda requisição — menu escondido não protege nada sozinho.
     */
    const dono = ehDonoDaLoja(req, loja);
    const row = await db.prepare('SELECT permissoes FROM usuarios WHERE id = ?')
      .get(req.usuario!.id) as { permissoes: string | null } | undefined;
    res.json({
      loja,
      tenant_slug: tenant?.slug ?? null,
      sou_dono: dono,
      permissoes: dono
        ? AREAS_PAINEL.map(a => a.chave)
        : (lerPermissoes(row?.permissoes ?? null) ?? AREAS_PAINEL.map(a => a.chave)),
    });
  } catch (e) { next(e); }
});

router.post('/loja', async (req, res, next) => {
  try {
    if (await minhaLoja(req, false)) throw erroHttp(409, 'Você já tem uma loja cadastrada.');

    const nome = textoLimpo(req.body.nome, 100);
    if (nome.length < 2) throw erroHttp(400, 'Informe o nome da loja.');
    const taxa = reaisParaCentavos(req.body.taxa_entrega);
    const tempo = inteiroPositivo(req.body.tempo_estimado_min) || 40;
    if (taxa === null) throw erroHttp(400, 'Informe a taxa de entrega (use 0 para entrega grátis).');
    const endereco = textoLimpo(req.body.endereco, 200);
    const coord = endereco ? await geocodificarTexto(endereco) : null; // best-effort

    const info = await db.prepare(
      `INSERT INTO lojas (usuario_id, nome, descricao, categoria, endereco, lat, lon,
                          taxa_entrega_centavos, tempo_estimado_min, horario_funcionamento,
                          status_aprovacao, aberta, criado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendente', 0, ?)`
    ).run(req.usuario!.id, nome, textoLimpo(req.body.descricao, 300),
          textoLimpo(req.body.categoria, 50) || 'Outros', endereco, coord?.lat ?? null, coord?.lon ?? null,
          taxa, tempo, textoLimpo(req.body.horario_funcionamento, 100), agoraUTC());

    res.status(201).json({
      loja_id: Number(info.lastInsertRowid),
      mensagem: 'Loja cadastrada! Ela ficará visível assim que o admin aprovar.',
    });
  } catch (e) { next(e); }
});

router.put('/loja', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    const nome = textoLimpo(req.body.nome, 100) || loja.nome;
    const taxa = req.body.taxa_entrega !== undefined
      ? reaisParaCentavos(req.body.taxa_entrega) : loja.taxa_entrega_centavos;
    const tempo = req.body.tempo_estimado_min !== undefined
      ? inteiroPositivo(req.body.tempo_estimado_min) : loja.tempo_estimado_min;
    if (taxa === null) throw erroHttp(400, 'Taxa de entrega inválida.');
    if (!tempo) throw erroHttp(400, 'Tempo estimado inválido.');

    // Marca visual da loja (white label): URLs HTTPS e cor hex opcionais.
    const validarUrl = (campo: string, atual: string): string => {
      if (req.body[campo] === undefined) return atual;
      const v = textoLimpo(req.body[campo], 500);
      if (v && !/^https?:\/\//i.test(v) && !v.startsWith('/uploads/')) throw erroHttp(400, `URL inválida em "${campo}" (use https://…).`);
      return v;
    };
    const validarCor = (campo: string, atual: string): string => {
      if (req.body[campo] === undefined) return atual;
      const v = textoLimpo(req.body[campo], 20);
      if (v && !/^#[0-9a-fA-F]{6}$/.test(v)) throw erroHttp(400, 'Use uma cor em formato hexadecimal (#RRGGBB).');
      return v;
    };

    // Slug amigável para URL da loja (ex: pizzaria-da-paula) — vira a URL raiz
    // do domínio (/slug, sem prefixo /loja/), por isso não pode colidir com
    // nenhuma rota fixa do app.
    const lojaQualquer = loja as any;
    let slug = lojaQualquer.slug ?? null;
    if (req.body.slug !== undefined) {
      const s = textoLimpo(req.body.slug, 60).toLowerCase().replace(/\s+/g, '-');
      if (s && !/^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/.test(s)) {
        throw erroHttp(400, 'Slug inválido: use apenas letras minúsculas, números e hífens (mín. 3 chars).');
      }
      if (s && SLUGS_RESERVADOS.has(s)) {
        throw erroHttp(400, `"${s}" é uma URL reservada do sistema — escolha outro slug.`);
      }
      if (s) {
        const conflito = await db.prepare('SELECT id FROM lojas WHERE slug = ? AND id != ?').get(s, loja.id);
        if (conflito) throw erroHttp(409, 'Este slug já está sendo usado por outra loja.');
      }
      slug = s || null;
    }

    // Domínio próprio (alternativa ao slug): ex. pizzariadapaula.com.br.
    // Guardamos sem protocolo/www/caminho — o lojista aponta o DNS por fora.
    let dominioPersonalizado = lojaQualquer.dominio_personalizado ?? null;
    if (req.body.dominio_personalizado !== undefined) {
      let d = textoLimpo(req.body.dominio_personalizado, 200).toLowerCase()
        .replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
      if (d && !/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/.test(d)) {
        throw erroHttp(400, 'Domínio inválido. Use o formato "suaempresa.com.br", sem https:// nem barras.');
      }
      if (d) {
        const conflito = await db.prepare('SELECT id FROM lojas WHERE dominio_personalizado = ? AND id != ?').get(d, loja.id);
        if (conflito) throw erroHttp(409, 'Este domínio já está sendo usado por outra loja.');
      }
      dominioPersonalizado = d || null;
    }

    // Agenda semanal (horário automático): valida e normaliza o JSON.
    let horarioJson = lojaQualquer.horario_json ?? '[]';
    if (req.body.horario_json !== undefined) {
      horarioJson = validarHorarioJson(req.body.horario_json);
    }
    const autoHorario = req.body.auto_horario !== undefined
      ? (req.body.auto_horario ? 1 : 0)
      : (lojaQualquer.auto_horario ?? 0);
    const minimoPedido = req.body.minimo_pedido !== undefined
      ? (reaisParaCentavos(req.body.minimo_pedido) ?? 0)
      : (lojaQualquer.minimo_pedido_centavos ?? 0);
    if (minimoPedido < 0) throw erroHttp(400, 'Pedido mínimo inválido.');
    // Retirada no local: desligada por padrão. Só a loja sabe se tem balcão.
    const aceitaRetirada = req.body.aceita_retirada !== undefined
      ? (req.body.aceita_retirada ? 1 : 0)
      : (lojaQualquer.aceita_retirada ?? 0);

    // Impressão térmica
    const impLargura = req.body.impressora_largura !== undefined
      ? (String(req.body.impressora_largura) === '58' ? '58' : '80')
      : (lojaQualquer.impressora_largura ?? '80');
    const impAuto = req.body.impressora_auto !== undefined
      ? (req.body.impressora_auto ? 1 : 0)
      : (lojaQualquer.impressora_auto ?? 1);
    const cupomRodape = req.body.cupom_rodape !== undefined
      ? textoLimpo(req.body.cupom_rodape, 160)
      : (lojaQualquer.cupom_rodape ?? '');

    // Editor visual completo (aba "Visual"): blob JSON com os campos cosméticos
    // granulares (cores extras, logo, capa, cardápio, botões, tipografia,
    // banners, avançado/SEO/pixels).
    let visualJson = lojaQualquer.visual_json ?? '{}';
    if (req.body.visual_json !== undefined) {
      visualJson = validarVisualJson(req.body.visual_json, visualJson);
    }

    /**
     * Geocodifica quando o endereço muda OU quando a loja ainda não tem
     * coordenada.
     *
     * BECO SEM SAÍDA QUE ISSO CORRIGE: antes só re-geocodificava se o endereço
     * mudasse. A geocodificação é best-effort — o Nominatim limita requisição e
     * às vezes não acha o endereço — então uma falha na primeira tentativa
     * deixava a loja SEM coordenada PARA SEMPRE: salvar de novo com o mesmo
     * endereço nunca tentava outra vez. Sem coordenada, o mapa de áreas abre no
     * centro do Brasil e o cálculo por distância não funciona. Agora basta
     * salvar de novo pra tentar mais uma vez.
     *
     * A intenção original continua valendo: não bate no Nominatim a cada
     * salvamento de campo que não é endereço — só quando falta a coordenada.
     */
    const enderecoNovo = req.body.endereco !== undefined ? textoLimpo(req.body.endereco, 200) : loja.endereco;
    let lat = lojaQualquer.lat ?? null;
    let lon = lojaQualquer.lon ?? null;
    const semCoordenada = lat == null || lon == null;
    if (enderecoNovo && (enderecoNovo !== loja.endereco || semCoordenada)) {
      const coord = await geocodificarTexto(enderecoNovo); // best-effort
      // Só sobrescreve com o resultado se ele veio: falhar a busca não deve
      // APAGAR uma coordenada que já estava certa.
      if (coord) { lat = coord.lat; lon = coord.lon; }
      else if (enderecoNovo !== loja.endereco) { lat = null; lon = null; }
    }

    await db.prepare(
      `UPDATE lojas SET nome = ?, descricao = ?, categoria = ?, endereco = ?, lat = ?, lon = ?,
              taxa_entrega_centavos = ?, tempo_estimado_min = ?, horario_funcionamento = ?,
              logo_url = ?, capa_url = ?, favicon_url = ?, cor_marca = ?, cor_secundaria = ?, slug = ?,
              dominio_personalizado = ?,
              horario_json = ?, auto_horario = ?, minimo_pedido_centavos = ?, aceita_retirada = ?,
              impressora_largura = ?, impressora_auto = ?, cupom_rodape = ?, visual_json = ?
        WHERE id = ?`
    ).run(nome,
          req.body.descricao !== undefined ? textoLimpo(req.body.descricao, 300) : loja.descricao,
          req.body.categoria !== undefined ? (textoLimpo(req.body.categoria, 50) || 'Outros') : loja.categoria,
          enderecoNovo, lat, lon,
          taxa, tempo,
          req.body.horario_funcionamento !== undefined ? textoLimpo(req.body.horario_funcionamento, 100) : loja.horario_funcionamento,
          validarUrl('logo_url', lojaQualquer.logo_url || ''),
          validarUrl('capa_url', lojaQualquer.capa_url || ''),
          validarUrl('favicon_url', lojaQualquer.favicon_url || ''),
          validarCor('cor_marca', lojaQualquer.cor_marca || ''),
          validarCor('cor_secundaria', lojaQualquer.cor_secundaria || ''),
          slug, dominioPersonalizado,
          horarioJson, autoHorario, minimoPedido, aceitaRetirada,
          impLargura, impAuto, cupomRodape, visualJson,
          loja.id);

    // Se acabou de ligar o automático, aplica a agenda na hora.
    if (autoHorario) {
      const deve = lojaAbertaPorAgenda(horarioJson);
      if (deve !== null) await db.prepare('UPDATE lojas SET aberta = ? WHERE id = ?').run(deve ? 1 : 0, loja.id);
    }
    res.json({ loja: await minhaLoja(req) });
  } catch (e) { next(e); }
});

/** Valida o JSON da agenda semanal e devolve uma versão normalizada. */
function validarHorarioJson(bruto: unknown): string {
  let arr: any;
  if (typeof bruto === 'string') {
    try { arr = JSON.parse(bruto); } catch { throw erroHttp(400, 'Agenda de horários inválida.'); }
  } else {
    arr = bruto;
  }
  if (!Array.isArray(arr)) throw erroHttp(400, 'Agenda de horários inválida.');
  const hhmm = /^(\d{1,2}):(\d{2})$/;
  const norm = arr
    .filter(d => d && typeof d.dia === 'number' && d.dia >= 0 && d.dia <= 6)
    .map(d => {
      const aberto = !!d.aberto;
      const abre = typeof d.abre === 'string' && hhmm.test(d.abre) ? d.abre : '00:00';
      const fecha = typeof d.fecha === 'string' && hhmm.test(d.fecha) ? d.fecha : '00:00';
      return { dia: d.dia, aberto, abre, fecha };
    });
  return JSON.stringify(norm);
}

const HEX = /^#[0-9a-fA-F]{6}$/;
function cor(v: unknown, atual: string): string {
  if (typeof v !== 'string') return atual;
  const s = v.trim();
  return s === '' || HEX.test(s) ? s : atual;
}
function num(v: unknown, atual: number, min: number, max: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return atual;
  return Math.min(max, Math.max(min, n));
}
function bool(v: unknown, atual: boolean): boolean {
  return typeof v === 'boolean' ? v : atual;
}
function texto(v: unknown, atual: string, max: number): string {
  return typeof v === 'string' ? v.slice(0, max) : atual;
}
function enumerado<T extends string>(v: unknown, atual: T, opcoes: readonly T[]): T {
  return typeof v === 'string' && (opcoes as readonly string[]).includes(v) ? (v as T) : atual;
}
function regexOuVazio(v: unknown, atual: string, re: RegExp): string {
  if (typeof v !== 'string') return atual;
  const s = v.trim();
  return s === '' || re.test(s) ? s : atual;
}

/**
 * Valida (whitelist estrita, sem passthrough de chaves desconhecidas) e
 * normaliza o blob JSON do editor visual. Sempre re-serializa a partir da
 * estrutura validada — nunca grava o JSON bruto do usuário.
 */
function validarVisualJson(bruto: unknown, atualStr: string): string {
  let novo: any;
  if (typeof bruto === 'string') {
    try { novo = JSON.parse(bruto); } catch { throw erroHttp(400, 'Configuração visual inválida.'); }
  } else {
    novo = bruto;
  }
  if (!novo || typeof novo !== 'object') throw erroHttp(400, 'Configuração visual inválida.');

  let atual: any;
  try { atual = JSON.parse(atualStr || '{}'); } catch { atual = {}; }
  const g = (obj: any, campo: string) => (obj && typeof obj === 'object' ? obj[campo] : undefined) ?? {};

  const geralAtual = g(atual, 'geral'), geralNovo = g(novo, 'geral');
  const coresAtual = g(atual, 'cores'), coresNovo = g(novo, 'cores');
  const logoAtual = g(atual, 'logo'), logoNovo = g(novo, 'logo');
  const capaAtual = g(atual, 'capa'), capaNovo = g(novo, 'capa');
  const cardapioAtual = g(atual, 'cardapio'), cardapioNovo = g(novo, 'cardapio');
  const botoesAtual = g(atual, 'botoes'), botoesNovo = g(novo, 'botoes');
  const tipoAtual = g(atual, 'tipografia'), tipoNovo = g(novo, 'tipografia');
  const bannersAtual = g(atual, 'banners'), bannersNovo = g(novo, 'banners');
  const avAtual = g(atual, 'avancado'), avNovo = g(novo, 'avancado');

  const validado = {
    geral: {
      slogan: texto(geralNovo.slogan, geralAtual.slogan || '', 140),
      mostrar_avaliacao: bool(geralNovo.mostrar_avaliacao, geralAtual.mostrar_avaliacao ?? true),
      mostrar_tempo_medio: bool(geralNovo.mostrar_tempo_medio, geralAtual.mostrar_tempo_medio ?? true),
      mostrar_taxa_entrega: bool(geralNovo.mostrar_taxa_entrega, geralAtual.mostrar_taxa_entrega ?? true),
      mostrar_pedido_minimo: bool(geralNovo.mostrar_pedido_minimo, geralAtual.mostrar_pedido_minimo ?? true),
      mostrar_distancia: bool(geralNovo.mostrar_distancia, geralAtual.mostrar_distancia ?? false),
    },
    cores: {
      cor_botoes: cor(coresNovo.cor_botoes, coresAtual.cor_botoes || ''),
      cor_cards: cor(coresNovo.cor_cards, coresAtual.cor_cards || ''),
      cor_fundo: cor(coresNovo.cor_fundo, coresAtual.cor_fundo || ''),
      cor_cabecalho: cor(coresNovo.cor_cabecalho, coresAtual.cor_cabecalho || ''),
      cor_rodape: cor(coresNovo.cor_rodape, coresAtual.cor_rodape || ''),
      cor_texto: cor(coresNovo.cor_texto, coresAtual.cor_texto || ''),
      cor_badges: cor(coresNovo.cor_badges, coresAtual.cor_badges || ''),
    },
    logo: {
      tamanho: num(logoNovo.tamanho, logoAtual.tamanho ?? 64, 40, 120),
      formato: enumerado(logoNovo.formato, logoAtual.formato ?? 'arredondado', ['quadrado', 'arredondado', 'circular'] as const),
      sombra: bool(logoNovo.sombra, logoAtual.sombra ?? true),
      borda: bool(logoNovo.borda, logoAtual.borda ?? false),
      borda_branca: bool(logoNovo.borda_branca, logoAtual.borda_branca ?? true),
      padding: bool(logoNovo.padding, logoAtual.padding ?? false),
    },
    capa: {
      overlay: bool(capaNovo.overlay, capaAtual.overlay ?? true),
      gradiente: bool(capaNovo.gradiente, capaAtual.gradiente ?? true),
      blur: num(capaNovo.blur, capaAtual.blur ?? 0, 0, 20),
      escurecimento: num(capaNovo.escurecimento, capaAtual.escurecimento ?? 30, 0, 100),
      opacidade: num(capaNovo.opacidade, capaAtual.opacidade ?? 100, 0, 100),
      posicao: enumerado(capaNovo.posicao, capaAtual.posicao ?? 'centro', ['topo', 'centro', 'base'] as const),
      ajuste: enumerado(capaNovo.ajuste, capaAtual.ajuste ?? 'cover', ['cover', 'contain', 'repeat'] as const),
    },
    cardapio: {
      layout: enumerado(cardapioNovo.layout, cardapioAtual.layout ?? 'lista', ['lista', 'grid', 'compacto', 'premium'] as const),
      mostrar_foto: bool(cardapioNovo.mostrar_foto, cardapioAtual.mostrar_foto ?? true),
      mostrar_descricao: bool(cardapioNovo.mostrar_descricao, cardapioAtual.mostrar_descricao ?? true),
      mostrar_categoria: bool(cardapioNovo.mostrar_categoria, cardapioAtual.mostrar_categoria ?? true),
      mostrar_avaliacao: bool(cardapioNovo.mostrar_avaliacao, cardapioAtual.mostrar_avaliacao ?? false),
      mostrar_tempo: bool(cardapioNovo.mostrar_tempo, cardapioAtual.mostrar_tempo ?? false),
      preco_destacado: bool(cardapioNovo.preco_destacado, cardapioAtual.preco_destacado ?? true),
      badge_promocao: bool(cardapioNovo.badge_promocao, cardapioAtual.badge_promocao ?? true),
      botao_comprar: bool(cardapioNovo.botao_comprar, cardapioAtual.botao_comprar ?? true),
      espacamento: num(cardapioNovo.espacamento, cardapioAtual.espacamento ?? 12, 4, 24),
      raio_bordas: num(cardapioNovo.raio_bordas, cardapioAtual.raio_bordas ?? 16, 0, 32),
      altura_cards: num(cardapioNovo.altura_cards, cardapioAtual.altura_cards ?? 180, 140, 320),
      /**
       * Campos novos do editor de cardápio. Esta função é uma WHITELIST: campo
       * que não está aqui é descartado no salvamento, então o lojista mexeria no
       * editor, veria o preview mudar e ao recarregar estaria tudo como antes —
       * falha muda, sem erro em lugar nenhum.
       *
       * O `?? <padrão>` mantém compatibilidade com as lojas que já têm
       * visual_json salvo sem estes campos: elas leem o padrão, que é exatamente
       * o comportamento que estava fixo no código antes de virar opção. Nenhuma
       * loja no ar muda de aparência por causa deste deploy.
       */
      formato_foto: enumerado(cardapioNovo.formato_foto, cardapioAtual.formato_foto ?? 'quadrada', ['quadrada', 'retrato', 'paisagem'] as const),
      estilo_botao: enumerado(cardapioNovo.estilo_botao, cardapioAtual.estilo_botao ?? 'icone', ['icone', 'texto'] as const),
      sombra: enumerado(cardapioNovo.sombra, cardapioAtual.sombra ?? 'suave', ['nenhuma', 'suave', 'forte'] as const),
      // Numéricos de conjunto fechado: num() com faixa 1..2 basta e recusa
      // qualquer outra coisa (o front só manda 1 ou 2).
      colunas_mobile: num(cardapioNovo.colunas_mobile, cardapioAtual.colunas_mobile ?? 2, 1, 2),
      linhas_nome: num(cardapioNovo.linhas_nome, cardapioAtual.linhas_nome ?? 2, 1, 2),
    },
    botoes: {
      hover: bool(botoesNovo.hover, botoesAtual.hover ?? true),
      sombra: bool(botoesNovo.sombra, botoesAtual.sombra ?? true),
      gradiente: bool(botoesNovo.gradiente, botoesAtual.gradiente ?? false),
      icone: bool(botoesNovo.icone, botoesAtual.icone ?? false),
      borda: bool(botoesNovo.borda, botoesAtual.borda ?? false),
      raio: num(botoesNovo.raio, botoesAtual.raio ?? 999, 0, 32),
      tamanho: enumerado(botoesNovo.tamanho, botoesAtual.tamanho ?? 'md', ['sm', 'md', 'lg'] as const),
      animacao: enumerado(botoesNovo.animacao, botoesAtual.animacao ?? 'nenhuma', ['nenhuma', 'scale', 'ripple', 'glow', 'fade'] as const),
    },
    tipografia: {
      fonte: enumerado(tipoNovo.fonte, tipoAtual.fonte ?? 'inter', ['inter', 'poppins', 'roboto', 'montserrat', 'nunito'] as const),
      peso: ([400, 500, 600, 700, 800] as const).includes(tipoNovo.peso) ? tipoNovo.peso : (tipoAtual.peso ?? 600),
      espacamento: num(tipoNovo.espacamento, tipoAtual.espacamento ?? 0, -2, 4),
      tamanho_base: num(tipoNovo.tamanho_base, tipoAtual.tamanho_base ?? 15, 14, 18),
      altura_linha: num(tipoNovo.altura_linha, tipoAtual.altura_linha ?? 1.5, 1.2, 1.8),
    },
    banners: {
      botao_texto: texto(bannersNovo.botao_texto, bannersAtual.botao_texto || '', 40),
      tempo_rotacao_ms: num(bannersNovo.tempo_rotacao_ms, bannersAtual.tempo_rotacao_ms ?? 5000, 2000, 10000),
      loop: bool(bannersNovo.loop, bannersAtual.loop ?? true),
      mostrar_indicadores: bool(bannersNovo.mostrar_indicadores, bannersAtual.mostrar_indicadores ?? true),
      mostrar_setas: bool(bannersNovo.mostrar_setas, bannersAtual.mostrar_setas ?? true),
    },
    avancado: {
      meta_description: texto(avNovo.meta_description, avAtual.meta_description || '', 300),
      meta_keywords: texto(avNovo.meta_keywords, avAtual.meta_keywords || '', 200),
      og_image: validarUrlSolta(avNovo.og_image, avAtual.og_image || ''),
      ga_measurement_id: regexOuVazio(avNovo.ga_measurement_id, avAtual.ga_measurement_id || '', /^G-[A-Z0-9]{6,}$/i),
      gtm_container_id: regexOuVazio(avNovo.gtm_container_id, avAtual.gtm_container_id || '', /^GTM-[A-Z0-9]{4,}$/i),
      fb_pixel_id: regexOuVazio(avNovo.fb_pixel_id, avAtual.fb_pixel_id || '', /^\d{5,20}$/),
      tiktok_pixel_id: regexOuVazio(avNovo.tiktok_pixel_id, avAtual.tiktok_pixel_id || '', /^[A-Z0-9]{10,30}$/i),
      clarity_project_id: regexOuVazio(avNovo.clarity_project_id, avAtual.clarity_project_id || '', /^[a-z0-9]{6,20}$/i),
    },
  };
  return JSON.stringify(validado);
}

/** URL https:// ou /uploads/... solta (fora do padrão UPDATE de /loja), ou vazia. */
function validarUrlSolta(v: unknown, atual: string): string {
  if (typeof v !== 'string') return atual;
  const s = v.trim().slice(0, 500);
  if (s === '' || /^https?:\/\//i.test(s) || s.startsWith('/uploads/')) return s;
  return atual;
}

router.post('/loja/abrir-fechar', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    if (loja.status_aprovacao !== 'aprovada') {
      throw erroHttp(409, 'Sua loja ainda não foi aprovada pelo admin, então não pode abrir.');
    }
    const lojaQualquer = loja as any;
    const novo = loja.aberta ? 0 : 1;

    // No modo automático, fechar manualmente = pausa temporária até a próxima
    // abertura agendada; abrir manualmente = cancela a pausa.
    if (lojaQualquer.auto_horario) {
      if (novo === 0) {
        // Pausa por 2h (ou até o fim do expediente, o tick reavalia).
        const ate = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
        await db.prepare('UPDATE lojas SET aberta = 0, pausado_ate = ? WHERE id = ?').run(ate, loja.id);
      } else {
        await db.prepare("UPDATE lojas SET aberta = 1, pausado_ate = '' WHERE id = ?").run(loja.id);
      }
    } else {
      await db.prepare('UPDATE lojas SET aberta = ? WHERE id = ?').run(novo, loja.id);
    }
    res.json({ aberta: !!novo });
  } catch (e) { next(e); }
});

// ----- Zonas de entrega (taxa por bairro) ----------------------------------

router.get('/zonas', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    const zonas = await db.prepare(
      'SELECT id, bairro, taxa_centavos FROM zonas_entrega WHERE loja_id = ? AND poligono_json IS NULL ORDER BY bairro'
    ).all(loja.id);
    res.json({ zonas });
  } catch (e) { next(e); }
});

router.post('/zonas', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    const bairro = textoLimpo(req.body.bairro, 80);
    if (bairro.length < 2) throw erroHttp(400, 'Informe o nome do bairro.');
    const taxa = reaisParaCentavos(req.body.taxa);
    if (taxa === null || taxa < 0) throw erroHttp(400, 'Informe uma taxa válida (use 0 para grátis).');
    // Evita bairro duplicado na mesma loja (comparação tolerante — "Jd. Sofia"
    // e "Jardim Sofia" contam como o mesmo bairro).
    const existentes = await db.prepare('SELECT bairro FROM zonas_entrega WHERE loja_id = ?').all(loja.id) as { bairro: string }[];
    const bairroNorm = normalizarBairro(bairro);
    if (existentes.some(z => normalizarBairro(z.bairro) === bairroNorm)) {
      throw erroHttp(409, 'Esse bairro já tem uma taxa cadastrada.');
    }
    const info = await db.prepare(
      'INSERT INTO zonas_entrega (loja_id, bairro, taxa_centavos, tempo_min, criado_em) VALUES (?, ?, ?, ?, ?)'
    ).run(loja.id, bairro, taxa, inteiroPositivo(req.body.tempo_min) || 0, agoraUTC());
    res.status(201).json({ zona_id: Number(info.lastInsertRowid) });
  } catch (e) { next(e); }
});

router.put('/zonas/:id', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    const zona = await db.prepare('SELECT * FROM zonas_entrega WHERE id = ? AND loja_id = ?')
      .get(req.params.id, loja.id) as { id: number; bairro: string; taxa_centavos: number } | undefined;
    if (!zona) throw erroHttp(404, 'Zona não encontrada.');
    const bairro = req.body.bairro !== undefined ? textoLimpo(req.body.bairro, 80) : zona.bairro;
    if (bairro.length < 2) throw erroHttp(400, 'Nome do bairro inválido.');
    const taxa = req.body.taxa !== undefined ? reaisParaCentavos(req.body.taxa) : zona.taxa_centavos;
    if (taxa === null || taxa < 0) throw erroHttp(400, 'Taxa inválida.');
    if (req.body.bairro !== undefined) {
      const outras = await db.prepare('SELECT bairro FROM zonas_entrega WHERE loja_id = ? AND id != ?').all(loja.id, zona.id) as { bairro: string }[];
      const bairroNorm = normalizarBairro(bairro);
      if (outras.some(z => normalizarBairro(z.bairro) === bairroNorm)) {
        throw erroHttp(409, 'Esse bairro já tem uma taxa cadastrada.');
      }
    }
    await db.prepare('UPDATE zonas_entrega SET bairro = ?, taxa_centavos = ? WHERE id = ?')
      .run(bairro, taxa, zona.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.delete('/zonas/:id', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    const r = await db.prepare('DELETE FROM zonas_entrega WHERE id = ? AND loja_id = ?')
      .run(req.params.id, loja.id);
    if (r.changes === 0) throw erroHttp(404, 'Zona não encontrada.');
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ----- Áreas de entrega (regiões desenhadas no mapa) -----------------------
//
// Vivem na MESMA tabela das zonas por bairro (`zonas_entrega`), distinguidas por
// `poligono_json` estar preenchido. Rotas separadas de propósito: as de bairro já
// estavam em produção e não valia arriscá-las.
//
// ⚠️ Desenhar a primeira área LIGA o bloqueio: endereço fora de todas as áreas
// passa a ser recusado no checkout (ver frete.ts). É assim que o lojista diz
// "atendo só aqui" — e é opt-in, então loja sem área desenhada não muda de
// comportamento.

/**
 * Busca de lugar por nome (Brasil), pro editor de áreas: o lojista digita
 * "Centro, Blumenau" e o mapa vai pra lá — em vez de arrastar procurando.
 *
 * Quando o OpenStreetMap tem o contorno do bairro, ele volta junto e o editor
 * oferece usá-lo como área pronta (o desenho manual continua disponível).
 */
router.get('/buscar-local', async (req, res, next) => {
  try {
    await minhaLoja(req); // só lojista autenticado — evita virar proxy aberto de geocodificação
    const q = textoLimpo(req.query.q, 120);
    if (q.length < 3) return res.json({ locais: [] });
    res.json({ locais: await buscarLocais(q) });
  } catch (e) { next(e); }
});

/**
 * SIMULA um endereço: atende? por quanto? e por qual regra?
 *
 * É a pergunta prática número um de quem configura entrega — "o cliente da rua
 * tal consegue pedir?" — e até aqui só dava pra responder fazendo um pedido de
 * mentira pelo cardápio. Pior: quando alguém reclamava que não conseguia pedir,
 * o lojista não tinha como reproduzir.
 *
 * Usa `resolverFrete`, o MESMO código do checkout. Simulação que roda por um
 * caminho paralelo mente exatamente quando mais importa — a resposta aqui é a
 * que o cliente vai receber, ou não vale nada.
 */
/**
 * Distância até um bairro + sugestão de taxa.
 *
 * O VALOR AQUI É A DISTÂNCIA: é o número que ninguém tem de cabeça ao cadastrar
 * um bairro, e é o que separa 'chuto R$ 8' de 'são 5,2 km'. O preço vem junto
 * como ponto de partida editável — quem cobra é o lojista, que sabe do
 * combustível e do que o concorrente pratica.
 */
router.post('/frete/sugerir', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    const bairro = textoLimpo(req.body.bairro, 80);
    if (bairro.length < 2) throw erroHttp(400, 'Informe o bairro.');
    if (loja.lat == null || loja.lon == null) {
      // Sem a loja no mapa não há de onde medir. Dizer isso é melhor que
      // devolver uma distância inventada a partir de um ponto qualquer.
      return res.json({ ok: false, motivo: 'sem_loja' });
    }

    // Junta cidade/UF da loja: 'Centro' sozinho existe em toda cidade do país.
    const cid = (loja as unknown as { nfce_municipio?: string; nfce_uf?: string });
    const alvo = await geocodificarTexto(`${bairro}, ${cid.nfce_municipio || ''} ${cid.nfce_uf || ''}`.trim())
      ?? await geocodificarTexto(bairro);
    if (!alvo) return res.json({ ok: false, motivo: 'nao_localizado' });

    const km = distanciaKm([loja.lat as number, loja.lon as number], [alvo.lat, alvo.lon]);
    res.json({
      ok: true,
      km: Math.round(km * 10) / 10,
      sugestao_centavos: sugerirFreteCentavos(km),
      explicacao: explicarSugestao(km),
    });
  } catch (e) { next(e); }
});

router.post('/frete/testar', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    const texto = textoLimpo(req.body.endereco, 200);
    if (texto.length < 5) throw erroHttp(400, 'Escreva um endereço com rua, número e bairro.');

    const coord = await geocodificarTexto(texto);
    const bairro = textoLimpo(req.body.bairro, 80) || extrairBairro(texto);

    const frete = await resolverFrete(
      loja.id,
      { bairro, lat: coord?.lat, lon: coord?.lon },
      loja.taxa_entrega_centavos,
    );

    res.json({
      atende: !!frete,
      taxa_centavos: frete?.taxaCentavos ?? null,
      fonte: frete?.fonte ?? null,
      zona: frete?.zona ?? '',
      // Sem coordenada, a decisão por ÁREA nem chega a ser avaliada — e o
      // lojista precisa saber que o teste foi parcial, não que "está tudo certo".
      localizado: !!coord,
      bairro_usado: bairro,
    });
  } catch (e) { next(e); }
});

/** Último trecho depois da vírgula costuma ser o bairro no texto que o lojista digita. */
function extrairBairro(texto: string): string {
  const partes = texto.split(',').map(p => p.trim()).filter(Boolean);
  return partes.length >= 2 ? partes[partes.length - 1] : '';
}

router.get('/areas', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    const linhas = await db.prepare(
      `SELECT id, nome, taxa_centavos, poligono_json FROM zonas_entrega
        WHERE loja_id = ? AND poligono_json IS NOT NULL ORDER BY id`
    ).all(loja.id) as Array<{ id: number; nome: string | null; taxa_centavos: number; poligono_json: string }>;
    res.json({
      areas: linhas.map(l => {
        let poligono: unknown = [];
        try { poligono = JSON.parse(l.poligono_json); } catch { poligono = []; }
        return { id: l.id, nome: l.nome || '', taxa_centavos: l.taxa_centavos, poligono };
      }),
      // A loja tem coordenada? O editor centra o mapa nela; sem isso, o lojista
      // abre o mapa no meio do oceano e não entende o que fazer.
      loja_lat: (loja as any).lat ?? null,
      loja_lon: (loja as any).lon ?? null,
    });
  } catch (e) { next(e); }
});

router.post('/areas', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    const nome = textoLimpo(req.body.nome, 80) || 'Área de entrega';
    const taxa = reaisParaCentavos(req.body.taxa);
    if (taxa === null || taxa < 0) throw erroHttp(400, 'Informe uma taxa válida (use 0 para grátis).');
    const poligono = poligonoValido(req.body.poligono);
    if (!poligono) throw erroHttp(400, 'Desenhe a área no mapa com pelo menos 3 pontos.');
    const info = await db.prepare(
      `INSERT INTO zonas_entrega (loja_id, bairro, taxa_centavos, tempo_min, nome, poligono_json, criado_em)
       VALUES (?, '', ?, ?, ?, ?, ?)`
       // tempo_min 0 = a área não define e vale o tempo padrão da loja.
    ).run(loja.id, taxa, inteiroPositivo(req.body.tempo_min) || 0, nome, JSON.stringify(poligono), agoraUTC());
    res.status(201).json({ area_id: Number(info.lastInsertRowid) });
  } catch (e) { next(e); }
});

router.put('/areas/:id', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    const atual = await db.prepare(
      'SELECT id, nome, taxa_centavos, poligono_json FROM zonas_entrega WHERE id = ? AND loja_id = ? AND poligono_json IS NOT NULL'
    ).get(req.params.id, loja.id) as { id: number; nome: string | null; taxa_centavos: number; poligono_json: string } | undefined;
    if (!atual) throw erroHttp(404, 'Área não encontrada.');

    const nome = req.body.nome !== undefined ? (textoLimpo(req.body.nome, 80) || 'Área de entrega') : (atual.nome || '');
    const taxa = req.body.taxa !== undefined ? reaisParaCentavos(req.body.taxa) : atual.taxa_centavos;
    if (taxa === null || taxa < 0) throw erroHttp(400, 'Taxa inválida.');
    let poligonoJson = atual.poligono_json;
    if (req.body.poligono !== undefined) {
      const p = poligonoValido(req.body.poligono);
      if (!p) throw erroHttp(400, 'Área inválida (mínimo 3 pontos).');
      poligonoJson = JSON.stringify(p);
    }
    await db.prepare('UPDATE zonas_entrega SET nome = ?, taxa_centavos = ?, poligono_json = ? WHERE id = ?')
      .run(nome, taxa, poligonoJson, atual.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.delete('/areas/:id', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    const r = await db.prepare(
      'DELETE FROM zonas_entrega WHERE id = ? AND loja_id = ? AND poligono_json IS NOT NULL'
    ).run(req.params.id, loja.id);
    if (r.changes === 0) throw erroHttp(404, 'Área não encontrada.');
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ----- Avaliações ----------------------------------------------------------

router.get('/avaliacoes', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    const avaliacoes = await db.prepare(
      `SELECT a.id, a.pedido_id, a.nota, a.comentario, a.resposta, a.criado_em,
              u.nome AS cliente_nome
         FROM avaliacoes a
         JOIN usuarios u ON u.id = a.cliente_id
        WHERE a.loja_id = ?
        ORDER BY a.id DESC LIMIT 200`
    ).all(loja.id);
    const lojaAtual = loja as any;
    res.json({
      avaliacoes,
      media: lojaAtual.nota_media || 0,
      qtd: lojaAtual.nota_qtd || 0,
    });
  } catch (e) { next(e); }
});

router.post('/avaliacoes/:id/responder', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    const av = await db.prepare('SELECT * FROM avaliacoes WHERE id = ? AND loja_id = ?')
      .get(req.params.id, loja.id) as { id: number } | undefined;
    if (!av) throw erroHttp(404, 'Avaliação não encontrada.');
    const resposta = textoLimpo(req.body.resposta, 500);
    await db.prepare('UPDATE avaliacoes SET resposta = ? WHERE id = ?').run(resposta, av.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ----- Clientes da loja ----------------------------------------------------

/**
 * "Cliente da loja" = cadastrado com essa loja (fluxo white-label) OU já fez
 * pelo menos um pedido nela — cobre quem se cadastrou em outra tela/contexto
 * mas comprou aqui, sem depender só do loja_id gravado no cadastro.
 */
router.get('/clientes', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    const clientes = await db.prepare(
      `SELECT DISTINCT u.id, u.nome, u.email, u.telefone, u.criado_em
         FROM usuarios u
         LEFT JOIN pedidos p ON p.cliente_id = u.id AND p.loja_id = ?
        WHERE u.perfil = 'cliente' AND (u.loja_id = ? OR p.id IS NOT NULL)
        ORDER BY u.criado_em DESC`
    ).all(loja.id, loja.id);
    res.json({ clientes, total: clientes.length });
  } catch (e) { next(e); }
});

// ----- Produtos (CRUD com exclusão lógica + grupos de opções) --------------

router.get('/produtos', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    type ProdutoFull = Produto & { grupos: Array<GrupoOpcao & { opcoes: OpcaoItem[] }> };
    const produtos = await db.prepare(
      'SELECT * FROM produtos WHERE loja_id = ? AND excluido = 0 ORDER BY categoria, destaque DESC, nome'
    ).all(loja.id) as ProdutoFull[];

    for (const p of produtos) {
      const grupos = await db.prepare('SELECT * FROM grupos_opcoes WHERE produto_id = ? ORDER BY ordem, id').all(p.id) as GrupoOpcao[];
      const comOpcoes = [];
      for (const g of grupos) {
        const opcoes = await db.prepare('SELECT * FROM opcoes_itens WHERE grupo_id = ? ORDER BY ordem, id').all(g.id) as OpcaoItem[];
        comOpcoes.push({ ...g, opcoes });
      }
      p.grupos = comOpcoes;
    }
    res.json({ produtos });
  } catch (e) { next(e); }
});

interface CamposProduto {
  nome: string; preco: number; promo: number | null;
  /** 'YYYY-MM-DD' — último dia da promoção. Vazio = sem prazo. */
  promoFim: string;
  servePessoas: number | null; descricao: string; categoria: string; subcategoria: string;
  foto_url: string; destaque: 0 | 1; disponivel: 0 | 1; disponivelPdv: 0 | 1;
  vendidoPor: 'un' | 'kg'; codigoBarras: string;
  controlaEstoque: 0 | 1; estoque: number;
}

function camposProduto(req: Request, atual: Partial<Produto> = {}): CamposProduto {
  const corpo = req.body;
  const valor = (campo: string, padrao: unknown): unknown =>
    corpo[campo] !== undefined ? corpo[campo] : padrao;

  const nome = textoLimpo(valor('nome', atual.nome), 100);
  const preco = corpo.preco !== undefined ? reaisParaCentavos(corpo.preco) : atual.preco_centavos;
  if (nome.length < 2) throw erroHttp(400, 'Informe o nome do produto.');
  if (!preco || preco <= 0) throw erroHttp(400, 'Informe um preço válido (maior que zero).');

  let promo: number | null = atual.preco_promocional_centavos ?? null;
  if (corpo.preco_promocional !== undefined) {
    promo = corpo.preco_promocional ? reaisParaCentavos(corpo.preco_promocional) : null;
    if (promo !== null && (promo <= 0 || promo >= preco)) {
      throw erroHttp(400, 'O preço promocional deve ser maior que zero e menor que o preço normal.');
    }
  }

  /*
   * PRAZO DA PROMOÇÃO ('YYYY-MM-DD', vazio = sem prazo).
   *
   * Recusa data no passado: gravar promoção que já venceu no instante em que se
   * salva não é intenção plausível, é dedo errado no calendário — e o efeito
   * seria o produto voltar ao preço cheio em silêncio, o oposto do que a pessoa
   * achou que fez.
   *
   * Sem promoção, o prazo é zerado junto. Prazo órfão ficaria guardado e
   * reapareceria na próxima promoção que alguém criasse, com uma data antiga
   * que ninguém escolheu.
   */
  let promoFim = String((atual as { promo_fim?: string }).promo_fim ?? '');
  if (corpo.promo_fim !== undefined) {
    const bruto = textoLimpo(corpo.promo_fim, 10);
    if (bruto && !/^\d{4}-\d{2}-\d{2}$/.test(bruto)) {
      throw erroHttp(400, 'Data da promoção inválida.');
    }
    if (bruto && bruto < dataBrasilia()) {
      throw erroHttp(400, 'A promoção não pode terminar numa data que já passou.');
    }
    promoFim = bruto;
  }
  if (promo === null) promoFim = '';

  let servePessoas: number | null = atual.serve_pessoas ?? null;
  if (corpo.serve_pessoas !== undefined) {
    servePessoas = corpo.serve_pessoas ? inteiroPositivo(corpo.serve_pessoas) : null;
  }

  const vendidoPorRaw = textoLimpo(valor('vendido_por', (atual as any).vendido_por || 'un'), 4);
  const vendidoPor: 'un' | 'kg' = vendidoPorRaw === 'kg' ? 'kg' : 'un';
  // Código de barras: só dígitos (EAN/PLU). Vazio = sem código.
  const codigoBarras = textoLimpo(valor('codigo_barras', (atual as any).codigo_barras || ''), 20).replace(/\D/g, '');

  const canais = resolverCanais(corpo, atual as Record<string, unknown>);

  const controlaEstoque: 0 | 1 = corpo.controla_estoque !== undefined
    ? (corpo.controla_estoque ? 1 : 0)
    : (((atual as any).controla_estoque ?? 0) as 0 | 1);
  // Aceita 0 (esgotado) — inteiroPositivo rejeitaria; por isso o parse manual.
  let estoque: number = (atual as any).estoque ?? 0;
  if (corpo.estoque !== undefined) {
    const n = Math.trunc(Number(corpo.estoque));
    estoque = Number.isFinite(n) && n > 0 ? n : 0;
  }

  return {
    nome, preco, promo, promoFim, servePessoas,
    descricao: textoLimpo(valor('descricao', atual.descricao || ''), 300),
    categoria: textoLimpo(valor('categoria', atual.categoria), 50) || 'Geral',
    subcategoria: textoLimpo(valor('subcategoria', (atual as any).subcategoria || ''), 80),
    foto_url: textoLimpo(valor('foto_url', atual.foto_url || ''), 500),
    destaque: corpo.destaque !== undefined ? (corpo.destaque ? 1 : 0) : ((atual.destaque || 0) as 0 | 1),
    // Cardápio e PDV são canais separados; a regra de herança está em
    // disponibilidade-produto.ts, com testes.
    disponivel: canais.cardapio,
    disponivelPdv: canais.pdv,
    vendidoPor, codigoBarras, controlaEstoque, estoque,
  };
}

router.post('/produtos', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    const c = camposProduto(req);
    const info = await db.prepare(
      `INSERT INTO produtos (loja_id, nome, descricao, categoria, subcategoria, preco_centavos,
                             preco_promocional_centavos, promo_fim, serve_pessoas, destaque,
                             foto_url, disponivel, disponivel_pdv, vendido_por, codigo_barras,
                             controla_estoque, estoque, criado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(loja.id, c.nome, c.descricao, c.categoria, c.subcategoria, c.preco, c.promo, c.promoFim,
          c.servePessoas, c.destaque, c.foto_url, c.disponivel, c.disponivelPdv, c.vendidoPor, c.codigoBarras,
          c.controlaEstoque, c.estoque, agoraUTC());
    res.status(201).json({ produto_id: Number(info.lastInsertRowid) });
  } catch (e) { next(e); }
});

router.put('/produtos/:id', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    const produto = await meuProduto(loja, req.params.id);
    const c = camposProduto(req, produto);
    await db.prepare(
      `UPDATE produtos SET nome = ?, descricao = ?, categoria = ?, subcategoria = ?, preco_centavos = ?,
              preco_promocional_centavos = ?, promo_fim = ?, serve_pessoas = ?, destaque = ?,
              foto_url = ?, disponivel = ?, disponivel_pdv = ?, vendido_por = ?, codigo_barras = ?,
              controla_estoque = ?, estoque = ? WHERE id = ?`
    ).run(c.nome, c.descricao, c.categoria, c.subcategoria, c.preco, c.promo, c.promoFim, c.servePessoas,
          c.destaque, c.foto_url, c.disponivel, c.disponivelPdv, c.vendidoPor, c.codigoBarras,
          c.controlaEstoque, c.estoque, produto.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.delete('/produtos/:id', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    const info = await db.prepare(
      // Excluído sai dos DOIS canais — senão o item continuaria vendável no PDV.
      'UPDATE produtos SET excluido = 1, disponivel = 0, disponivel_pdv = 0 WHERE id = ? AND loja_id = ? AND excluido = 0'
    ).run(req.params.id, loja.id);
    if (info.changes === 0) throw erroHttp(404, 'Produto não encontrado.');
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/**
 * POST /produtos/:id/duplicar — clona um produto (todos os campos + grupos
 * de opções + itens) como um novo produto "(cópia)". Útil pra variações
 * rápidas (ex.: mesmo lanche em tamanho diferente) sem redigitar tudo.
 * O clone nasce indisponível — o lojista revisa/ajusta antes de publicar.
 */
router.post('/produtos/:id/duplicar', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    const original = await meuProduto(loja, req.params.id) as any;

    const produto_id = await comTransacao(async (tx) => {
      const info = await tx.prepare(
        `INSERT INTO produtos (loja_id, nome, descricao, categoria, subcategoria, preco_centavos,
                               preco_promocional_centavos, serve_pessoas, destaque,
                               foto_url, disponivel, disponivel_pdv, vendido_por, codigo_barras,
                               controla_estoque, estoque, ncm, cfop, csosn, origem,
                               unidade_comercial, cest, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        loja.id, `${original.nome} (cópia)`, original.descricao, original.categoria, original.subcategoria,
        original.preco_centavos, original.preco_promocional_centavos, original.serve_pessoas, original.destaque,
        original.foto_url, original.vendido_por, original.codigo_barras,
        original.controla_estoque, original.estoque,
        original.ncm, original.cfop, original.csosn, original.origem, original.unidade_comercial, original.cest,
        agoraUTC(),
      );
      const novoId = Number(info.lastInsertRowid);

      const grupos = await tx.prepare('SELECT * FROM grupos_opcoes WHERE produto_id = ? ORDER BY ordem, id').all(original.id) as any[];
      for (const g of grupos) {
        const gInfo = await tx.prepare(
          `INSERT INTO grupos_opcoes (produto_id, nome, tipo, obrigatorio, max_escolhas, ordem)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).run(novoId, g.nome, g.tipo, g.obrigatorio, g.max_escolhas, g.ordem);
        const novoGrupoId = Number(gInfo.lastInsertRowid);
        const opcoes = await tx.prepare('SELECT * FROM opcoes_itens WHERE grupo_id = ? ORDER BY ordem, id').all(g.id) as any[];
        for (const o of opcoes) {
          await tx.prepare(
            // `sabores` e `secao` entram aqui: sem eles, duplicar uma pizza
            // perdia quantos sabores cada tamanho libera e a faixa de cada
            // sabor — a cópia parecia igual na lista e vinha quebrada por dentro.
            `INSERT INTO opcoes_itens (grupo_id, nome, preco_adicional_centavos, disponivel, ordem, sabores, secao, descricao)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(novoGrupoId, o.nome, o.preco_adicional_centavos, o.disponivel, o.ordem,
                o.sabores || 0, o.secao || '', o.descricao || '', o.imagem || '');
        }
      }
      return novoId;
    });

    res.status(201).json({ produto_id });
  } catch (e) { next(e); }
});

/**
 * POST /produtos/bulk — ativa/desativa/exclui vários produtos de uma vez.
 * Sempre restrito à loja do lojista autenticado (o IN (...) filtra por
 * loja_id, então IDs de outra loja são simplesmente ignorados).
 */
router.post('/produtos/bulk', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number).filter((n: number) => Number.isInteger(n) && n > 0) : [];
    const acao = String(req.body.acao || '');
    if (ids.length === 0) throw erroHttp(400, 'Selecione ao menos um produto.');
    if (!['ativar', 'desativar', 'excluir'].includes(acao)) throw erroHttp(400, 'Ação inválida.');

    const placeholders = ids.map(() => '?').join(',');
    let info;
    /*
     * Em massa vale pros DOIS canais, de propósito.
     *
     * Quem seleciona vinte itens e clica "desativar" quer eles fora do ar, não
     * fora só do cardápio continuando vendáveis no balcão. A separação entre
     * cardápio e PDV é uma decisão item a item — e se faz no editor do produto.
     */
    if (acao === 'ativar') {
      info = await db.prepare(`UPDATE produtos SET disponivel = 1, disponivel_pdv = 1 WHERE loja_id = ? AND excluido = 0 AND id IN (${placeholders})`)
        .run(loja.id, ...ids);
    } else if (acao === 'desativar') {
      info = await db.prepare(`UPDATE produtos SET disponivel = 0, disponivel_pdv = 0 WHERE loja_id = ? AND excluido = 0 AND id IN (${placeholders})`)
        .run(loja.id, ...ids);
    } else {
      info = await db.prepare(`UPDATE produtos SET excluido = 1, disponivel = 0, disponivel_pdv = 0 WHERE loja_id = ? AND excluido = 0 AND id IN (${placeholders})`)
        .run(loja.id, ...ids);
    }
    res.json({ ok: true, afetados: info.changes });
  } catch (e) { next(e); }
});

// ----- Grupos e opções -----------------------------------------------------

async function meuGrupo(loja: Loja, grupoId: number | string): Promise<GrupoOpcao> {
  const grupo = await db.prepare(
    `SELECT g.* FROM grupos_opcoes g
       JOIN produtos p ON p.id = g.produto_id
      WHERE g.id = ? AND p.loja_id = ?`
  ).get(grupoId, loja.id) as GrupoOpcao | undefined;
  if (!grupo) throw erroHttp(404, 'Grupo de opções não encontrado.');
  return grupo;
}

async function minhaOpcao(loja: Loja, opcaoId: number | string): Promise<OpcaoItem> {
  const opcao = await db.prepare(
    `SELECT o.* FROM opcoes_itens o
       JOIN grupos_opcoes g ON g.id = o.grupo_id
       JOIN produtos p ON p.id = g.produto_id
      WHERE o.id = ? AND p.loja_id = ?`
  ).get(opcaoId, loja.id) as OpcaoItem | undefined;
  if (!opcao) throw erroHttp(404, 'Opção não encontrada.');
  return opcao;
}

/**
 * GET /opcoes/sugestoes — os nomes de opção que ESTA LOJA já usa, por grupo.
 *
 * POR QUE EXISTE. Os chips de sugestão ("Bacon, Queijo extra, Ovo…") eram uma
 * constante no código do front. O "Molho especial" que o lojista criava ficava
 * salvo naquele grupo, daquele produto, e nunca voltava — no produto seguinte
 * ele digitava de novo. Numa pizzaria com dezenas de itens, o sistema estava
 * criando trabalho manual.
 *
 * E RESOLVE MELHOR QUE ADIVINHAR PELA CATEGORIA. A tentativa óbvia seria
 * deduzir a família do produto pelo nome — mas "Pizza Gigante +1 Refrigerante
 * 2LT" casa com bebida antes de pizza, e o sistema esconderia justamente Borda
 * e Sabores. Aprender do histórico não precisa interpretar nome nenhum: a
 * pizzaria tem Catupiry no histórico dela, a hamburgueria tem Bacon.
 *
 * Agrupado por NOME do grupo e não por id: o lojista tem um grupo "Adicionais"
 * por produto, e o que interessa é o conjunto de nomes que ele usa em todos.
 *
 * `p.excluido = 0` porque produto na lixeira não deve ditar sugestão. O teto de
 * 400 linhas é pra resposta não crescer sem limite numa loja grande — o corte
 * por grupo acontece no front, que é quem sabe quantos chips cabem na tela.
 */
router.get('/opcoes/sugestoes', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    /*
     * DEVOLVE A CONFIGURAÇÃO, NÃO SÓ O NOME.
     *
     * Antes vinha só o nome, então clicar no chip recriava o sabor com preço 0,
     * sem seção e sem descrição — o lojista tinha que redigitar acréscimo,
     * faixa e ingredientes de cada um. "Salvo pra não fazer de novo" só vale se
     * vier tudo.
     *
     * MAX() e não qualquer valor: se o mesmo sabor foi cadastrado com preços
     * diferentes em produtos diferentes (acontece — pizza grande cobra mais que
     * a broto), pegar o maior é o palpite seguro. Cadastrar barato demais por
     * sugestão é prejuízo silencioso; caro demais o lojista vê e corrige.
     */
    const linhas = await db.prepare(
      `SELECT g.nome AS grupo, o.nome AS opcao, COUNT(*) AS usos,
              MAX(o.preco_adicional_centavos) AS preco,
              MAX(o.secao) AS secao, MAX(o.descricao) AS descricao, MAX(o.imagem) AS imagem
         FROM opcoes_itens o
         JOIN grupos_opcoes g ON g.id = o.grupo_id
         JOIN produtos p ON p.id = g.produto_id
        WHERE p.loja_id = ? AND p.excluido = 0
        GROUP BY g.nome, o.nome
        ORDER BY usos DESC, o.nome ASC
        LIMIT 400`
    ).all(loja.id) as Array<{
      grupo: string; opcao: string; usos: number;
      preco: number | null; secao: string | null; descricao: string | null; imagem: string | null;
    }>;

    const sugestoes: Record<string, Array<{
      nome: string; preco_adicional_centavos: number; secao: string; descricao: string; imagem: string;
    }>> = {};
    for (const l of linhas) {
      const grupo = String(l.grupo || '').trim();
      const nome = String(l.opcao || '').trim();
      if (!grupo || !nome) continue;
      (sugestoes[grupo] ||= []).push({
        nome,
        preco_adicional_centavos: Number(l.preco) || 0,
        secao: String(l.secao || ''),
        descricao: String(l.descricao || ''),
        imagem: String(l.imagem || ''),
      });
    }
    res.json({ sugestoes });
  } catch (e) { next(e); }
});

router.get('/produtos/:id/grupos', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    const produto = await meuProduto(loja, req.params.id);
    const gruposBrutos = await db.prepare(
      'SELECT * FROM grupos_opcoes WHERE produto_id = ? ORDER BY ordem, id'
    ).all(produto.id) as GrupoOpcao[];
    const grupos = [];
    for (const g of gruposBrutos) {
      const opcoes = await db.prepare('SELECT * FROM opcoes_itens WHERE grupo_id = ? ORDER BY ordem, id').all(g.id) as OpcaoItem[];
      grupos.push({ ...g, opcoes });
    }
    res.json({ grupos });
  } catch (e) { next(e); }
});

/*
 * PIZZA: o papel do grupo e como ele soma.
 *
 * Valores fechados, e o que não for reconhecido vira o padrão inofensivo
 * (sem papel, somando) — corpo malformado não pode virar regra de preço.
 */
export function papelValido(v: unknown): string {
  return v === 'tamanho' || v === 'sabores' ? v : '';
}

/**
 * 'proporcional' TEM QUE PASSAR.
 *
 * O painel oferece as três políticas no seletor do grupo de sabores, e
 * `precoDoGrupo` implementa as três — mas aqui só 'maior' era reconhecido, e
 * qualquer outra coisa virava 'somar'. O lojista escolhia "Proporcional à
 * fração", salvava, e o grupo passava a cobrar 100% de cada sabor: a política
 * mais caramente errada das três, escolhida em silêncio pelo servidor.
 */
export function modoPrecoValido(v: unknown): string {
  return v === 'maior' || v === 'proporcional' ? v : 'somar';
}

/**
 * TAMANHO E SABORES SÃO PAPÉIS ÚNICOS DENTRO DO PRODUTO.
 *
 * Nada impedia dois grupos de reivindicarem o mesmo papel, e aconteceu na base
 * real: o grupo "Sabores" da pizza ficou com `papel = 'tamanho'`, junto do
 * grupo "Tamanho". O efeito não era um erro visível, era o recurso inteiro
 * calado — `maxEscolhasEfetivo` só troca o limite pelo do tamanho quando o
 * papel é 'sabores', então a pizza que libera 4 sabores deixava escolher 3 (o
 * `max_escolhas` do grupo), e o passo de fração nem aparecia.
 *
 * Tirar o papel dos OUTROS grupos, e não recusar o pedido, é de propósito: o
 * lojista está dizendo "este é o grupo de tamanho", e a leitura certa disso é
 * que o anterior não é mais. Recusar deixaria ele preso, tendo que descobrir
 * sozinho qual grupo esconde o papel duplicado.
 *
 * De quebra, isto conserta a base existente na primeira vez que qualquer um dos
 * dois grupos for salvo.
 */
async function papelExclusivo(produtoId: number, papel: string, exceto: number): Promise<void> {
  if (papel !== 'tamanho' && papel !== 'sabores') return;
  await db.prepare(
    "UPDATE grupos_opcoes SET papel = '' WHERE produto_id = ? AND papel = ? AND id <> ?"
  ).run(produtoId, papel, exceto);
}

router.post('/produtos/:id/grupos', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    const produto = await meuProduto(loja, req.params.id);

    const nome = textoLimpo(req.body.nome, 60);
    const tipo = req.body.tipo === 'multiplo' ? 'multiplo' : 'unico';
    if (nome.length < 2) throw erroHttp(400, 'Informe o nome do grupo (ex.: Tamanho, Borda, Adicionais).');

    const info = await db.prepare(
      `INSERT INTO grupos_opcoes (produto_id, nome, tipo, obrigatorio, max_escolhas, ordem, papel, modo_preco)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(produto.id, nome, tipo,
          req.body.obrigatorio ? 1 : 0,
          inteiroPositivo(req.body.max_escolhas) || 0,
          inteiroPositivo(req.body.ordem) || 0,
          papelValido(req.body.papel), modoPrecoValido(req.body.modo_preco));
    await papelExclusivo(produto.id, papelValido(req.body.papel), Number(info.lastInsertRowid));
    res.status(201).json({ grupo_id: Number(info.lastInsertRowid) });
  } catch (e) { next(e); }
});

router.put('/grupos/:id', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    const grupo = await meuGrupo(loja, req.params.id);
    const nome = req.body.nome !== undefined ? textoLimpo(req.body.nome, 60) : grupo.nome;
    if (nome.length < 2) throw erroHttp(400, 'Nome do grupo inválido.');
    const papel = req.body.papel !== undefined
      ? papelValido(req.body.papel)
      : ((grupo as unknown as { papel?: string }).papel ?? '');
    await db.prepare(
      `UPDATE grupos_opcoes SET nome = ?, tipo = ?, obrigatorio = ?, max_escolhas = ?, ordem = ?,
              papel = ?, modo_preco = ? WHERE id = ?`
    ).run(nome,
          req.body.tipo !== undefined ? (req.body.tipo === 'multiplo' ? 'multiplo' : 'unico') : grupo.tipo,
          req.body.obrigatorio !== undefined ? (req.body.obrigatorio ? 1 : 0) : grupo.obrigatorio,
          req.body.max_escolhas !== undefined ? (inteiroPositivo(req.body.max_escolhas) || 0) : grupo.max_escolhas,
          // A ordem dos grupos é a ordem em que o cliente monta o pedido (tamanho
          // antes de adicional, borda antes de bebida), então é o lojista quem
          // define arrastando. `?? grupo.ordem` mantém quem só renomeou no lugar.
          req.body.ordem !== undefined ? (inteiroPositivo(req.body.ordem) || 0) : grupo.ordem,
          papel,
          req.body.modo_preco !== undefined ? modoPrecoValido(req.body.modo_preco) : ((grupo as unknown as { modo_preco?: string }).modo_preco ?? 'somar'),
          grupo.id);
    await papelExclusivo(grupo.produto_id, papel, grupo.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.delete('/grupos/:id', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    const grupo = await meuGrupo(loja, req.params.id);
    await comTransacao(async (tx) => {
      await tx.prepare('DELETE FROM opcoes_itens WHERE grupo_id = ?').run(grupo.id);
      await tx.prepare('DELETE FROM grupos_opcoes WHERE id = ?').run(grupo.id);
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post('/grupos/:id/opcoes', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    const grupo = await meuGrupo(loja, req.params.id);
    const nome = textoLimpo(req.body.nome, 80);
    if (nome.length < 1) throw erroHttp(400, 'Informe o nome da opção.');
    const precoAdicional = req.body.preco_adicional ? reaisParaCentavos(req.body.preco_adicional) : 0;
    if (precoAdicional === null || precoAdicional < 0) throw erroHttp(400, 'Preço adicional inválido.');

    const info = await db.prepare(
      `INSERT INTO opcoes_itens (grupo_id, nome, preco_adicional_centavos, disponivel, ordem, sabores, secao, descricao, imagem)
       VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)`
    ).run(grupo.id, nome, precoAdicional, inteiroPositivo(req.body.ordem) || 0,
          inteiroPositivo(req.body.sabores) || 0,
          textoLimpo(req.body.secao, 40),
          textoLimpo(req.body.descricao, 160),
          textoLimpo(req.body.imagem, 500));
    res.status(201).json({ opcao_id: Number(info.lastInsertRowid) });
  } catch (e) { next(e); }
});

router.put('/opcoes/:id', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    const opcao = await minhaOpcao(loja, req.params.id);
    const nome = req.body.nome !== undefined ? textoLimpo(req.body.nome, 80) : opcao.nome;
    if (nome.length < 1) throw erroHttp(400, 'Nome da opção inválido.');
    let precoAdicional = opcao.preco_adicional_centavos;
    if (req.body.preco_adicional !== undefined) {
      const v = req.body.preco_adicional ? reaisParaCentavos(req.body.preco_adicional) : 0;
      if (v === null || v < 0) throw erroHttp(400, 'Preço adicional inválido.');
      precoAdicional = v;
    }
    const atual = opcao as unknown as { sabores?: number; secao?: string; descricao?: string; imagem?: string };
    await db.prepare(
      `UPDATE opcoes_itens SET nome = ?, preco_adicional_centavos = ?, disponivel = ?,
              sabores = ?, secao = ?, descricao = ?, imagem = ? WHERE id = ?`
    ).run(nome, precoAdicional,
          req.body.disponivel !== undefined ? (req.body.disponivel ? 1 : 0) : opcao.disponivel,
          // Quantos sabores esta opção libera (só nas opções de tamanho).
          req.body.sabores !== undefined
            ? (inteiroPositivo(req.body.sabores) || 0)
            : (atual.sabores ?? 0),
          // Seção dentro do grupo ('Tradicionais', 'Especiais'…) — ver schema.
          req.body.secao !== undefined ? textoLimpo(req.body.secao, 40) : (atual.secao ?? ''),
          req.body.descricao !== undefined ? textoLimpo(req.body.descricao, 160) : (atual.descricao ?? ''),
          req.body.imagem !== undefined ? textoLimpo(req.body.imagem, 500) : (atual.imagem ?? ''),
          opcao.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.delete('/opcoes/:id', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    const opcao = await minhaOpcao(loja, req.params.id);
    await db.prepare('DELETE FROM opcoes_itens WHERE id = ?').run(opcao.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ----- Pedidos do lojista --------------------------------------------------

router.get('/pedidos', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    let sql = `SELECT p.*, u.nome AS cliente_nome, u.telefone AS cliente_telefone
                 FROM pedidos p JOIN usuarios u ON u.id = p.cliente_id
                WHERE p.loja_id = ? AND p.origem = 'app'
                  AND p.pagamento_status != 'aguardando'`;
    const params: (string | number)[] = [loja.id];
    if (req.query.status) { sql += ' AND p.status = ?'; params.push(textoLimpo(req.query.status, 20)); }
    sql += ' ORDER BY p.id DESC LIMIT 200';

    type PedidoLojista = Record<string, unknown> & { id: number };
    const pedidos = await db.prepare(sql).all(...params) as PedidoLojista[];
    // JOIN com produtos pra trazer a categoria de cada item — usada pra rotear
    // a impressão por setor (Cozinha/Bar) quando o pedido chega pelo app.
    for (const p of pedidos) {
      p.itens = await db.prepare(
        `SELECT ip.*, p.categoria AS categoria
           FROM itens_pedido ip
           LEFT JOIN produtos p ON p.id = ip.produto_id
          WHERE ip.pedido_id = ?`
      ).all(p.id);
      p.mensagens_nao_lidas = (await db.prepare(
        "SELECT COUNT(*) AS n FROM mensagens_pedido WHERE pedido_id = ? AND remetente = 'cliente' AND lida = 0"
      ).get(p.id) as { n: number }).n;
    }
    res.json({ pedidos });
  } catch (e) { next(e); }
});

// ----- PDV / Balcão (venda rápida no caixa) --------------------------------

/** Consumidor genérico da loja para registrar vendas de balcão (sem cliente real). */
async function consumidorBalcao(loja: Loja): Promise<number> {
  const email = `balcao.loja${loja.id}@local`;
  const existente = await db.prepare('SELECT id FROM usuarios WHERE email = ?').get(email) as { id: number } | undefined;
  if (existente) return existente.id;
  const info = await db.prepare(
    `INSERT INTO usuarios (nome, email, senha_hash, perfil, telefone, criado_em)
     VALUES ('Consumidor (Balcão)', ?, '!', 'cliente', '', ?)`
  ).run(email, agoraUTC());
  return Number(info.lastInsertRowid);
}

const PAGAMENTO_BALCAO: Record<string, 'pix' | 'dinheiro' | 'cartao_entrega'> = {
  pix: 'pix', dinheiro: 'dinheiro', cartao: 'cartao_entrega',
};

/**
 * Registra uma venda de balcão. Recalcula os preços no servidor a partir do
 * banco (nunca confia no cliente), aplica desconto e grava como um pedido
 * `origem='balcao'` já `entregue` — assim entra no faturamento/relatórios.
 */
router.post('/balcao', async (req, res, next) => {
  // Fora do try porque o tratamento de chave duplicada (no catch) precisa saber de
  // qual loja é a venda — buscar de novo lá seria outra consulta que pode falhar.
  let lojaId: number | null = null;
  try {
    const loja = await minhaLoja(req);
    lojaId = loja.id;
    const itensReq = Array.isArray(req.body.itens) ? req.body.itens : [];
    if (itensReq.length === 0) throw erroHttp(400, 'Adicione ao menos um item à venda.');

    /**
     * IDEMPOTÊNCIA — impede venda duplicada no balcão.
     *
     * Sem isto: o operador finaliza, o servidor grava, a resposta se perde (rede
     * oscilou), ele vê erro e refaz — dois pedidos, estoque baixado duas vezes,
     * dois cupons. Em caixa isso é dinheiro.
     *
     * Se a mesma chave chegar de novo, devolve a venda que já existe em vez de
     * criar outra. É a mesma ideia do X-Idempotency-Key que já usamos no Mercado
     * Pago, agora no PDV.
     */
    const idem = textoLimpo(req.body.idempotencia, 64) || null;
    if (idem) {
      const jaFeita = await db.prepare(
        `SELECT id, subtotal_centavos, desconto_centavos, total_centavos
           FROM pedidos WHERE idempotencia = ? AND loja_id = ?`
      ).get(idem, loja.id) as { id: number; subtotal_centavos: number; desconto_centavos: number; total_centavos: number } | undefined;
      if (jaFeita) {
        // 200 (e não 201): nada foi criado agora. O PDV trata igual, mas fica
        // honesto no log/rede sobre o que aconteceu.
        return res.json({
          pedido_id: jaFeita.id,
          subtotal_centavos: jaFeita.subtotal_centavos,
          desconto_centavos: jaFeita.desconto_centavos,
          total_centavos: jaFeita.total_centavos,
          repetida: true,
        });
      }
    }

    const formaPagamento = PAGAMENTO_BALCAO[String(req.body.forma_pagamento)];
    if (!formaPagamento) throw erroHttp(400, 'Forma de pagamento inválida.');

    // Recalcula tudo no servidor.
    let subtotal = 0;
    const itensValidados: { produto: Produto; quantidade: number; precoUnit: number; detalhe: string }[] = [];
    for (const it of itensReq) {
      const produto = await meuProduto(loja, it.produto_id);
      const precoBase = precoVigente(produto, dataBrasilia());

      if ((produto as any).vendido_por === 'kg') {
        // Produto por peso: o cliente informa o peso em gramas; o preço é por kg.
        const pesoG = inteiroPositivo(it.peso_g);
        if (!pesoG) throw erroHttp(400, `Informe o peso de "${produto.nome}".`);
        const precoLinha = Math.round(precoBase * pesoG / 1000);
        if (precoLinha <= 0) throw erroHttp(400, `Peso inválido para "${produto.nome}".`);
        subtotal += precoLinha;
        const kg = (pesoG / 1000).toFixed(3).replace('.', ',');
        itensValidados.push({
          produto, quantidade: 1, precoUnit: precoLinha,
          detalhe: `${kg} kg × ${(precoBase / 100).toFixed(2).replace('.', ',')}/kg`,
        });
      } else {
        const quantidade = inteiroPositivo(it.quantidade);
        if (!quantidade) throw erroHttp(400, 'Quantidade inválida.');
        subtotal += precoBase * quantidade;
        itensValidados.push({ produto, quantidade, precoUnit: precoBase, detalhe: '' });
      }
    }

    const desconto = Math.min(Math.max(inteiroPositivo(req.body.desconto_centavos) || 0, 0), subtotal);
    const total = subtotal - desconto;

    const comissaoPct = await comissaoPercentualDaLoja(loja.id);
    const comissao = Math.round(total * comissaoPct / 100);

    const consumidor = await consumidorBalcao(loja);
    const agora = agoraUTC();

    const pedidoId = await comTransacao(async (tx) => {
      // `desconto_centavos` não era gravado: o desconto era aplicado no total e
      // depois perdido. Além de sumir dos relatórios, quebrava a NFC-e — a nota
      // saía com vDesc=0 e valor cheio, ou seja, MAIOR do que o cliente pagou
      // (vendaDoPedido lê esta coluna pra montar o desconto da nota).
      const info = await tx.prepare(
        `INSERT INTO pedidos (cliente_id, loja_id, status, endereco_entrega, forma_pagamento,
                              observacoes, subtotal_centavos, taxa_entrega_centavos, desconto_centavos,
                              total_centavos, comissao_percentual, comissao_centavos, pagamento_status,
                              origem, idempotencia, criado_em, atualizado_em)
         VALUES (?, ?, 'entregue', 'Venda no balcão', ?, ?, ?, 0, ?, ?, ?, ?, 'aprovado', 'balcao', ?, ?, ?)`
      ).run(consumidor, loja.id, formaPagamento, textoLimpo(req.body.observacoes || '', 200),
            subtotal, desconto, total, comissaoPct, comissao, idem, agora, agora);
      const novoPedidoId = Number(info.lastInsertRowid);
      for (const { produto, quantidade, precoUnit, detalhe } of itensValidados) {
        await tx.prepare(
          `INSERT INTO itens_pedido (pedido_id, produto_id, nome_produto, preco_unit_centavos, quantidade, opcoes_texto, opcoes_ids)
           VALUES (?, ?, ?, ?, ?, ?, '[]')`
        ).run(novoPedidoId, produto.id, produto.nome, precoUnit, quantidade, detalhe);
        /**
         * BAIXA DE ESTOQUE — não existia no balcão. Só o checkout do cliente
         * dava baixa, então loja com controle de estoque vendia 20 no caixa, o
         * número não descia, e o app seguia vendendo online o que já tinha
         * acabado na prateleira.
         *
         * GREATEST(...,0) e SEM condição de saldo, ao contrário do checkout (que
         * exige `estoque >= ?` e falha a venda): no caixa o cliente está com o
         * produto na mão. Se a contagem do sistema está errada, recusar a venda é
         * pior que a contagem errada — o certo é registrar e deixar o número no
         * piso, pra o lojista corrigir depois no cadastro.
         */
        await tx.prepare(
          'UPDATE produtos SET estoque = GREATEST(estoque - ?, 0) WHERE id = ? AND controla_estoque = 1'
        ).run(quantidade, produto.id);
      }
      await tx.prepare('INSERT INTO historico_status (pedido_id, status, criado_em) VALUES (?, ?, ?)')
        .run(novoPedidoId, 'entregue', agora);
      return novoPedidoId;
    });

    res.status(201).json({ pedido_id: pedidoId, subtotal_centavos: subtotal, desconto_centavos: desconto, total_centavos: total });
  } catch (e) {
    /**
     * Corrida perdida na chave única: duas requisições com a MESMA chave chegaram
     * juntas (duplo-clique com rede lenta), a outra inseriu primeiro e esta bateu
     * no índice. Não é erro — é a proteção funcionando: devolve a venda que
     * venceu, em vez de mostrar falha ao operador com a venda já registrada.
     */
    const erro = e as { code?: string };
    const idemReq = textoLimpo(req.body?.idempotencia, 64);
    if (erro?.code === 'ER_DUP_ENTRY' && idemReq && lojaId) {
      try {
        // Filtra por loja: a chave é única no tenant, então sem isso uma colisão
        // (por improvável que seja) devolveria a venda de OUTRA loja.
        const existente = await db.prepare(
          `SELECT id, subtotal_centavos, desconto_centavos, total_centavos
             FROM pedidos WHERE idempotencia = ? AND loja_id = ?`
        ).get(idemReq, lojaId) as { id: number; subtotal_centavos: number; desconto_centavos: number; total_centavos: number } | undefined;
        if (existente) {
          return res.json({
            pedido_id: existente.id,
            subtotal_centavos: existente.subtotal_centavos,
            desconto_centavos: existente.desconto_centavos,
            total_centavos: existente.total_centavos,
            repetida: true,
          });
        }
      } catch { /* cai no next(e) abaixo */ }
    }
    next(e);
  }
});

/** Vendas de balcão de hoje (lista curta + total) para o histórico do PDV. */
router.get('/balcao/hoje', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    /*
     * O dia começa à meia-noite NO BRASIL, não em UTC. Com o corte em UTC, às
     * 21h a lista esvaziava e o total zerava — no meio do movimento, e na hora
     * em que o caixa confere o fechamento.
     */
    const vendas = await db.prepare(
      `SELECT id, total_centavos, forma_pagamento, criado_em
         FROM pedidos
        WHERE loja_id = ? AND origem = 'balcao' AND criado_em >= ?
        ORDER BY id DESC LIMIT 50`
    ).all(loja.id, inicioDoDiaBR()) as Array<{ total_centavos: number }>;
    const total = vendas.reduce((s, v) => s + v.total_centavos, 0);
    res.json({ vendas, total_centavos: total, quantidade: vendas.length });
  } catch (e) { next(e); }
});

/**
 * Envia os itens do PDV para a cozinha (KDS) sem fechar a venda.
 * O caixa continua registrando o pagamento normalmente depois, via POST /balcao.
 */
router.post('/balcao/enviar-cozinha', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    const itensReq = Array.isArray(req.body.itens) ? req.body.itens : [];
    if (itensReq.length === 0) throw erroHttp(400, 'Adicione itens antes de enviar à cozinha.');

    const itens: Array<{ nome_produto: string; quantidade: number }> = [];
    for (const it of itensReq) {
      const quantidade = inteiroPositivo(it.quantidade);
      if (!quantidade) throw erroHttp(400, 'Quantidade inválida.');
      const produto = await meuProduto(loja, it.produto_id); // valida que o produto é da loja
      itens.push({ nome_produto: produto.nome, quantidade });
    }
    const observacao = textoLimpo(req.body.observacoes || '', 200);
    const agora = agoraUTC();

    const ticketId = await comTransacao(async (tx) => {
      const info = await tx.prepare(
        "INSERT INTO cozinha_tickets (loja_id, origem, referencia, status, observacao, criado_em) VALUES (?, 'balcao', 'Balcão', 'na_fila', ?, ?)"
      ).run(loja.id, observacao, agora);
      const tid = Number(info.lastInsertRowid);
      for (const it of itens) {
        await tx.prepare("INSERT INTO cozinha_ticket_itens (ticket_id, nome_produto, quantidade) VALUES (?, ?, ?)")
          .run(tid, it.nome_produto, it.quantidade);
      }
      return tid;
    });

    res.status(201).json({ ticket_id: ticketId, itens_enviados: itens.length });
  } catch (e) { next(e); }
});

const ACOES_LOJISTA: Record<string, 'aceito' | 'recusado' | 'preparando' | 'pronto'> = {
  aceitar:  'aceito',
  recusar:  'recusado',
  preparar: 'preparando',
  pronto:   'pronto',
};

router.post('/pedidos/:id/acao', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    const acao = textoLimpo(req.body.acao, 20);
    const novoStatus = ACOES_LOJISTA[acao];
    if (!novoStatus) throw erroHttp(400, 'Ação inválida. Use: aceitar, recusar, preparar ou pronto.');

    const pedido = await db.prepare('SELECT * FROM pedidos WHERE id = ? AND loja_id = ?')
      .get(req.params.id, loja.id) as {
        id: number; pagamento_status: string; estornado_em: string;
        pagamento_gateway: string; pagamento_gateway_id: string;
      } | undefined;
    if (!pedido) throw erroHttp(404, 'Pedido não encontrado.');
    // A listagem já esconde pedido Pix não pago (pagamento_status='aguardando'),
    // mas essa rota é o que de fato muda o estado — reforça aqui, não só na UI,
    // pra ninguém conseguir "aceitar" um pedido cujo pagamento nunca chegou.
    if (acao !== 'recusar' && pedido.pagamento_status === 'aguardando') {
      throw erroHttp(409, 'Este pedido ainda não teve o pagamento Pix confirmado.');
    }

    const extras: Record<string, string | number | null> = {};
    if (acao === 'recusar') {
      extras.motivo_recusa = textoLimpo(req.body.motivo, 200) || 'Recusado pela loja';

      /**
       * RECUSAR PEDIDO JÁ PAGO ESTORNA O DINHEIRO — antes não estornava.
       *
       * O BURACO QUE ISSO FECHA: o cliente pagava o Pix, o pedido ficava
       * `pendente` esperando a loja, a loja recusava (sem estoque, fechando mais
       * cedo) e o pedido ia pra `recusado`. Estoque voltava, o cliente recebia
       * "pedido recusado" — e o dinheiro FICAVA NA LOJA. Nada no sistema
       * sinalizava, e o lojista muitas vezes nem sabia que aquele pedido já
       * estava pago. O cancelamento pelo cliente sempre foi bloqueado nesse caso
       * (rotas/cliente.ts) justamente porque não havia estorno; a recusa pelo
       * lojista passava batido.
       *
       * ORDEM IMPORTA: estorna ANTES de mudar o status. Se o gateway falhar, a
       * recusa é abortada com erro — melhor o lojista tentar de novo do que o
       * pedido ficar recusado com o dinheiro preso, que é justamente o estado
       * que ninguém percebe depois.
       */
      const jaPago = pedido.pagamento_status === 'aprovado' && !pedido.estornado_em;
      if (jaPago) {
        if (!pedido.pagamento_gateway_id) {
          throw erroHttp(409,
            'Este pedido foi pago online mas não tem referência do pagamento. '
            + 'Estorne direto no painel do gateway antes de recusar.');
        }
        const { estornarPagamentoOnline } = await import('./pagamentos');
        try {
          await estornarPagamentoOnline(loja.id, pedido.pagamento_gateway, pedido.pagamento_gateway_id);
        } catch (e) {
          throw erroHttp(502,
            'Não conseguimos devolver o pagamento agora, então o pedido NÃO foi recusado '
            + '(recusar sem devolver o dinheiro deixaria o cliente sem pedido e sem '
            + 'reembolso). Tente de novo em instantes. Detalhe: ' + (e as Error).message);
        }
        await db.prepare('UPDATE pedidos SET estornado_em = ? WHERE id = ?').run(agoraUTC(), pedido.id);
      }
    }
    const atualizado = await transicionarStatus(pedido.id, novoStatus, { camposExtras: extras });
    res.json({ pedido: atualizado });
  } catch (e) { next(e); }
});

/**
 * Estorna um pedido ONLINE já pago (Pix ou cartão) e cancela — o único fluxo de
 * reembolso hoje é
 * manual, direto na API do Mercado Pago (não existe estorno automático em
 * nenhum outro ponto do sistema). Precisa ter passado por aqui pra um cliente
 * conseguir cancelar de novo (POST /cliente/pedidos/:id/cancelar bloqueia
 * pedido Pix já aprovado justamente pra isso não acontecer sem estorno).
 */
router.post('/pedidos/:id/estornar', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    const pedido = await db.prepare('SELECT * FROM pedidos WHERE id = ? AND loja_id = ?')
      .get(req.params.id, loja.id) as any | undefined;
    if (!pedido) throw erroHttp(404, 'Pedido não encontrado.');
    if (pedido.pagamento_status !== 'aprovado') throw erroHttp(409, 'Este pedido não tem pagamento online aprovado pra estornar.');
    if (pedido.estornado_em) throw erroHttp(409, 'Este pedido já foi estornado.');
    if (!pedido.pagamento_gateway_id) throw erroHttp(409, 'Pedido sem referência de pagamento — estorne direto no painel do gateway.');
    if (['entregue', 'em_entrega'].includes(pedido.status)) {
      throw erroHttp(409, 'Pedido já saiu ou foi entregue — não dá pra estornar por aqui.');
    }

    // Despacha pro gateway que PROCESSOU este pedido (ver pagamentos.ts) — não
    // pro que a loja usa hoje: se o lojista trocou de gateway depois, o estorno
    // ainda precisa acontecer onde o dinheiro entrou.
    const { estornarPagamentoOnline } = await import('./pagamentos');
    await estornarPagamentoOnline(loja.id, pedido.pagamento_gateway, pedido.pagamento_gateway_id);

    const agora = agoraUTC();
    await db.prepare('UPDATE pedidos SET estornado_em = ? WHERE id = ?').run(agora, pedido.id);
    if (pedido.status !== 'cancelado') {
      await transicionarStatus(pedido.id, 'cancelado', { camposExtras: { motivo_recusa: 'Estornado pela loja' } });
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ----- Chat do pedido (loja fala com o cliente enquanto não tem entregador) -

router.get('/pedidos/:id/mensagens', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    const pedido = await db.prepare('SELECT id FROM pedidos WHERE id = ? AND loja_id = ?')
      .get(req.params.id, loja.id) as { id: number } | undefined;
    if (!pedido) throw erroHttp(404, 'Pedido não encontrado.');
    const mensagens = await db.prepare(
      'SELECT id, remetente, texto, criado_em FROM mensagens_pedido WHERE pedido_id = ? ORDER BY id'
    ).all(pedido.id);
    await db.prepare("UPDATE mensagens_pedido SET lida = 1 WHERE pedido_id = ? AND remetente = 'cliente'").run(pedido.id);
    res.json({ mensagens });
  } catch (e) { next(e); }
});

router.post('/pedidos/:id/mensagens', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    const pedido = await db.prepare('SELECT id FROM pedidos WHERE id = ? AND loja_id = ?')
      .get(req.params.id, loja.id) as { id: number } | undefined;
    if (!pedido) throw erroHttp(404, 'Pedido não encontrado.');
    const texto = textoLimpo(req.body.texto, 500);
    if (!texto) throw erroHttp(400, 'Escreva uma mensagem.');
    const info = await db.prepare(
      `INSERT INTO mensagens_pedido (pedido_id, remetente, texto, criado_em) VALUES (?, 'loja', ?, ?)`
    ).run(pedido.id, texto, agoraUTC());
    res.status(201).json({ mensagem_id: Number(info.lastInsertRowid) });
  } catch (e) { next(e); }
});

// ----- Entregadores (cadastro + atribuição manual pelo lojista) ------------

/**
 * Lista de entregadores disponíveis para o lojista atribuir a um pedido:
 * os cadastrados exclusivamente por esta loja + os que se auto-cadastraram
 * (loja_id nulo, compartilhados entre lojas do mesmo tenant).
 */
router.get('/entregadores', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    const entregadores = await db.prepare(
      `SELECT id, nome, telefone FROM usuarios
       WHERE perfil = 'entregador' AND bloqueado = 0 AND (loja_id IS NULL OR loja_id = ?)
       ORDER BY nome`
    ).all(loja.id);
    res.json({ entregadores });
  } catch (e) { next(e); }
});

/** Entregadores cadastrados diretamente por esta loja (exclusivos dela). */
router.get('/entregadores/cadastro', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    const entregadores = await db.prepare(
      `SELECT id, nome, email, telefone, bloqueado FROM usuarios
       WHERE perfil = 'entregador' AND loja_id = ? ORDER BY nome`
    ).all(loja.id);
    res.json({ entregadores });
  } catch (e) { next(e); }
});

/* ─────────────────── Usuários da loja (equipe do painel) ─────────────────── */

/**
 * Quem tem acesso ao painel desta loja: o dono e os usuários que ele criou.
 *
 * CADA USUÁRIO TEM AS SUAS ÁREAS (`usuarios.permissoes`, ver AREAS_PAINEL). A
 * checagem que vale é a do middleware algumas centenas de linhas acima, que
 * barra no SERVIDOR — esconder item de menu não é permissão.
 *
 * Dois pontos que não são óbvios lendo só esta rota:
 *  - O DONO tem tudo, sempre, e é quem distribui o resto.
 *  - `permissoes` NULL significa acesso total, por compatibilidade: quem foi
 *    criado antes deste recurso não tem a coluna preenchida, e trancar essa
 *    gente de repente derrubaria quem já estava trabalhando.
 */
router.get('/usuarios', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    const donoId = (loja as unknown as { usuario_id: number }).usuario_id;
    const linhas = await db.prepare(
      `SELECT id, nome, email, bloqueado, criado_em, permissoes FROM usuarios
        WHERE perfil = 'lojista' AND (id = ? OR loja_id = ?)
        ORDER BY id`
    ).all(donoId, loja.id) as Array<{ id: number; nome: string; email: string; bloqueado: number; criado_em: string; permissoes: string | null }>;
    res.json({
      sou_dono: ehDonoDaLoja(req, loja),
      meu_id: req.usuario!.id,
      areas: AREAS_PAINEL,
      usuarios: linhas.map(u => ({
        ...u,
        dono: u.id === donoId,
        // `null` vira lista cheia na tela: acesso total é o que ele tem de fato
        // (ver a compatibilidade no middleware), e mostrar caixas vazias mentiria.
        permissoes: u.id === donoId
          ? AREAS_PAINEL.map(a => a.chave)
          : (lerPermissoes(u.permissoes) ?? AREAS_PAINEL.map(a => a.chave)),
      })),
    });
  } catch (e) { next(e); }
});

/** Só aceita chaves de área que existem — lixo no corpo não vira permissão. */
function permissoesValidas(bruto: unknown): string[] | undefined {
  if (!Array.isArray(bruto)) return undefined;
  const validas = new Set(AREAS_PAINEL.map(a => a.chave as string));
  return [...new Set(bruto.filter(x => typeof x === 'string' && validas.has(x)))] as string[];
}

/** Cria um usuário do painel para esta loja. Só o dono. */
router.post('/usuarios', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    await exigirDono(req, loja);

    const nome = textoLimpo(req.body.nome, 120);
    const email = textoLimpo(req.body.email, 200).toLowerCase();
    const senha = typeof req.body.senha === 'string' ? req.body.senha : '';
    if (nome.length < 2) throw erroHttp(400, 'Informe o nome da pessoa.');
    if (!emailValido(email)) throw erroHttp(400, 'Informe um e-mail válido (será o login).');
    if (senha.length < 6) throw erroHttp(400, 'A senha precisa ter pelo menos 6 caracteres.');

    // Checado antes do INSERT pra dar a mensagem do campo certo, em vez de
    // deixar o índice único estourar como erro genérico (mesmo motivo do
    // cadastro de entregador acima).
    const jaExiste = await db.prepare('SELECT id FROM usuarios WHERE email = ?').get(email);
    if (jaExiste) throw erroHttp(409, 'Já existe uma conta com este e-mail.');

    /*
     * Usuário NOVO nasce com a lista explícita, mesmo que venha vazia. É o que
     * separa 'ainda não configurado' (NULL, acesso total por compatibilidade)
     * de 'configurado sem nenhuma área' — que tem que bloquear de verdade.
     */
    const permissoes = permissoesValidas(req.body.permissoes) ?? [];
    const info = await db.prepare(
      `INSERT INTO usuarios (nome, email, senha_hash, perfil, loja_id, permissoes, criado_em)
       VALUES (?, ?, ?, 'lojista', ?, ?, ?)`
    ).run(nome, email, await bcrypt.hash(senha, 10), loja.id, JSON.stringify(permissoes), agoraUTC());
    res.status(201).json({ id: Number(info.lastInsertRowid), nome, email, bloqueado: 0, dono: false, permissoes });
  } catch (e) { next(e); }
});

/** Bloqueia/desbloqueia, renomeia ou troca a senha de um usuário. Só o dono. */
router.put('/usuarios/:id', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    await exigirDono(req, loja);
    const donoId = (loja as unknown as { usuario_id: number }).usuario_id;
    const alvoId = Number(req.params.id);

    /*
     * O DONO NÃO PODE SER BLOQUEADO, nem por ele mesmo. É a única conta que
     * administra as outras — bloqueá-la deixaria a loja sem ninguém capaz de
     * desbloquear, e o conserto passaria por suporte mexendo no banco.
     */
    if (alvoId === donoId) throw erroHttp(409, 'A conta do dono não pode ser bloqueada nem renomeada por aqui.');

    const alvo = await db.prepare(
      "SELECT id FROM usuarios WHERE id = ? AND perfil = 'lojista' AND loja_id = ?"
    ).get(alvoId, loja.id) as { id: number } | undefined;
    if (!alvo) throw erroHttp(404, 'Usuário não encontrado nesta loja.');

    const sets: string[] = [];
    const vals: unknown[] = [];
    if (typeof req.body.nome === 'string') {
      const nome = textoLimpo(req.body.nome, 120);
      if (nome.length < 2) throw erroHttp(400, 'Nome inválido.');
      sets.push('nome = ?'); vals.push(nome);
    }
    if (typeof req.body.senha === 'string' && req.body.senha) {
      if (req.body.senha.length < 6) throw erroHttp(400, 'A senha precisa ter pelo menos 6 caracteres.');
      sets.push('senha_hash = ?'); vals.push(await bcrypt.hash(req.body.senha, 10));
    }
    if (req.body.bloqueado !== undefined) {
      sets.push('bloqueado = ?'); vals.push(req.body.bloqueado ? 1 : 0);
    }
    const permissoes = permissoesValidas(req.body.permissoes);
    if (permissoes) { sets.push('permissoes = ?'); vals.push(JSON.stringify(permissoes)); }
    if (sets.length === 0) throw erroHttp(400, 'Nada para alterar.');
    await db.prepare(`UPDATE usuarios SET ${sets.join(', ')} WHERE id = ?`).run(...vals, alvo.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/** Remove um usuário do painel. Só o dono, e nunca a si mesmo nem o dono. */
router.delete('/usuarios/:id', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    await exigirDono(req, loja);
    const donoId = (loja as unknown as { usuario_id: number }).usuario_id;
    const alvoId = Number(req.params.id);
    if (alvoId === donoId) throw erroHttp(409, 'A conta do dono não pode ser removida.');

    const alvo = await db.prepare(
      "SELECT id FROM usuarios WHERE id = ? AND perfil = 'lojista' AND loja_id = ?"
    ).get(alvoId, loja.id) as { id: number } | undefined;
    if (!alvo) throw erroHttp(404, 'Usuário não encontrado nesta loja.');

    /*
     * APAGA a conta, e não só o vínculo: o e-mail é único no sistema inteiro, e
     * deixar a linha órfã impediria a pessoa de voltar depois com o mesmo
     * e-mail — inclusive como cliente da própria loja.
     */
    await comTransacao(async (tx) => {
      // As inscrições de push apontam pro usuário; sem apagá-las antes, o
      // DELETE da conta esbarra na chave estrangeira.
      await tx.prepare('DELETE FROM push_inscricoes WHERE usuario_id = ?').run(alvo.id);
      await tx.prepare('DELETE FROM usuarios WHERE id = ?').run(alvo.id);
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/** Cadastra um novo entregador (motoboy) exclusivo desta loja. */
router.post('/entregadores/cadastro', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    const nome = textoLimpo(req.body.nome, 120);
    const telefone = textoLimpo(req.body.telefone, 30);
    const email = textoLimpo(req.body.email, 200).toLowerCase();
    const senha = typeof req.body.senha === 'string' ? req.body.senha : '';
    if (nome.length < 2) throw erroHttp(400, 'Informe o nome do entregador.');
    if (!emailValido(email)) throw erroHttp(400, 'Informe um e-mail válido (login do entregador).');
    if (senha.length < 6) throw erroHttp(400, 'A senha precisa ter pelo menos 6 caracteres.');

    const jaExiste = await db.prepare('SELECT id FROM usuarios WHERE email = ?').get(email);
    if (jaExiste) throw erroHttp(409, 'Já existe uma conta com este e-mail.');

    /**
     * Telefone também é ÚNICO entre todas as contas (índice
     * idx_usuarios_telefone_unico, sobre a coluna gerada `telefone_unico`).
     *
     * Checado aqui, antes do INSERT, pelo mesmo motivo do e-mail acima: dá a
     * mensagem exata do campo. Sem isto, o INSERT estourava e o lojista recebia
     * "Erro interno do servidor" — foi o que aconteceu de verdade ao cadastrar um
     * entregador com um número que já estava em outra conta. O tratador central
     * (server.ts) hoje traduz esse erro, mas checar antes é melhor: evita gastar
     * o hash de senha e não depende do texto de erro do MySQL.
     */
    if (telefone) {
      const telRepetido = await db.prepare(
        'SELECT perfil FROM usuarios WHERE telefone = ?'
      ).get(telefone) as { perfil: string } | undefined;
      if (telRepetido) {
        throw erroHttp(409,
          `Este telefone já está cadastrado em outra conta (${telRepetido.perfil}). Use outro número.`);
      }
    }

    const senhaHash = await bcrypt.hash(senha, 10);
    const info = await db.prepare(
      `INSERT INTO usuarios (nome, email, senha_hash, perfil, telefone, loja_id, criado_em)
       VALUES (?, ?, ?, 'entregador', ?, ?, ?)`
    ).run(nome, email, senhaHash, telefone, loja.id, agoraUTC());
    res.status(201).json({ id: info.lastInsertRowid, nome, email, telefone, bloqueado: 0 });
  } catch (e) { next(e); }
});

/** Edita nome/telefone/senha ou bloqueia/desbloqueia um entregador desta loja. */
router.put('/entregadores/cadastro/:id', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    const entregador = await db.prepare(
      "SELECT id FROM usuarios WHERE id = ? AND perfil = 'entregador' AND loja_id = ?"
    ).get(req.params.id, loja.id) as { id: number } | undefined;
    if (!entregador) throw erroHttp(404, 'Entregador não encontrado.');

    if (req.body.nome !== undefined) {
      const nome = textoLimpo(req.body.nome, 120);
      if (nome.length < 2) throw erroHttp(400, 'Nome inválido.');
      await db.prepare('UPDATE usuarios SET nome = ? WHERE id = ?').run(nome, entregador.id);
    }
    if (req.body.telefone !== undefined) {
      await db.prepare('UPDATE usuarios SET telefone = ? WHERE id = ?')
        .run(textoLimpo(req.body.telefone, 30), entregador.id);
    }
    if (req.body.bloqueado !== undefined) {
      await db.prepare('UPDATE usuarios SET bloqueado = ? WHERE id = ?')
        .run(req.body.bloqueado ? 1 : 0, entregador.id);
    }
    if (req.body.senha !== undefined) {
      const senha = typeof req.body.senha === 'string' ? req.body.senha : '';
      if (senha.length < 6) throw erroHttp(400, 'A senha precisa ter pelo menos 6 caracteres.');
      await db.prepare('UPDATE usuarios SET senha_hash = ? WHERE id = ?')
        .run(await bcrypt.hash(senha, 10), entregador.id);
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/**
 * Atribui manualmente um entregador a um pedido pronto. Move o pedido para
 * 'em_entrega' (mesma transição do auto-atendimento) e avisa o entregador
 * por push. Só funciona quando o pedido está "pronto" e ainda é da loja.
 */
router.post('/pedidos/:id/atribuir-entregador', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    const entregadorId = inteiroPositivo(req.body.entregador_id);
    if (!entregadorId) throw erroHttp(400, 'Informe o entregador.');

    const entregador = await db.prepare(
      `SELECT id FROM usuarios WHERE id = ? AND perfil = 'entregador' AND bloqueado = 0
       AND (loja_id IS NULL OR loja_id = ?)`
    ).get(entregadorId, loja.id) as { id: number } | undefined;
    if (!entregador) throw erroHttp(404, 'Entregador não encontrado ou indisponível.');

    const pedido = await db.prepare(
      "SELECT id, status FROM pedidos WHERE id = ? AND loja_id = ? AND origem = 'app'"
    ).get(req.params.id, loja.id) as { id: number; status: string } | undefined;
    if (!pedido) throw erroHttp(404, 'Pedido não encontrado.');
    if (pedido.status !== 'pronto') {
      throw erroHttp(409, 'Só é possível atribuir um entregador quando o pedido está "Pronto".');
    }

    const atualizado = await transicionarStatus(pedido.id, 'em_entrega', {
      camposExtras: { entregador_id: entregadorId },
    });

    // Avisa o entregador no celular (best-effort, não bloqueia a resposta).
    enviarPush(entregadorId, {
      titulo: '🛵 Nova entrega para você',
      corpo: `Pedido #${pedido.id} está pronto para retirada na ${loja.nome}.`,
      url: '/entregador',
      tag: `entrega-${pedido.id}`,
    }).catch(() => { /* best-effort */ });

    res.json({ pedido: atualizado });
  } catch (e) { next(e); }
});

// ----- Contas de cozinha (KDS) — gerenciadas pelo lojista ------------------

/** Lista as contas de cozinha da loja (sem expor o hash da senha). */
router.get('/cozinha-contas', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    const contas = await db.prepare(
      'SELECT id, nome, email, bloqueado, criado_em FROM cozinha_contas WHERE loja_id = ? ORDER BY nome'
    ).all(loja.id);
    res.json({ contas });
  } catch (e) { next(e); }
});

/** Cria uma conta de cozinha (login independente) para a loja. */
router.post('/cozinha-contas', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    const nome = textoLimpo(req.body.nome, 80);
    const email = textoLimpo(req.body.email, 200).toLowerCase();
    const senha = typeof req.body.senha === 'string' ? req.body.senha : '';

    if (nome.length < 2) throw erroHttp(400, 'Informe um nome para a conta da cozinha.');
    if (!emailValido(email)) throw erroHttp(400, 'Informe um e-mail válido.');
    if (senha.length < 6) throw erroHttp(400, 'A senha precisa ter pelo menos 6 caracteres.');

    // E-mail é único globalmente (entre contas de cozinha e usuários da plataforma).
    const colideUsuario = await db.prepare('SELECT id FROM usuarios WHERE email = ?').get(email);
    const colideCozinha = await db.prepare('SELECT id FROM cozinha_contas WHERE email = ?').get(email);
    if (colideUsuario || colideCozinha) throw erroHttp(409, 'Já existe uma conta com este e-mail.');

    const info = await db.prepare(
      'INSERT INTO cozinha_contas (loja_id, nome, email, senha_hash, criado_em) VALUES (?, ?, ?, ?, ?)'
    ).run(loja.id, nome, email, await bcrypt.hash(senha, 10), agoraUTC());
    res.status(201).json({ id: Number(info.lastInsertRowid), nome, email });
  } catch (e) { next(e); }
});

/** Atualiza uma conta de cozinha: renomear, bloquear/desbloquear ou trocar senha. */
router.put('/cozinha-contas/:id', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    const conta = await db.prepare('SELECT id FROM cozinha_contas WHERE id = ? AND loja_id = ?')
      .get(req.params.id, loja.id) as { id: number } | undefined;
    if (!conta) throw erroHttp(404, 'Conta de cozinha não encontrada.');

    if (req.body.nome !== undefined) {
      const nome = textoLimpo(req.body.nome, 80);
      if (nome.length < 2) throw erroHttp(400, 'Nome inválido.');
      await db.prepare('UPDATE cozinha_contas SET nome = ? WHERE id = ?').run(nome, conta.id);
    }
    if (req.body.bloqueado !== undefined) {
      await db.prepare('UPDATE cozinha_contas SET bloqueado = ? WHERE id = ?')
        .run(req.body.bloqueado ? 1 : 0, conta.id);
    }
    if (req.body.senha !== undefined) {
      const senha = typeof req.body.senha === 'string' ? req.body.senha : '';
      if (senha.length < 6) throw erroHttp(400, 'A senha precisa ter pelo menos 6 caracteres.');
      await db.prepare('UPDATE cozinha_contas SET senha_hash = ? WHERE id = ?')
        .run(await bcrypt.hash(senha, 10), conta.id);
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/** Remove uma conta de cozinha. */
router.delete('/cozinha-contas/:id', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    const info = await db.prepare('DELETE FROM cozinha_contas WHERE id = ? AND loja_id = ?')
      .run(req.params.id, loja.id);
    if (info.changes === 0) throw erroHttp(404, 'Conta de cozinha não encontrada.');
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ----- 2FA (própria conta do lojista) --------------------------------------

/**
 * Reseta o 2FA da própria conta (perdeu o celular / trocou de aparelho):
 * exige a senha atual, apaga o secret e os códigos de backup. O próximo
 * login cai automaticamente na tela de configurar o 2FA de novo (2FA
 * continua obrigatório — isso não desativa, só força reconfiguração).
 */
router.post('/2fa/resetar', async (req, res, next) => {
  try {
    const senha = typeof req.body.senha === 'string' ? req.body.senha : '';
    const usuario = await db.prepare('SELECT senha_hash FROM usuarios WHERE id = ?')
      .get(req.usuario!.id) as { senha_hash: string } | undefined;
    if (!usuario || !await bcrypt.compare(senha, usuario.senha_hash)) {
      throw erroHttp(401, 'Senha incorreta.');
    }
    await db.prepare('UPDATE usuarios SET totp_secret = NULL, totp_ativo = 0, totp_backup_codes = NULL WHERE id = ?')
      .run(req.usuario!.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ----- Pagamentos (Mercado Pago por loja) ---------------------------------
//
// Cada loja usa a PRÓPRIA conta (Mercado Pago, Sicoob, etc. — sem token
// compartilhado entre lojas), com um token de teste e um de produção lado a
// lado e um modo escolhendo qual dos dois vale agora. Assim o lojista testa
// o Pix sem risco de cobrança real, e troca pra produção sem perder o token
// de teste (nem precisar colar tudo de novo quando quiser voltar a testar).

function mascarar(token: string | null): string | null {
  return token ? '****' + token.slice(-8) : null;
}

/** Estado atual do Pix da loja: modo ativo, tokens mascarados, e se o token do modo ativo está configurado. */
router.get('/pagamentos', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    const row = await db.prepare(
      'SELECT mercadopago_token_teste, mercadopago_token_producao, mercadopago_modo, pagamento_gateway FROM lojas WHERE id = ?'
    ).get(loja.id) as
      { mercadopago_token_teste: string | null; mercadopago_token_producao: string | null; mercadopago_modo: string; pagamento_gateway: string | null } | undefined;
    const modo: 'teste' | 'producao' = row?.mercadopago_modo === 'teste' ? 'teste' : 'producao';
    const descriptografarOuNulo = (c: string | null) => {
      if (!c) return null;
      try { return descriptografar(c); } catch { return null; }
    };
    const tokenTeste = descriptografarOuNulo(row?.mercadopago_token_teste ?? null);
    const tokenProducao = descriptografarOuNulo(row?.mercadopago_token_producao ?? null);
    const gateway = row?.pagamento_gateway === 'onz' ? 'onz' : 'mercadopago';
    const credOnz = await credenciaisOnzDaLoja(loja.id);
    const onzDisponivel = cashInDisponivel(credOnz);
    /*
     * "Recebendo desde …" e "último pagamento há …" saem dos PEDIDOS, não de uma
     * coluna de configuração: não existe registro de quando a credencial foi
     * colada, e inventar uma data seria pior que não mostrar nenhuma. O primeiro
     * e o último pagamento aprovado descrevem exatamente o que a frase promete —
     * desde quando esta loja recebe online, e quando foi a última vez.
     *
     * Usa `criado_em` e não `atualizado_em` porque o pedido continua sendo
     * atualizado depois (aceito, saiu pra entrega), e aí a data deixaria de ser a
     * do pagamento. Pagamento online acontece no ato do pedido, então o `criado_em`
     * erra por minutos — o `atualizado_em` erraria por horas.
     */
    const marcos = await db.prepare(
      `SELECT MIN(criado_em) AS primeiro, MAX(criado_em) AS ultimo
         FROM pedidos WHERE loja_id = ? AND pagamento_status = 'aprovado'`
    ).get(loja.id) as { primeiro: string | null; ultimo: string | null } | undefined;
    res.json({
      gateway,
      // Pix ONZ está utilizável? (conta da loja ou, na falta, a da plataforma)
      onz_disponivel: onzDisponivel,
      // A loja tem conta ONZ PRÓPRIA configurada (o dinheiro cai direto nela)?
      onz_conta_propria: !!credOnz,
      onz_client_id_mascarado: mascarar(credOnz?.clientId ?? null),
      /*
       * Client ID vai INTEIRO (o secret, não). Ele identifica a aplicação, não
       * autoriza nada sozinho — é o par com o secret que autentica. A tela mostra
       * mascarado por padrão e só revela quando o lojista clica no olho, que é
       * justamente o caso em que ele quer conferir se colou a credencial certa.
       */
      onz_client_id: credOnz?.clientId ?? '',
      onz_pix_key: credOnz?.chavePix ?? '',
      primeiro_pagamento_em: marcos?.primeiro ?? null,
      ultimo_pagamento_em: marcos?.ultimo ?? null,
      public_key: (await db.prepare('SELECT mercadopago_public_key FROM lojas WHERE id = ?')
        .get(loja.id) as { mercadopago_public_key: string | null } | undefined)?.mercadopago_public_key || '',
      webhook_secret_configurado: !!(await db.prepare(
        'SELECT mercadopago_webhook_secret FROM lojas WHERE id = ?'
      ).get(loja.id) as { mercadopago_webhook_secret: string | null } | undefined)?.mercadopago_webhook_secret,
      /*
       * URL DO WEBHOOK **JÁ IDENTIFICADA**: `?t=<banco>&loja=<id>`.
       *
       * A tela mostrava a URL nua. Se o lojista cadastrasse aquilo no painel do
       * Mercado Pago, a notificação chegaria sem dizer de qual tenant nem de
       * qual loja — e aí a consulta cairia no token da plataforma, que não
       * enxerga um pagamento feito na conta da loja. Falhava em silêncio.
       */
      webhook_url: `${req.protocol}://${req.get('host')}/api/pagamentos/webhook/mercadopago`
        + `?t=${encodeURIComponent(bancoTenantAtual())}&loja=${loja.id}`,
      modo,
      ativo: gateway === 'onz' ? onzDisponivel : (modo === 'teste' ? !!tokenTeste : !!tokenProducao),
      token_teste_mascarado: mascarar(tokenTeste),
      token_producao_mascarado: mascarar(tokenProducao),
      /*
       * CARTÃO ONLINE exige conta PRÓPRIA do Mercado Pago — não vale o token da
       * plataforma, senão o dinheiro do cartão cairia na conta dela. Por isso é um
       * campo separado de `ativo`, que aceita o gateway de Pix da loja.
       */
      cartao_online_ativo: !!(modo === 'teste' ? tokenTeste : tokenProducao),
    });
  } catch (e) { next(e); }
});

/**
 * TESTA AS CREDENCIAIS AO VIVO, contra o gateway de verdade.
 *
 * Existe porque salvar credencial não prova nada: token colado errado, token de
 * outra conta, token revogado e token expirado ficam todos com a mesma cara no
 * banco. Sem este botão, a primeira notícia de que a credencial não presta é um
 * cliente na tela de pagamento — e aí a venda já foi perdida.
 *
 * Faz uma chamada barata e IDEMPOTENTE (consulta, nunca cobrança) na conta do
 * lojista, então pode ser apertado à vontade sem gerar cobrança nem lixo.
 */
router.post('/pagamentos/testar', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    const row = await db.prepare(
      'SELECT mercadopago_token_teste, mercadopago_token_producao, mercadopago_modo, pagamento_gateway FROM lojas WHERE id = ?'
    ).get(loja.id) as
      { mercadopago_token_teste: string | null; mercadopago_token_producao: string | null; mercadopago_modo: string; pagamento_gateway: string | null } | undefined;
    const gateway = row?.pagamento_gateway === 'onz' ? 'onz' : 'mercadopago';

    const modo: 'teste' | 'producao' = row?.mercadopago_modo === 'teste' ? 'teste' : 'producao';
    const linhas: string[] = [];
    let tudoOk = true;

    // ── Conta Planner (só recebe Pix, e só quando é o gateway escolhido) ──
    if (gateway === 'onz') {
      const cred = await credenciaisOnzDaLoja(loja.id);
      if (!cred) {
        tudoOk = false;
        linhas.push('Planner: nenhuma credencial salva nesta loja.');
      } else {
        try {
          // Consulta o webhook registrado: é autenticada (prova que o par
          // ID+secret vale) e não cria nada na conta.
          const r = await consultarWebhookCashIn(cred);
          linhas.push(r.registrado
            ? 'Planner (Pix): conectada, com confirmação automática registrada.'
            : 'Planner (Pix): conectada, mas sem confirmação automática — salve as credenciais de novo.');
        } catch (e) {
          tudoOk = false;
          linhas.push(`Planner (Pix): ${e instanceof Error ? e.message : 'credenciais recusadas'}.`);
        }
      }
    }

    // ── Conta Mercado Pago ──
    // Quando o gateway do Pix é o próprio MP, é a MESMA conta que recebe os dois
    // meios — daí o rótulo mudar em vez de existirem dois testes iguais.
    const recebe = gateway === 'onz' ? 'cartão' : 'Pix e cartão';
    let token: string | null = null;
    try {
      const cifrado = modo === 'teste' ? row?.mercadopago_token_teste : row?.mercadopago_token_producao;
      token = cifrado ? descriptografar(cifrado) : null;
    } catch { token = null; }

    if (!token) {
      // Sem token de cartão com Pix pela Planner não é erro: é uma loja que
      // simplesmente não aceita cartão. Só vira erro quando o MP é o gateway
      // do Pix e mesmo assim não há credencial.
      if (gateway === 'onz') linhas.push('Mercado Pago (cartão): não configurado — o cliente não vê a opção de cartão.');
      else { tudoOk = false; linhas.push(`Mercado Pago: nenhum token de ${modo} salvo.`); }
    } else {
      // `/users/me` é a chamada canônica de "esse token vale?" no Mercado Pago:
      // devolve o dono da conta, não mexe em nada e não tem custo.
      const resposta = await fetch('https://api.mercadopago.com/users/me', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resposta.ok) {
        tudoOk = false;
        linhas.push(resposta.status === 401
          ? 'Mercado Pago: token recusado (401) — revogado, expirado ou colado errado.'
          : `Mercado Pago: respondeu HTTP ${resposta.status}.`);
      } else {
        const dono = await resposta.json().catch(() => ({})) as { nickname?: string; email?: string };
        // Mostrar de QUEM é a conta é o ponto do teste: o erro caro não é "token
        // inválido", é token válido da conta errada — o dinheiro cairia certinho,
        // na conta de outra pessoa, sem nenhum erro aparecer.
        linhas.push(`Mercado Pago (${recebe}): conta ${dono.nickname || dono.email || 'conectada'}, em ${modo === 'teste' ? 'TESTE' : 'produção'}.`);
      }
    }

    return res.json({ ok: tudoOk, detalhe: linhas.join(' ') });
  } catch (e) { next(e); }
});

/** Salva/limpa o token de teste e/ou produção, e/ou troca o modo ativo — cada campo só mexe se vier no corpo. */
router.put('/pagamentos', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    const sets: string[] = [];
    const vals: unknown[] = [];

    // ── Credenciais da conta ONZ DA LOJA (cada cliente tem a própria) ──
    // Vêm antes da troca de gateway pra que salvar credencial + ativar ONZ numa
    // só requisição funcione (a validação do gateway abaixo já vê o novo valor).
    let onzMudou = false;
    if (typeof req.body.onz_client_id === 'string') {
      const v = req.body.onz_client_id.trim();
      sets.push('onz_client_id = ?');
      vals.push(v ? criptografar(v) : null);
      onzMudou = true;
    }
    if (typeof req.body.onz_client_secret === 'string') {
      const v = req.body.onz_client_secret.trim();
      sets.push('onz_client_secret = ?');
      vals.push(v ? criptografar(v) : null);
      onzMudou = true;
    }
    /*
     * RECEBEDOR DO CARTÃO: token do Mercado Pago DA LOJA.
     *
     * Sem ele o cartão não é oferecido (ver `cartaoOnlineAtivo`) — de propósito: o
     * token é o que determina em qual conta o dinheiro cai, e cair na conta da
     * plataforma sem ninguém pedir é o pior resultado possível.
     *
     * Cifrado no banco, igual às credenciais da ONZ. A tela só recebe de volta uma
     * máscara; o valor em claro nunca sai daqui.
     */
    if (typeof req.body.mercadopago_token_producao === 'string') {
      const v = req.body.mercadopago_token_producao.trim();
      sets.push('mercadopago_token_producao = ?');
      vals.push(v ? criptografar(v) : null);
    }
    if (typeof req.body.mercadopago_token_teste === 'string') {
      const v = req.body.mercadopago_token_teste.trim();
      sets.push('mercadopago_token_teste = ?');
      vals.push(v ? criptografar(v) : null);
    }
    /*
     * ASSINATURA DO WEBHOOK DESTA LOJA. Por loja porque o Mercado Pago emite uma
     * por aplicação, e cada lojista usa a conta dele — um segredo global
     * validaria uma loja e descartaria a notificação de todas as outras.
     */
    // PUBLIC KEY em claro: ela vai pro navegador de todo cliente montar o
    // formulário de cartão. Cifrar daria falsa sensação de segredo.
    if (typeof req.body.mercadopago_public_key === 'string') {
      const v = req.body.mercadopago_public_key.trim();
      if (v && !v.startsWith('APP_USR-') && !v.startsWith('TEST-')) {
        throw erroHttp(400, 'Public key inválida: ela começa com APP_USR- ou TEST-.');
      }
      sets.push('mercadopago_public_key = ?');
      vals.push(v || null);
    }
    if (typeof req.body.mercadopago_webhook_secret === 'string') {
      const v = req.body.mercadopago_webhook_secret.trim();
      sets.push('mercadopago_webhook_secret = ?');
      vals.push(v ? criptografar(v) : null);
    }
    if (req.body.mercadopago_modo === 'teste' || req.body.mercadopago_modo === 'producao') {
      sets.push('mercadopago_modo = ?');
      vals.push(req.body.mercadopago_modo);
    }

    if (typeof req.body.onz_pix_key === 'string') {
      const v = req.body.onz_pix_key.trim();
      // A chave Pix não é segredo (vai no QR Code), então fica em claro.
      sets.push('onz_pix_key = ?');
      vals.push(v || null);
      onzMudou = true;
    }

    if (req.body.gateway !== undefined) {
      if (req.body.gateway !== 'mercadopago' && req.body.gateway !== 'onz') {
        throw erroHttp(400, 'Gateway inválido (use "mercadopago" ou "onz").');
      }
      sets.push('pagamento_gateway = ?');
      vals.push(req.body.gateway);
    }
    if (req.body.modo !== undefined) {
      if (req.body.modo !== 'teste' && req.body.modo !== 'producao') {
        throw erroHttp(400, 'Modo inválido (use "teste" ou "producao").');
      }
      sets.push('mercadopago_modo = ?');
      vals.push(req.body.modo);
    }
    if (typeof req.body.token_teste === 'string') {
      const v = req.body.token_teste.trim();
      /*
       * ACEITA APP_USR- NO SLOT DE TESTE, de propósito.
       *
       * A homologação oficial do Checkout Pro é feita com uma CONTA DE TESTE
       * vendedora, e o token dela sai na aba "Credenciais de produção" — começa
       * com APP_USR- mesmo sendo uma conta fictícia. Exigir TEST- aqui bloqueava
       * justamente o caminho que o Mercado Pago manda seguir.
       */
      if (v && !v.startsWith('TEST-') && !v.startsWith('APP_USR-')) {
        throw erroHttp(400, 'Token inválido: deve começar com TEST- (credencial de teste) ou APP_USR- (conta de teste vendedora).');
      }
      sets.push('mercadopago_token_teste = ?');
      vals.push(v ? criptografar(v) : null);
    }
    if (typeof req.body.token_producao === 'string') {
      const v = req.body.token_producao.trim();
      if (v && !v.startsWith('APP_USR-')) throw erroHttp(400, 'O token de produção deve começar com APP_USR-.');
      sets.push('mercadopago_token_producao = ?');
      vals.push(v ? criptografar(v) : null);
    }
    if (sets.length > 0) {
      await db.prepare(`UPDATE lojas SET ${sets.join(', ')} WHERE id = ?`).run(...vals, loja.id);
    }

    // Gateway 'onz' exige credencial (da loja ou da plataforma) — checado DEPOIS
    // do UPDATE, pra ver o estado final (ex.: salvar credencial e ativar de uma vez).
    if (req.body.gateway === 'onz') {
      const cred = await credenciaisOnzDaLoja(loja.id);
      if (!cashInDisponivel(cred)) {
        // Desfaz a ativação pra loja não ficar com Pix "ligado" sem funcionar.
        await db.prepare("UPDATE lojas SET pagamento_gateway = 'mercadopago' WHERE id = ?").run(loja.id);
        throw erroHttp(400, 'Preencha as credenciais da sua conta ONZ (Client ID, Client Secret e chave Pix) antes de ativar.');
      }
    }

    // Registra o webhook automaticamente ao salvar credenciais: é por chave Pix,
    // então cada loja precisa do seu. Fazer aqui é o que evita ter que rodar
    // script no servidor a cada cliente novo. Best-effort: se falhar, o Pix
    // ainda funciona (só a confirmação automática fica pendente), e o motivo vai
    // no log e na resposta.
    let avisoWebhook: string | null = null;
    if (onzMudou) {
      const cred = await credenciaisOnzDaLoja(loja.id);
      const tk = process.env.ONZ_WEBHOOK_TOKEN || '';
      if (cred && tk) {
        const base = `${req.protocol}://${req.get('host')}`;
        const url = `${base}/api/pagamentos/webhook/onz?tk=${encodeURIComponent(tk)}&t=${encodeURIComponent(bancoTenantAtual())}`;
        try {
          await registrarWebhookCashIn(url, cred);
        } catch (e) {
          avisoWebhook = 'Credenciais salvas, mas não consegui registrar a confirmação automática de pagamento na ONZ. Fale com o suporte.';
          console.error(`[onz] falha ao registrar webhook da loja ${loja.id}:`, e);
        }
      } else if (cred && !tk) {
        avisoWebhook = 'Credenciais salvas, mas o servidor não tem ONZ_WEBHOOK_TOKEN configurado — a confirmação automática não vai funcionar.';
        console.error('[onz] ONZ_WEBHOOK_TOKEN ausente: webhook da loja não registrado.');
      }
    }

    const row = await db.prepare(
      'SELECT mercadopago_token_teste, mercadopago_token_producao, mercadopago_modo, pagamento_gateway FROM lojas WHERE id = ?'
    ).get(loja.id) as
      { mercadopago_token_teste: string | null; mercadopago_token_producao: string | null; mercadopago_modo: string; pagamento_gateway: string | null };
    const modo: 'teste' | 'producao' = row.mercadopago_modo === 'teste' ? 'teste' : 'producao';
    const descriptografarOuNulo = (c: string | null) => {
      if (!c) return null;
      try { return descriptografar(c); } catch { return null; }
    };
    const tokenTeste = descriptografarOuNulo(row.mercadopago_token_teste);
    const tokenProducao = descriptografarOuNulo(row.mercadopago_token_producao);
    const gateway = row.pagamento_gateway === 'onz' ? 'onz' : 'mercadopago';
    const credOnz = await credenciaisOnzDaLoja(loja.id);
    const onzDisponivel = cashInDisponivel(credOnz);
    res.json({
      ok: true,
      gateway,
      onz_disponivel: onzDisponivel,
      onz_conta_propria: !!credOnz,
      onz_client_id_mascarado: mascarar(credOnz?.clientId ?? null),
      onz_pix_key: credOnz?.chavePix ?? '',
      ...(avisoWebhook ? { aviso: avisoWebhook } : {}),
      modo,
      ativo: gateway === 'onz' ? onzDisponivel : (modo === 'teste' ? !!tokenTeste : !!tokenProducao),
      token_teste_mascarado: mascarar(tokenTeste),
      token_producao_mascarado: mascarar(tokenProducao),
      /*
       * CARTÃO ONLINE exige conta PRÓPRIA do Mercado Pago — não vale o token da
       * plataforma, senão o dinheiro do cartão cairia na conta dela. Por isso é um
       * campo separado de `ativo`, que aceita o gateway de Pix da loja.
       */
      cartao_online_ativo: !!(modo === 'teste' ? tokenTeste : tokenProducao),
    });
  } catch (e) { next(e); }
});

// ----- NFC-e (dados fiscais + certificado A1) -----------------------------

/** Retorna a configuração fiscal da loja + status do certificado (sem segredos). */
router.get('/nfce', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req) as any;
    const temCert = fs.existsSync(caminhoCertificado(loja.id));
    res.json({
      config: {
        ativo: loja.nfce_ativo, cnpj: loja.nfce_cnpj, ie: loja.nfce_ie,
        razao_social: loja.nfce_razao_social, nome_fantasia: loja.nfce_nome_fantasia,
        crt: loja.nfce_crt, uf: loja.nfce_uf, cmun: loja.nfce_cmun, municipio: loja.nfce_municipio,
        logradouro: loja.nfce_logradouro, numero: loja.nfce_numero, bairro: loja.nfce_bairro, cep: loja.nfce_cep,
        csc_id: loja.nfce_csc_id, ambiente: loja.nfce_ambiente, serie: loja.nfce_serie,
        proximo_numero: loja.nfce_proximo_numero,
        ncm_padrao: loja.nfce_ncm_padrao || '21069090',
        cfop_padrao: loja.nfce_cfop_padrao || '5102',
        csosn_padrao: loja.nfce_csosn_padrao || '102',
        // segredos nunca saem: csc e senha do cert não são retornados
        tem_csc: !!loja.nfce_csc,
      },
      certificado: {
        instalado: temCert,
        titular: loja.nfce_cert_titular || null,
        validade: loja.nfce_cert_validade || null,
      },
    });
  } catch (e) { next(e); }
});

/** Salva os dados fiscais da loja. */
router.put('/nfce', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    const b = req.body;
    const txt = (v: unknown, n: number) => textoLimpo(v, n);
    await db.prepare(
      `UPDATE lojas SET
         nfce_ativo = ?, nfce_cnpj = ?, nfce_ie = ?, nfce_razao_social = ?, nfce_nome_fantasia = ?,
         nfce_crt = ?, nfce_uf = ?, nfce_cmun = ?, nfce_municipio = ?,
         nfce_logradouro = ?, nfce_numero = ?, nfce_bairro = ?, nfce_cep = ?,
         nfce_csc_id = ?, nfce_ambiente = ?, nfce_serie = ?,
         nfce_ncm_padrao = ?, nfce_cfop_padrao = ?, nfce_csosn_padrao = ?
       WHERE id = ?`
    ).run(
      b.ativo ? 1 : 0,
      txt(b.cnpj, 14).replace(/\D/g, ''), txt(b.ie, 20), txt(b.razao_social, 120), txt(b.nome_fantasia, 120),
      Number(b.crt) || 1, txt(b.uf, 2).toUpperCase(), txt(b.cmun, 7).replace(/\D/g, ''), txt(b.municipio, 80),
      txt(b.logradouro, 120), txt(b.numero, 20), txt(b.bairro, 80), txt(b.cep, 8).replace(/\D/g, ''),
      txt(b.csc_id, 10), Number(b.ambiente) === 1 ? 1 : 2, Number(b.serie) || 1,
      txt(b.ncm_padrao, 8).replace(/\D/g, '') || '21069090',
      txt(b.cfop_padrao, 4).replace(/\D/g, '') || '5102',
      txt(b.csosn_padrao, 3).replace(/\D/g, '') || '102',
      loja.id,
    );
    // CSC é segredo fiscal: gravado CRIPTOGRAFADO (nunca volta no GET).
    if (typeof b.csc === 'string' && b.csc.trim()) {
      await db.prepare('UPDATE lojas SET nfce_csc = ? WHERE id = ?').run(criptografar(b.csc.trim()), loja.id);
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/** Lista todos os produtos com seus campos fiscais (NCM, CFOP, CSOSN…). */
router.get('/fiscal/produtos', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    const produtos = await db.prepare(
      `SELECT id, nome, categoria, ncm, cfop, csosn, origem, unidade_comercial, cest
         FROM produtos WHERE loja_id = ? AND excluido = 0 ORDER BY categoria, nome`
    ).all(loja.id);
    res.json({ produtos });
  } catch (e) { next(e); }
});

/** Atualiza os campos fiscais de um produto específico. */
router.put('/fiscal/produtos/:id', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    const produto = await meuProduto(loja, req.params.id);
    const txt = (v: unknown, n: number) => textoLimpo(v, n);
    await db.prepare(
      `UPDATE produtos SET ncm = ?, cfop = ?, csosn = ?, origem = ?, unidade_comercial = ?, cest = ? WHERE id = ?`
    ).run(
      txt(req.body.ncm, 8).replace(/\D/g, ''),
      txt(req.body.cfop, 4).replace(/\D/g, ''),
      txt(req.body.csosn, 3).replace(/\D/g, ''),
      txt(req.body.origem, 1),
      txt(req.body.unidade_comercial, 6).toUpperCase() || 'UN',
      txt(req.body.cest, 7).replace(/\D/g, ''),
      produto.id,
    );
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/** Upload do certificado A1 (.pfx) + senha. Valida, grava em pasta protegida. */
router.post('/nfce/certificado', uploadCert.single('certificado'), async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    if (!req.file) throw erroHttp(400, 'Envie o arquivo do certificado (.pfx).');
    const senha = typeof req.body.senha === 'string' ? req.body.senha : '';
    if (!senha) throw erroHttp(400, 'Informe a senha do certificado.');

    // Valida abrindo o certificado (senha errada / arquivo inválido → 400).
    let cert;
    try {
      cert = validarCertificado(req.file.buffer, senha);
    } catch (err) {
      throw erroHttp(400, err instanceof Error ? err.message : 'Certificado inválido.');
    }

    // Grava o .pfx em pasta protegida (fora da web) e a senha criptografada.
    // 0600: chave privada de assinatura. Sem o mode explicito o umask (0022)
    // grava 0644 — legivel por qualquer usuario do servidor.
    fs.writeFileSync(caminhoCertificado(loja.id), req.file.buffer, { mode: 0o600 });
    await db.prepare(
      'UPDATE lojas SET nfce_cert_senha = ?, nfce_cert_titular = ?, nfce_cert_validade = ? WHERE id = ?'
    ).run(criptografar(senha), cert.titular, cert.validade, loja.id);

    res.json({ ok: true, titular: cert.titular, validade: cert.validade });
  } catch (e) { next(e); }
});

/** Monta o EmitenteNfce a partir da config fiscal da loja (decifra o CSC). */
function emitenteDaLoja(loja: any): EmitenteNfce {
  if (!loja.nfce_cnpj || !loja.nfce_uf || !loja.nfce_cmun) {
    throw erroHttp(400, 'Preencha ao menos CNPJ, UF e código do município na aba Fiscal.');
  }
  if (!CODIGO_UF[String(loja.nfce_uf).toUpperCase()]) {
    throw erroHttp(400, `UF inválida: ${loja.nfce_uf}.`);
  }
  let csc = '';
  if (loja.nfce_csc) { try { csc = descriptografar(loja.nfce_csc); } catch { csc = ''; } }
  return {
    cnpj: loja.nfce_cnpj, ie: loja.nfce_ie || 'ISENTO',
    razaoSocial: loja.nfce_razao_social || loja.nome,
    nomeFantasia: loja.nfce_nome_fantasia || loja.nome,
    crt: loja.nfce_crt || 1, uf: loja.nfce_uf, cMun: loja.nfce_cmun, municipio: loja.nfce_municipio || '',
    logradouro: loja.nfce_logradouro || '', numero: loja.nfce_numero || 'S/N',
    bairro: loja.nfce_bairro || '', cep: loja.nfce_cep || '',
    csc, cscId: loja.nfce_csc_id || '', ambiente: loja.nfce_ambiente || 2, serie: loja.nfce_serie || 1,
  };
}

/**
 * Assina o XML se houver certificado A1 instalado; senão devolve sem assinar,
 * com o MOTIVO exato de cada etapa (pra dizer ao lojista por que não assinou).
 */
function assinarSeTiver(loja: any, xml: string): { xml: string; assinado: boolean; motivo?: string } {
  const pfxPath = caminhoCertificado(loja.id);
  if (!fs.existsSync(pfxPath) || !loja.nfce_cert_senha) {
    return { xml, assinado: false, motivo: 'Certificado A1 ainda não instalado.' };
  }
  // 1) Descriptografar a senha salva.
  let senha: string;
  try {
    senha = descriptografar(loja.nfce_cert_senha);
  } catch (e) {
    console.error('[NFC-e] senha do certificado ilegível:', (e as Error).message);
    return { xml, assinado: false, motivo: 'A senha salva do certificado não pôde ser lida (a chave de criptografia do servidor mudou). Reenvie o .pfx clicando em "Substituir".' };
  }
  // 2) Abrir o .pfx com a senha.
  let cert;
  try {
    cert = lerCertificadoPfx(fs.readFileSync(pfxPath), senha);
  } catch (e) {
    console.error('[NFC-e] falha ao abrir o .pfx:', (e as Error).message);
    return { xml, assinado: false, motivo: 'Não foi possível abrir o certificado com a senha salva. Reenvie o .pfx e confira a senha.' };
  }
  // 3) Assinar.
  try {
    return { xml: assinarXmlNfce(xml, cert), assinado: true };
  } catch (e) {
    console.error('[NFC-e] falha ao assinar o XML:', (e as Error).message);
    return { xml, assinado: false, motivo: 'Erro ao assinar o XML: ' + (e as Error).message };
  }
}

/*
 * O MAPA VIROU FUNÇÃO: era um balde só chamado 'cartao', que saía sempre como
 * tPag 03 (crédito). Débito era declarado como crédito na nota, sem erro nenhum
 * aparecer — a SEFAZ autoriza, porque 03 é código válido. Ver
 * `tipo-pagamento-nfce.ts`.
 */

/** Dados estruturados do DANFE (para impressão no cliente). */
function montarDanfeDados(emit: EmitenteNfce, venda: VendaNfce) {
  return {
    emitente: {
      nome: emit.razaoSocial, fantasia: emit.nomeFantasia, cnpj: emit.cnpj,
      endereco: `${emit.logradouro}, ${emit.numero} - ${emit.bairro} - ${emit.municipio}/${emit.uf}`,
    },
    itens: venda.itens.map(i => ({
      codigo: i.codigo,
      descricao: i.descricao, quantidade: i.quantidade, unidade: i.unidade,
      v_unit: i.valorUnitCentavos, v_total: i.valorTotalCentavos,
    })),
    total: venda.totalCentavos - (venda.descontoCentavos || 0),  // líquido (bruto - desconto)
    desconto: venda.descontoCentavos || 0,
    pagamentos: venda.pagamentos.map(p => ({ tipo: p.tipo, valor: p.valorCentavos })),
    numero: venda.numero, serie: emit.serie,
  };
}

/** Monta a resposta completa da NFC-e: XML assinado, QR Code e dados do DANFE. */
async function respostaNfce(loja: any, emit: EmitenteNfce, venda: VendaNfce) {
  const { xml, chave } = montarXmlNfce(emit, venda);
  const assinado = assinarSeTiver(loja, xml);
  const qrUrl = urlQrCode(emit.uf, chave, emit.ambiente, emit.cscId, emit.csc);
  let qrPng = '';
  try { qrPng = await QRCode.toDataURL(qrUrl, { margin: 1, width: 240 }); } catch { /* sem QR */ }
  return {
    chave, assinado: assinado.assinado, motivo_nao_assinado: assinado.motivo,
    ambiente: emit.ambiente, xml: assinado.xml,
    qr_url: qrUrl, qr_png: qrPng, danfe: montarDanfeDados(emit, venda),
  };
}

/**
 * Gera (e assina, se houver certificado) uma NFC-e de TESTE com venda de exemplo.
 * NÃO transmite à SEFAZ — só pra conferir o XML, o DANFE e a assinatura.
 */
router.post('/nfce/teste', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req) as any;
    const emit = emitenteDaLoja(loja);
    const venda: VendaNfce = {
      numero: loja.nfce_proximo_numero || 1,
      dataEmissao: new Date(),
      itens: [{
        codigo: '1', descricao: 'PRODUTO TESTE',
        ncm: loja.nfce_ncm_padrao || '21069090',
        cfop: loja.nfce_cfop_padrao || '5102',
        csosn: loja.nfce_csosn_padrao || '102',
        origem: '0', unidade: 'UN', quantidade: 1, valorUnitCentavos: 100, valorTotalCentavos: 100,
      }],
      pagamentos: [{ tipo: 'dinheiro', valorCentavos: 100 }],
      totalCentavos: 100,
    };
    res.json(await respostaNfce(loja, emit, venda));
  } catch (e) { next(e); }
});

/** Monta a VendaNfce a partir de um pedido real (itens + pagamento + total). */
async function vendaDoPedido(loja: any, pedido: any, numero: number): Promise<VendaNfce> {
  const itens = await db.prepare(
    `SELECT i.nome_produto, i.preco_unit_centavos, i.quantidade, i.produto_id,
            p.ncm, p.cfop, p.csosn, p.origem, p.unidade_comercial, p.codigo_barras
       FROM itens_pedido i LEFT JOIN produtos p ON p.id = i.produto_id
      WHERE i.pedido_id = ?`
  ).all(pedido.id) as any[];
  if (itens.length === 0) throw erroHttp(400, 'Venda sem itens.');

  const itensNfce = itens.map(it => ({
    // `cProd` ESTÁVEL: o GTIN do produto, ou P+id. Era `String(idx + 1)` — o
    // índice do item na venda —, então o mesmo produto saía com código diferente
    // em cada nota e nada ligava a NFC-e ao cadastro (ver codigo-produto.ts).
    codigo: codigoProdutoNfce(it.produto_id, it.codigo_barras),
    codigoBarras: it.codigo_barras || '',
    descricao: it.nome_produto,
    ncm: it.ncm || loja.nfce_ncm_padrao || '21069090',
    cfop: it.cfop || loja.nfce_cfop_padrao || '5102',
    csosn: it.csosn || loja.nfce_csosn_padrao || '102',
    origem: it.origem || '0', unidade: it.unidade_comercial || 'UN',
    quantidade: it.quantidade, valorUnitCentavos: it.preco_unit_centavos,
    valorTotalCentavos: it.preco_unit_centavos * it.quantidade,
  }));
  const totalProdutos = itensNfce.reduce((s, i) => s + i.valorTotalCentavos, 0);
  // Desconto/cupom do pedido: vira <vDesc> na nota; o pagamento reflete o LÍQUIDO
  // (o que o cliente realmente pagou), não o bruto dos produtos.
  const desconto = Math.min(Math.max(pedido.desconto_centavos || 0, 0), totalProdutos);
  return {
    numero,
    dataEmissao: new Date(),
    itens: itensNfce,
    pagamentos: [{
      // `pagamento_tipo` é o que o gateway devolveu (credit_card, debit_card…).
      tipo: tipoPagamentoNfce(pedido.forma_pagamento, (pedido as unknown as { pagamento_tipo?: string }).pagamento_tipo).tipo,
      valorCentavos: totalProdutos - desconto,
    }],
    totalCentavos: totalProdutos,
    descontoCentavos: desconto,
  };
}

/**
 * Gera a NFC-e (teste/local) de uma VENDA REAL já registrada. NÃO transmite.
 */
router.post('/nfce/gerar/:pedidoId', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req) as any;
    const pedido = await db.prepare('SELECT * FROM pedidos WHERE id = ? AND loja_id = ?')
      .get(req.params.pedidoId, loja.id) as any;
    if (!pedido) throw erroHttp(404, 'Venda não encontrada.');

    const emit = emitenteDaLoja(loja);
    const venda = await vendaDoPedido(loja, pedido, loja.nfce_proximo_numero || 1);
    res.json(await respostaNfce(loja, emit, venda));
  } catch (e) { next(e); }
});

/**
 * Lê o certificado A1 já em PEM (chave + cert), usado tanto pra ASSINAR quanto
 * pro TLS mútuo com a SEFAZ. Ler via node-forge (não passar o .pfx cru pro
 * OpenSSL) é o que faz o A1 legado funcionar no Node 18+/OpenSSL 3 do servidor.
 */
function certificadoParaTls(loja: any): CertificadoLido {
  const pfxPath = caminhoCertificado(loja.id);
  if (!fs.existsSync(pfxPath) || !loja.nfce_cert_senha) {
    throw erroHttp(400, 'Instale o certificado A1 (.pfx) antes de emitir para a SEFAZ.');
  }
  try {
    return lerCertificadoPfx(fs.readFileSync(pfxPath), descriptografar(loja.nfce_cert_senha));
  } catch {
    throw erroHttp(400, 'Não foi possível ler o certificado A1. Reenvie o .pfx e confira a senha.');
  }
}

/**
 * Reserva o próximo número da loja de forma atômica (evita números duplicados).
 * `FOR UPDATE` trava a linha durante a transação: uma segunda chamada
 * concorrente pro mesmo lojaId espera a primeira commitar antes de ler —
 * sem isso, dois cliques rápidos (ou dois pedidos entregues quase juntos,
 * que disparam emissão automática) podiam ler o mesmo número e transmitir
 * duas NFC-e duplicadas à SEFAZ.
 */
async function reservarNumero(lojaId: number): Promise<number> {
  return comTransacao(async (tx) => {
    const row = await tx.prepare('SELECT nfce_proximo_numero AS n FROM lojas WHERE id = ? FOR UPDATE').get(lojaId) as { n: number };
    const numero = row?.n || 1;
    await tx.prepare('UPDATE lojas SET nfce_proximo_numero = ? WHERE id = ?').run(numero + 1, lojaId);
    return numero;
  });
}

/**
 * Núcleo da emissão: reserva número → monta → assina → TRANSMITE → persiste.
 * `pedidoId` null = teste avulso (sem pedido). Retorna o resumo da resposta.
 */
async function emitirVendaNfce(loja: any, venda: VendaNfce, pedidoId: number | null) {
  const emit = emitenteDaLoja(loja);
  const certA1 = certificadoParaTls(loja);
  const { xml, chave } = montarXmlNfce(emit, venda);

  // Assinatura é obrigatória para transmitir.
  let xmlAssinado: string;
  try {
    xmlAssinado = assinarXmlNfce(xml, certA1);
  } catch {
    throw erroHttp(400, 'Falha ao assinar a NFC-e. Verifique o certificado e a senha.');
  }

  const qrUrl = urlQrCode(emit.uf, chave, emit.ambiente, emit.cscId, emit.csc);
  const agora = agoraUTC();

  let resultado;
  try {
    resultado = await transmitirNfce(xmlAssinado, {
      uf: emit.uf, ambiente: emit.ambiente, key: certA1.chavePrivadaPem, cert: certA1.certificadoPem, chave,
    });
  } catch (e: any) {
    await db.prepare(
      `INSERT INTO notas_fiscais (loja_id, pedido_id, modelo, serie, numero, chave, ambiente,
                                  status, motivo, xml, qr_url, total_centavos, criado_em)
       VALUES (?, ?, '65', ?, ?, ?, ?, 'erro', ?, ?, ?, ?, ?)`
    ).run(loja.id, pedidoId, emit.serie, venda.numero, chave, emit.ambiente,
          String(e?.message || 'Falha de comunicação com a SEFAZ.'), xmlAssinado, qrUrl, venda.totalCentavos, agora);
    throw erroHttp(502, 'Não foi possível falar com a SEFAZ agora. Tente novamente em instantes.');
  }

  const status = resultado.autorizada ? 'autorizada' : 'rejeitada';
  const info = await db.prepare(
    `INSERT INTO notas_fiscais (loja_id, pedido_id, modelo, serie, numero, chave, ambiente,
                                status, c_stat, motivo, protocolo, xml, qr_url, total_centavos,
                                criado_em, autorizada_em)
     VALUES (?, ?, '65', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(loja.id, pedidoId, emit.serie, venda.numero, chave, emit.ambiente,
        status, resultado.cStat, resultado.motivo, resultado.protocolo,
        resultado.xmlProc, qrUrl, venda.totalCentavos, agora,
        resultado.autorizada ? agora : '');

  let qrPng = '';
  try { qrPng = await QRCode.toDataURL(qrUrl, { margin: 1, width: 240 }); } catch { /* sem QR */ }

  return {
    nota_id: Number(info.lastInsertRowid),
    autorizada: resultado.autorizada,
    status, chave, numero: venda.numero, serie: emit.serie,
    c_stat: resultado.cStat, motivo: resultado.motivo, protocolo: resultado.protocolo,
    qr_url: qrUrl, qr_png: qrPng, ambiente: emit.ambiente, assinado: true,
    xml: resultado.xmlProc, danfe: montarDanfeDados(emit, venda),
  };
}

/**
 * Auto-emissão da NFC-e de um pedido (usada por outros canais: entrega, comanda).
 * NUNCA lança — em erro/rejeição a nota fica registrada com o status. Pula
 * (retorna null) se NFC-e inativa, sem certificado, ou já autorizada.
 * Deve ser chamada DENTRO do contexto de tenant (request).
 */
export async function emitirNfcePedido(pedidoId: number): Promise<{ autorizada: boolean } | null> {
  try {
    const pedido = await db.prepare('SELECT * FROM pedidos WHERE id = ?').get(pedidoId) as any;
    if (!pedido) return null;
    const loja = await db.prepare('SELECT * FROM lojas WHERE id = ?').get(pedido.loja_id) as any;
    if (!loja || !loja.nfce_ativo) return null;
    const ja = await db.prepare("SELECT id FROM notas_fiscais WHERE pedido_id = ? AND status = 'autorizada'").get(pedidoId);
    if (ja) return null;
    const pfxPath = caminhoCertificado(loja.id);
    if (!fs.existsSync(pfxPath) || !loja.nfce_cert_senha) return null; // sem certificado: não dá pra emitir
    // Valida config/certificado ANTES de reservar o número — se alguma dessas
    // chamadas lançar, o número da sequência não é consumido à toa (ver
    // reservarNumero acima: cada reserva incrementa nfce_proximo_numero e não
    // tem como "devolver" o número se a emissão falhar depois).
    emitenteDaLoja(loja);
    certificadoParaTls(loja);
    const numero = await reservarNumero(loja.id);
    const venda = await vendaDoPedido(loja, pedido, numero);
    return await emitirVendaNfce(loja, venda, pedidoId);
  } catch (e) {
    console.error('[nfce] emissão automática falhou:', e);
    return null;
  }
}

/**
 * EMITE a NFC-e de uma venda real (pedido). Autorização síncrona.
 */
router.post('/nfce/emitir/:pedidoId', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req) as any;
    if (!loja.nfce_ativo) throw erroHttp(400, 'Ative a emissão de NFC-e na aba Fiscal.');

    const pedido = await db.prepare('SELECT * FROM pedidos WHERE id = ? AND loja_id = ?')
      .get(req.params.pedidoId, loja.id) as any;
    if (!pedido) throw erroHttp(404, 'Venda não encontrada.');

    const jaAutorizada = await db.prepare(
      "SELECT id, chave FROM notas_fiscais WHERE pedido_id = ? AND status = 'autorizada'"
    ).get(pedido.id) as any;
    if (jaAutorizada) throw erroHttp(409, `Esta venda já tem NFC-e autorizada (chave ${jaAutorizada.chave}).`);

    // Valida ANTES de reservar o número (ver comentário em emitirNfcePedido).
    emitenteDaLoja(loja);
    certificadoParaTls(loja);
    const numero = await reservarNumero(loja.id);
    const venda = await vendaDoPedido(loja, pedido, numero);
    const r = await emitirVendaNfce(loja, venda, pedido.id);
    res.status(r.autorizada ? 201 : 422).json(r);
  } catch (e) { next(e); }
});

/**
 * TESTA a emissão contra a SEFAZ com uma venda de exemplo (transmite de verdade).
 * Serve pro lojista validar certificado + CSC em homologação e ver o cStat na tela.
 */
router.post('/nfce/testar-sefaz', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req) as any;
    if (!loja.nfce_ativo) throw erroHttp(400, 'Ative a emissão de NFC-e na aba Fiscal.');
    // Valida ANTES de reservar o número (ver comentário em emitirNfcePedido).
    emitenteDaLoja(loja);
    certificadoParaTls(loja);
    const numero = await reservarNumero(loja.id);
    const venda: VendaNfce = {
      numero,
      dataEmissao: new Date(),
      itens: [{
        codigo: '1', descricao: 'PRODUTO TESTE',
        ncm: loja.nfce_ncm_padrao || '21069090',
        cfop: loja.nfce_cfop_padrao || '5102',
        csosn: loja.nfce_csosn_padrao || '102',
        origem: '0', unidade: 'UN', quantidade: 1, valorUnitCentavos: 100, valorTotalCentavos: 100,
      }],
      pagamentos: [{ tipo: 'dinheiro', valorCentavos: 100 }],
      totalCentavos: 100,
    };
    const r = await emitirVendaNfce(loja, venda, null);
    res.json(r); // sempre 200: é diagnóstico; a flag `autorizada` diz o resultado
  } catch (e) { next(e); }
});

/**
 * Pedidos de DELIVERY entregues + o status da NFC-e de cada um (janela para
 * emitir/reemitir a nota de cada venda de delivery).
 */
router.get('/nfce/pedidos-delivery', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    const pedidos = await db.prepare(
      `SELECT p.id, u.nome AS cliente_nome, p.total_centavos, p.forma_pagamento,
              p.criado_em,
              nf.id AS nota_id, nf.status AS nota_status, nf.numero AS nota_numero,
              nf.chave AS nota_chave, nf.c_stat AS nota_cstat, nf.motivo AS nota_motivo,
              nf.protocolo AS nota_protocolo
         FROM pedidos p
         JOIN usuarios u ON u.id = p.cliente_id
         LEFT JOIN notas_fiscais nf ON nf.id = (
           SELECT id FROM notas_fiscais WHERE pedido_id = p.id
            ORDER BY (status = 'autorizada') DESC, id DESC LIMIT 1
         )
        WHERE p.loja_id = ? AND p.origem = 'app' AND p.status = 'entregue'
        ORDER BY p.id DESC LIMIT 100`
    ).all(loja.id);
    res.json({ pedidos });
  } catch (e) { next(e); }
});

/** Lista as NFC-e emitidas da loja (mais recentes primeiro). */
router.get('/nfce/notas', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    const notas = await db.prepare(
      `SELECT id, pedido_id, serie, numero, chave, ambiente, status, c_stat, motivo,
              protocolo, total_centavos, criado_em, autorizada_em
         FROM notas_fiscais WHERE loja_id = ? ORDER BY id DESC LIMIT 200`
    ).all(loja.id);
    res.json({ notas });
  } catch (e) { next(e); }
});

/** Detalhe de uma nota (inclui o XML autorizado para download/impressão). */
router.get('/nfce/notas/:id', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    const nota = await db.prepare('SELECT * FROM notas_fiscais WHERE id = ? AND loja_id = ?')
      .get(req.params.id, loja.id);
    if (!nota) throw erroHttp(404, 'Nota não encontrada.');
    res.json({ nota });
  } catch (e) { next(e); }
});

/* ─────────────── XMLs do mês, o pacote que vai pro contador ─────────────── */

/**
 * Limite nas duas rotas CARAS desta seção.
 *
 * Montar o ZIP lê até 5.000 XMLs do banco e comprime tudo em memória, e o envio
 * ao contador faz isso MAIS uma conexão SMTP. Sem limite, um clique repetido na
 * tela — ou um script — derruba o processo que atende todas as lojas, e ninguém
 * precisa de credencial roubada pra isso: basta uma conta de lojista legítima.
 *
 * 10 em 10 minutos é folgado pro uso real (baixa-se o mês uma vez, no começo do
 * mês) e estreito pra abuso. Chave por CONTA e não por IP, como no upload: a
 * loja inteira costuma sair pelo mesmo IP.
 */
const limiteXmlFiscal = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req.usuario?.id ? `u:${req.usuario.id}` : ipKeyGenerator(req.ip ?? '')),
  message: { erro: 'Muitos downloads seguidos. Aguarde alguns minutos e tente de novo.' },
});

/** Meses que têm nota — é o que a tela oferece pra baixar. */
router.get('/nfce/competencias', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    res.json({ competencias: await competenciasDaLoja(loja.id) });
  } catch (e) { next(e); }
});

/** ZIP com os XMLs do mês — o pacote que o lojista manda pro contador. */
router.get('/nfce/xmls', limiteXmlFiscal, async (req, res, next) => {
  try {
    const loja = await minhaLoja(req) as any;
    const competencia = competenciaValida(req.query.competencia);
    let pacote;
    try {
      pacote = await montarPacoteXml(loja.id, String(loja.slug || ''), competencia);
    } catch (e) {
      // Só estoura por excesso de notas; a mensagem já é a que serve pra tela.
      throw erroHttp(413, e instanceof Error ? e.message : 'Não foi possível montar o arquivo.');
    }
    if (!pacote) {
      throw erroHttp(404, 'Nenhuma nota de produção neste mês. Notas de homologação não entram — elas não têm valor fiscal.');
    }
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${pacote.nome}"`);
    res.send(pacote.conteudo);
  } catch (e) { next(e); }
});

/** Cadastro do contador: pra quem manda, se manda sozinho e em que dia. */
router.get('/nfce/contador', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req) as any;
    res.json({
      email: loja.contador_email || '',
      envio_auto: !!loja.contador_envio_auto,
      dia_envio: Number(loja.contador_dia_envio) || 5,
      ultima_competencia: loja.contador_ultima_competencia || '',
      ultimo_envio_em: loja.contador_ultimo_envio_em || '',
      ultimo_erro: loja.contador_ultimo_erro || '',
      // Sem SMTP configurado o automático nunca sai. A tela precisa dizer isso
      // ANTES de o lojista ligar a chave e confiar que está resolvido.
      email_configurado: emailHabilitado(),
    });
  } catch (e) { next(e); }
});

router.put('/nfce/contador', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req) as any;
    const texto = textoLimpo(req.body.email, 300);
    const validos = destinatariosDe(texto);
    /*
     * Recusa AQUI o endereço torto, com o campo na frente da pessoa. No envio
     * o inválido é só descartado — lá, derrubar a remessa inteira por causa de
     * um endereço errado seria pior que mandar pros que estão certos.
     */
    if (texto && validos.length === 0) throw erroHttp(400, 'E-mail inválido. Separe vários por vírgula.');

    const auto = req.body.envio_auto ? 1 : 0;
    if (auto && validos.length === 0) throw erroHttp(400, 'Cadastre o e-mail do contador antes de ligar o envio automático.');
    const dia = Math.min(Math.max(inteiroPositivo(req.body.dia_envio) || 5, 1), 28);

    await db.prepare(
      `UPDATE lojas SET contador_email = ?, contador_envio_auto = ?, contador_dia_envio = ?
        WHERE id = ?`
    ).run(validos.join(', '), auto, dia, loja.id);
    res.json({ ok: true, email: validos.join(', '), envio_auto: !!auto, dia_envio: dia });
  } catch (e) { next(e); }
});

/**
 * Manda AGORA o mês escolhido. Serve pro lojista testar o cadastro sem esperar
 * a virada, e pra reenviar quando o contador diz que não recebeu.
 */
router.post('/nfce/contador/enviar', limiteXmlFiscal, async (req, res, next) => {
  try {
    const loja = await minhaLoja(req) as any;
    const competencia = competenciaValida(req.body.competencia);
    const r = await enviarPacoteAoContador(loja, competencia);
    if (!r.ok) throw erroHttp(422, r.motivo);
    if (r.notas === 0) throw erroHttp(404, 'Nenhuma nota de produção neste mês — não havia o que enviar.');
    res.json({ ok: true, notas: r.notas });
  } catch (e) { next(e); }
});

/** AAAA-MM ou 400. Mês fora de 01-12 não existe e não vira consulta. */
function competenciaValida(bruto: unknown): string {
  const c = String(bruto ?? '').slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(c)) throw erroHttp(400, 'Informe o mês no formato AAAA-MM.');
  return c;
}

/**
 * CANCELA uma NFC-e autorizada (evento 110111). Exige justificativa (15-255).
 * A janela de cancelamento é curta e varia por UF — a SEFAZ recusa fora do prazo.
 */
router.post('/nfce/notas/:id/cancelar', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req) as any;
    const nota = await db.prepare('SELECT * FROM notas_fiscais WHERE id = ? AND loja_id = ?')
      .get(req.params.id, loja.id) as any;
    if (!nota) throw erroHttp(404, 'Nota não encontrada.');
    if (nota.status !== 'autorizada') throw erroHttp(409, 'Só é possível cancelar uma nota autorizada.');
    if (!nota.protocolo) throw erroHttp(409, 'Nota sem protocolo de autorização — não dá para cancelar.');

    const justificativa = textoLimpo(req.body.justificativa, 255);
    if (justificativa.length < 15) throw erroHttp(400, 'A justificativa deve ter ao menos 15 caracteres.');

    const emit = emitenteDaLoja(loja);
    const certA1 = certificadoParaTls(loja);

    const eventoXml = montarEventoCancelamento({
      uf: emit.uf, ambiente: nota.ambiente, cnpj: emit.cnpj,
      chave: nota.chave, protocolo: nota.protocolo, justificativa,
    });
    let eventoAssinado: string;
    try {
      eventoAssinado = assinarPorTag(eventoXml, certA1, 'infEvento');
    } catch {
      throw erroHttp(400, 'Falha ao assinar o cancelamento. Verifique o certificado.');
    }

    let r;
    try {
      r = await transmitirCancelamento(eventoAssinado, {
        uf: emit.uf, ambiente: nota.ambiente, key: certA1.chavePrivadaPem, cert: certA1.certificadoPem,
      });
    } catch (e: any) {
      throw erroHttp(502, 'Não foi possível falar com a SEFAZ para cancelar. Tente novamente.');
    }

    if (r.ok) {
      // O evento vai em coluna PRÓPRIA. Gravar por cima de `xml` apagava a
      // NFC-e autorizada, e o contador precisa das duas: só o evento não
      // comprova o que foi cancelado.
      await db.prepare(
        "UPDATE notas_fiscais SET status = 'cancelada', c_stat = ?, motivo = ?, xml_cancelamento = ? WHERE id = ?"
      ).run(r.cStat, r.motivo, r.xmlProc, nota.id);
    }
    res.status(r.ok ? 200 : 422).json({
      cancelada: r.ok, c_stat: r.cStat, motivo: r.motivo, protocolo: r.protocolo,
    });
  } catch (e) { next(e); }
});

/**
 * INUTILIZA uma faixa de numeração (série + intervalo) que ficou sem uso —
 * ex.: números "queimados" por rejeições. Exige justificativa (15-255).
 */
router.post('/nfce/inutilizar', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req) as any;
    if (!loja.nfce_ativo) throw erroHttp(400, 'Ative a emissão de NFC-e na aba Fiscal.');

    const serie = inteiroPositivo(req.body.serie) ?? loja.nfce_serie ?? 1;
    const numeroInicial = inteiroPositivo(req.body.numero_inicial);
    const numeroFinal = inteiroPositivo(req.body.numero_final);
    const justificativa = textoLimpo(req.body.justificativa, 255);
    if (!numeroInicial || !numeroFinal) throw erroHttp(400, 'Informe o número inicial e final.');
    if (numeroFinal < numeroInicial) throw erroHttp(400, 'O número final não pode ser menor que o inicial.');
    if (justificativa.length < 15) throw erroHttp(400, 'A justificativa deve ter ao menos 15 caracteres.');

    const emit = emitenteDaLoja(loja);
    const certA1 = certificadoParaTls(loja);

    const inutXml = montarInutilizacao({
      uf: emit.uf, ambiente: emit.ambiente, cnpj: emit.cnpj,
      ano: new Date().getFullYear(), serie, numeroInicial, numeroFinal, justificativa,
    });
    let inutAssinado: string;
    try {
      inutAssinado = assinarPorTag(inutXml, certA1, 'infInut');
    } catch {
      throw erroHttp(400, 'Falha ao assinar a inutilização. Verifique o certificado.');
    }

    let r;
    try {
      r = await transmitirInutilizacao(inutAssinado, {
        uf: emit.uf, ambiente: emit.ambiente, key: certA1.chavePrivadaPem, cert: certA1.certificadoPem,
      });
    } catch (e: any) {
      throw erroHttp(502, 'Não foi possível falar com a SEFAZ para inutilizar. Tente novamente.');
    }
    res.status(r.ok ? 200 : 422).json({
      inutilizada: r.ok, c_stat: r.cStat, motivo: r.motivo, protocolo: r.protocolo,
    });
  } catch (e) { next(e); }
});

// ----- Setores de produção (Cozinha, Bar...) — roteiam a impressão --------

/** Lista os setores da loja, com a quantidade de categorias vinculadas. */
router.get('/setores', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    const setores = await db.prepare(
      `SELECT s.id, s.nome,
              (SELECT COUNT(*) FROM categorias c WHERE c.setor_id = s.id) AS categorias
         FROM setores s WHERE s.loja_id = ? ORDER BY s.nome`
    ).all(loja.id);
    res.json({ setores });
  } catch (e) { next(e); }
});

router.post('/setores', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    const nome = textoLimpo(req.body.nome, 50);
    if (!nome) throw erroHttp(400, 'Informe o nome do setor.');
    let id: number;
    try {
      const info = await db.prepare(
        'INSERT INTO setores (loja_id, nome, criado_em) VALUES (?, ?, ?)'
      ).run(loja.id, nome, agoraUTC());
      id = Number(info.lastInsertRowid);
    } catch {
      throw erroHttp(409, `Já existe um setor "${nome}".`);
    }
    res.status(201).json({ id, nome });
  } catch (e) { next(e); }
});

router.put('/setores/:id', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    const nome = textoLimpo(req.body.nome, 50);
    if (!nome) throw erroHttp(400, 'Informe o nome do setor.');
    const r = await db.prepare('UPDATE setores SET nome = ? WHERE id = ? AND loja_id = ?').run(nome, req.params.id, loja.id);
    if (r.changes === 0) throw erroHttp(404, 'Setor não encontrado.');
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/** Exclui o setor; categorias vinculadas voltam a ficar sem setor (setor_id = NULL). */
router.delete('/setores/:id', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    const r = await comTransacao(async (tx) => {
      await tx.prepare('UPDATE categorias SET setor_id = NULL WHERE setor_id = ? AND loja_id = ?').run(req.params.id, loja.id);
      return tx.prepare('DELETE FROM setores WHERE id = ? AND loja_id = ?').run(req.params.id, loja.id);
    });
    if (r.changes === 0) throw erroHttp(404, 'Setor não encontrado.');
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ----- Categorias do cardápio ---------------------------------------------

/** Formatos da bolha de categoria na vitrine. */
const FORMATOS_CATEGORIA = ['circulo', 'arredondado', 'quadrado'] as const;
/** Tamanhos da faixa de categorias. */
const TAMANHOS_CATEGORIA = ['pequeno', 'medio', 'grande'] as const;


/** Lista categorias (registro + as que existem só nos produtos) + estilo. */
router.get('/categorias', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req) as any;
    const registro = await db.prepare(
      'SELECT nome, icone, imagem, ordem, setor_id FROM categorias WHERE loja_id = ? ORDER BY ordem, nome'
    ).all(loja.id) as Array<{ nome: string; icone: string; imagem: string; ordem: number; setor_id: number | null }>;
    const mapa = new Map(registro.map(r => [r.nome, r]));
    const doProduto = await db.prepare(
      "SELECT DISTINCT categoria FROM produtos WHERE loja_id = ? AND excluido = 0 AND categoria != ''"
    ).all(loja.id) as Array<{ categoria: string }>;
    for (const { categoria } of doProduto) {
      if (!mapa.has(categoria)) {
        const item = { nome: categoria, icone: '', imagem: '', ordem: 999, setor_id: null };
        mapa.set(categoria, item);
        registro.push(item);
      }
    }
    /*
     * A foto que a categoria HERDARIA de um produto, junto.
     *
     * A prévia do editor precisa dela: sem isso ela mostraria ícone onde a loja
     * mostra a foto do produto, e a prévia passaria a mentir — que é o oposto
     * do motivo dela existir.
     */
    const autos = await db.prepare(
      `SELECT categoria, MIN(foto_url) AS foto FROM produtos
        WHERE loja_id = ? AND excluido = 0 AND foto_url <> ''
        GROUP BY categoria`
    ).all(loja.id) as Array<{ categoria: string; foto: string }>;
    const autoMapa = new Map(autos.map(a => [a.categoria, a.foto]));

    const categorias = [...mapa.values()]
      .map(c => ({ ...c, imagem_auto: autoMapa.get(c.nome) || '' }))
      .sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome));
    res.json({
      categorias,
      estilo: loja.categoria_estilo || 'cards',
      formato: loja.categoria_formato || 'circulo',
      tamanho: loja.categoria_tamanho || 'medio',
      todos_imagem: loja.categoria_todos_imagem || '',
      foto_auto: loja.categoria_foto_auto ?? 1,
    });
  } catch (e) { next(e); }
});

/** Salva ícone/ordem/renome/setor das categorias + o estilo de exibição. */
router.put('/categorias', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    const estilo = req.body.estilo === 'chips' ? 'chips' : 'cards';
    // Lista fechada: valor fora dela cairia como classe CSS inexistente na
    // vitrine e a faixa apareceria sem formato nenhum.
    const formato = FORMATOS_CATEGORIA.includes(req.body.formato) ? req.body.formato : 'circulo';
    const tamanho = TAMANHOS_CATEGORIA.includes(req.body.tamanho) ? req.body.tamanho : 'medio';
    const todosImagem = textoLimpo(req.body.todos_imagem, 500);
    // Ausente = mantém ligada, que é o comportamento de sempre.
    const fotoAuto = req.body.foto_auto === undefined ? 1 : (req.body.foto_auto ? 1 : 0);
    const itens: any[] = Array.isArray(req.body.itens) ? req.body.itens : [];

    await comTransacao(async (tx) => {
      await tx.prepare(
        `UPDATE lojas SET categoria_estilo = ?, categoria_formato = ?, categoria_tamanho = ?,
                          categoria_todos_imagem = ?, categoria_foto_auto = ? WHERE id = ?`
      ).run(estilo, formato, tamanho, todosImagem, fotoAuto, loja.id);
      for (let i = 0; i < itens.length; i++) {
        const it = itens[i];
        const nome = textoLimpo(it.nome, 50);
        if (!nome) continue;
        const icone = textoLimpo(it.icone, 16);
        const imagem = textoLimpo(it.imagem, 500);
        const ordem = Number.isFinite(Number(it.ordem)) ? Number(it.ordem) : i;
        const setorId = it.setor_id ? Number(it.setor_id) : null;
        const novo = textoLimpo(it.renomear_para, 50);
        const nomeFinal = novo || nome;
        if (novo && novo !== nome) {
          await tx.prepare('UPDATE produtos SET categoria = ? WHERE loja_id = ? AND categoria = ?').run(nomeFinal, loja.id, nome);
          await tx.prepare('DELETE FROM categorias WHERE loja_id = ? AND nome = ?').run(loja.id, nome);
        }
        await tx.prepare(
          `INSERT INTO categorias (loja_id, nome, icone, imagem, ordem, setor_id, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE icone = VALUES(icone), imagem = VALUES(imagem), ordem = VALUES(ordem), setor_id = VALUES(setor_id)`
        ).run(loja.id, nomeFinal, icone, imagem, ordem, setorId, agoraUTC());
      }
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ----- Relatórios ---------------------------------------------------------

router.get('/relatorios', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    /**
     * PERÍODO EM DIA DE CALENDÁRIO E FUSO DE BRASÍLIA (ver ../periodo.ts).
     *
     * Antes eram "últimas N horas" em UTC, e isso quebrava de dois jeitos: às 10h
     * o faturamento "de hoje" incluía o jantar de ontem, e o corte UTC jogava as
     * vendas das 21h à meia-noite pro dia seguinte. O relatório nunca batia com a
     * gaveta, sem nenhum erro aparente pra investigar.
     *
     * `dia`/`mes` continuam aceitos como apelido de `hoje`/`mes` pra não quebrar
     * link salvo nem a tela antiga durante o deploy.
     */
    const apelidos: Record<string, NomePeriodo> = { dia: 'hoje', hoje: 'hoje', ontem: 'ontem',
      semana: 'semana', mes: 'mes', mes_passado: 'mes_passado', personalizado: 'personalizado' };
    const nomePeriodo = apelidos[String(req.query.periodo || 'hoje')] || 'hoje';
    const intervalo = resolverPeriodo(nomePeriodo, { de: req.query.de, ate: req.query.ate });
    const inicio = intervalo.inicio;
    // FIM importa: sem limite superior, "ontem" e "mês passado" incluiriam tudo
    // até agora — o período fechado viraria "de tal data pra cá".
    const fim = intervalo.fim;
    const periodo = nomePeriodo;

    type Resumo = { pedidos: number; faturamento_centavos: number; comissao_centavos: number; ticket_medio_centavos: number };
    const resumo = await db.prepare(
      `SELECT COUNT(*) AS pedidos,
              COALESCE(SUM(total_centavos), 0)    AS faturamento_centavos,
              COALESCE(SUM(comissao_centavos), 0) AS comissao_centavos,
              COALESCE(AVG(total_centavos), 0)    AS ticket_medio_centavos
         FROM pedidos
        WHERE loja_id = ? AND status = 'entregue' AND criado_em >= ? AND criado_em <= ?`
    ).get(loja.id, inicio, fim) as Resumo;

    const maisVendidos = await db.prepare(
      `SELECT i.nome_produto, SUM(i.quantidade) AS quantidade,
              SUM(i.quantidade * i.preco_unit_centavos) AS total_centavos
         FROM itens_pedido i
         JOIN pedidos p ON p.id = i.pedido_id
        WHERE p.loja_id = ? AND p.status = 'entregue' AND p.criado_em >= ? AND p.criado_em <= ?
        GROUP BY i.nome_produto
        ORDER BY quantidade DESC LIMIT 10`
    ).all(loja.id, inicio, fim);

    /*
     * CURVA ABC — o cardápio INTEIRO, não o top 10.
     *
     * Consulta separada de propósito: a curva precisa de todos os produtos pra o
     * acumulado fechar em 100%, e o "mais vendidos" é limitado a 10 e ordenado por
     * QUANTIDADE. Reaproveitar aquele resultado daria uma curva que só enxerga o
     * topo, com percentuais calculados sobre um total que não é o faturamento.
     */
    const itensDoPeriodo = await db.prepare(
      `SELECT i.nome_produto, SUM(i.quantidade) AS quantidade,
              SUM(i.quantidade * i.preco_unit_centavos) AS total_centavos
         FROM itens_pedido i
         JOIN pedidos p ON p.id = i.pedido_id
        WHERE p.loja_id = ? AND p.status = 'entregue' AND p.criado_em >= ? AND p.criado_em <= ?
        GROUP BY i.nome_produto`
    ).all(loja.id, inicio, fim) as Array<{ nome_produto: string; quantidade: number; total_centavos: number }>;
    const curva = classificarCurvaAbc(itensDoPeriodo);

    // Faturamento por CANAL de venda (delivery do app, balcão, mesa). Sem isto,
    // "R$ 766 hoje" não diz quanto veio do salão e quanto veio da entrega — duas
    // operações com custo e problema completamente diferentes.
    const porCanal = await db.prepare(
      `SELECT origem, COUNT(*) AS qtd, COALESCE(SUM(total_centavos),0) AS total_centavos
         FROM pedidos
        WHERE loja_id = ? AND status = 'entregue' AND criado_em >= ? AND criado_em <= ?
        GROUP BY origem
        ORDER BY total_centavos DESC`
    ).all(loja.id, inicio, fim);

    // Faturamento por forma de pagamento (só entregues).
    const porPagamento = await db.prepare(
      `SELECT forma_pagamento, COUNT(*) AS qtd, COALESCE(SUM(total_centavos),0) AS total_centavos
         FROM pedidos
        WHERE loja_id = ? AND status = 'entregue' AND criado_em >= ? AND criado_em <= ?
        GROUP BY forma_pagamento`
    ).all(loja.id, inicio, fim);

    // Taxa de cancelamento (cancelados + recusados sobre o total de pedidos do período).
    const contagem = await db.prepare(
      `SELECT
          SUM(CASE WHEN status IN ('cancelado','recusado') THEN 1 ELSE 0 END) AS cancelados,
          COUNT(*) AS total
         FROM pedidos WHERE loja_id = ? AND criado_em >= ? AND criado_em <= ?`
    ).get(loja.id, inicio, fim) as { cancelados: number; total: number };
    const taxaCancelamento = contagem.total > 0
      ? Math.round((contagem.cancelados / contagem.total) * 1000) / 10 : 0;

    // Horário de pico — distribuição por hora (Brasília, UTC-3), só entregues.
    // criado_em é ISO-8601 em UTC guardado como string; STR_TO_DATE ignora o
    // sufixo ".000Z" (trailing) e SUBTIME aplica o deslocamento de fuso.
    const porHora = await db.prepare(
      `SELECT HOUR(SUBTIME(STR_TO_DATE(criado_em, '%Y-%m-%dT%H:%i:%s'), '03:00:00')) AS hora,
              COUNT(*) AS qtd
         FROM pedidos
        WHERE loja_id = ? AND status = 'entregue' AND criado_em >= ? AND criado_em <= ?
        GROUP BY hora ORDER BY hora`
    ).all(loja.id, inicio, fim) as Array<{ hora: number; qtd: number }>;

    // Financeiro: bruto, comissão da plataforma e líquido a receber.
    const bruto = resumo.faturamento_centavos;
    const comissao = resumo.comissao_centavos;
    const financeiro = {
      faturamento_bruto_centavos: bruto,
      comissao_plataforma_centavos: comissao,
      liquido_centavos: bruto - comissao,
    };

    /*
     * COMPARAÇÃO COM O PERÍODO ANTERIOR.
     *
     * Número sozinho não informa: "R$ 766 hoje" não diz se o dia foi bom. A mesma
     * consulta do resumo, no intervalo imediatamente anterior de igual tamanho
     * (ver `periodoAnterior` — igual tamanho importa em período parcial).
     */
    const antes = periodoAnterior(intervalo);
    const resumoAntes = await db.prepare(
      `SELECT COUNT(*) AS pedidos,
              COALESCE(SUM(total_centavos), 0) AS faturamento_centavos,
              COALESCE(AVG(total_centavos), 0) AS ticket_medio_centavos
         FROM pedidos
        WHERE loja_id = ? AND status = 'entregue' AND criado_em >= ? AND criado_em <= ?`
    ).get(loja.id, antes.inicio, antes.fim) as { pedidos: number; faturamento_centavos: number; ticket_medio_centavos: number };

    /*
     * ESTOQUE — só de quem tem controle ligado.
     *
     * `valor_centavos` é a PREÇO DE VENDA, não custo: não existe custo cadastrado
     * no sistema (é o que a nota de compra vai trazer). A tela precisa rotular
     * assim, senão o lojista lê como capital parado e o número está inflado pela
     * margem.
     */
    const estoque = await db.prepare(
      `SELECT id, nome, estoque, preco_centavos,
              (estoque * preco_centavos) AS valor_centavos
         FROM produtos
        WHERE loja_id = ? AND excluido = 0 AND controla_estoque = 1
        ORDER BY estoque ASC, nome ASC`
    ).all(loja.id) as Array<{ id: number; nome: string; estoque: number; preco_centavos: number; valor_centavos: number }>;

    res.json({
      periodo,
      // A tela precisa do intervalo REAL pra rotular e nomear o CSV: "mês" sem
      // dizer qual mês é relatório que ninguém consegue arquivar.
      intervalo: { de: intervalo.de, ate: intervalo.ate, rotulo: rotuloPeriodo(intervalo) },
      resumo: { ...resumo, ticket_medio_centavos: Math.round(resumo.ticket_medio_centavos) },
      // `variacao` null = sem base de comparação (período anterior sem venda).
      // A tela diz isso em texto, em vez de mostrar "+100%" pra primeira venda.
      comparacao: {
        intervalo: { de: antes.de, ate: antes.ate, rotulo: rotuloPeriodo(antes) },
        pedidos: resumoAntes.pedidos,
        faturamento_centavos: resumoAntes.faturamento_centavos,
        ticket_medio_centavos: Math.round(resumoAntes.ticket_medio_centavos),
        variacao: {
          pedidos_percent: variacaoPercentual(resumo.pedidos, resumoAntes.pedidos),
          faturamento_percent: variacaoPercentual(resumo.faturamento_centavos, resumoAntes.faturamento_centavos),
          ticket_percent: variacaoPercentual(resumo.ticket_medio_centavos, resumoAntes.ticket_medio_centavos),
        },
      },
      mais_vendidos: maisVendidos,
      curva_abc: { itens: curva, classes: resumirClassesAbc(curva) },
      por_pagamento: porPagamento,
      por_canal: porCanal,
      cancelamento: { cancelados: contagem.cancelados || 0, total: contagem.total || 0, taxa_percent: taxaCancelamento },
      por_hora: porHora,
      financeiro,
      estoque: {
        itens: estoque,
        // `sem_estoque` e `baixo` calculados aqui pra a tela não repetir a regra
        // (e divergir dela no dia em que o limite mudar).
        sem_estoque: estoque.filter(p => p.estoque <= 0).length,
        baixo: estoque.filter(p => p.estoque > 0 && p.estoque <= 5).length,
        valor_total_centavos: estoque.reduce((s, p) => s + p.valor_centavos, 0),
      },
    });
  } catch (e) { next(e); }
});

// ----- Banners da loja (gerenciados pelo próprio lojista) ------------------

router.get('/banners', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    const banners = await db.prepare(
      `SELECT b.id, b.titulo, b.subtitulo, b.imagem, b.produto_id, b.link_url, b.ordem, b.ativo,
              b.botao_texto, p.nome AS produto_nome
         FROM banners b
         LEFT JOIN produtos p ON p.id = b.produto_id
        WHERE b.loja_id = ?
        ORDER BY b.ordem, b.id`
    ).all(loja.id);
    res.json({ banners });
  } catch (e) { next(e); }
});

router.post('/banners', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    const titulo = textoLimpo(req.body.titulo, 120);
    if (titulo.length < 2) throw erroHttp(400, 'Informe um título para o banner.');
    const imagem = textoLimpo(req.body.imagem, 500);
    if (!/^https?:\/\//i.test(imagem) && !imagem.startsWith('/uploads/')) {
      throw erroHttp(400, 'Informe uma URL de imagem válida.');
    }

    const produtoId = inteiroPositivo(req.body.produto_id) || null;
    if (produtoId) {
      const existe = await db.prepare('SELECT 1 FROM produtos WHERE id = ? AND loja_id = ? AND excluido = 0').get(produtoId, loja.id);
      if (!existe) throw erroHttp(400, 'Produto não encontrado na sua loja.');
    }

    // Trava a linha da loja (mutex) dentro da transação: sem isso, duas
    // criações/ativações concorrentes liam a mesma contagem "4 ativos" antes
    // de qualquer INSERT terminar e as duas passavam, estourando o limite de 5.
    const bannerId = await comTransacao(async (tx) => {
      await tx.prepare('SELECT id FROM lojas WHERE id = ? FOR UPDATE').get(loja.id);
      const ativos = (await tx.prepare('SELECT COUNT(*) AS n FROM banners WHERE loja_id = ? AND ativo = 1')
        .get(loja.id) as { n: number }).n;
      if (ativos >= 5) throw erroHttp(400, 'Máximo de 5 banners ativos. Desative um antes de criar outro.');

      const info = await tx.prepare(
        `INSERT INTO banners (titulo, subtitulo, imagem, loja_id, produto_id, link_url, ordem, ativo, botao_texto, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
      ).run(
        titulo,
        textoLimpo(req.body.subtitulo ?? '', 200),
        imagem,
        loja.id,
        produtoId,
        textoLimpo(req.body.link_url ?? '', 500) || null,
        inteiroPositivo(req.body.ordem) || 0,
        textoLimpo(req.body.botao_texto ?? '', 40),
        agoraUTC(),
      );
      return Number(info.lastInsertRowid);
    });
    res.status(201).json({ banner_id: bannerId });
  } catch (e) { next(e); }
});

router.put('/banners/:id', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    const banner = await db.prepare('SELECT * FROM banners WHERE id = ? AND loja_id = ?')
      .get(req.params.id, loja.id) as any | undefined;
    if (!banner) throw erroHttp(404, 'Banner não encontrado.');

    const titulo = req.body.titulo !== undefined ? textoLimpo(req.body.titulo, 120) : banner.titulo;
    if (titulo.length < 2) throw erroHttp(400, 'Título inválido.');
    let imagem = banner.imagem;
    if (req.body.imagem !== undefined) {
      imagem = textoLimpo(req.body.imagem, 500);
      if (!/^https?:\/\//i.test(imagem) && !imagem.startsWith('/uploads/')) {
        throw erroHttp(400, 'URL de imagem inválida.');
      }
    }
    const produtoId = req.body.produto_id !== undefined
      ? (inteiroPositivo(req.body.produto_id) || null)
      : banner.produto_id;

    const novoAtivo = req.body.ativo !== undefined ? (req.body.ativo ? 1 : 0) : banner.ativo;
    const camposUpdate = [
      titulo,
      req.body.subtitulo !== undefined ? textoLimpo(req.body.subtitulo, 200) : banner.subtitulo ?? '',
      imagem,
      produtoId,
      req.body.link_url !== undefined ? (textoLimpo(req.body.link_url, 500) || null) : banner.link_url,
      req.body.ordem !== undefined ? (inteiroPositivo(req.body.ordem) || 0) : banner.ordem,
      novoAtivo,
      req.body.botao_texto !== undefined ? textoLimpo(req.body.botao_texto, 40) : (banner.botao_texto ?? ''),
      banner.id,
    ] as const;
    const SQL_UPDATE = `UPDATE banners SET titulo = ?, subtitulo = ?, imagem = ?, produto_id = ?, link_url = ?, ordem = ?, ativo = ?, botao_texto = ?
        WHERE id = ?`;

    if (novoAtivo === 1 && banner.ativo === 0) {
      // Trava a linha da loja (mutex) e checa+atualiza na MESMA transação —
      // ver comentário equivalente em POST /banners acima.
      await comTransacao(async (tx) => {
        await tx.prepare('SELECT id FROM lojas WHERE id = ? FOR UPDATE').get(loja.id);
        const ativos = (await tx.prepare('SELECT COUNT(*) AS n FROM banners WHERE loja_id = ? AND ativo = 1')
          .get(loja.id) as { n: number }).n;
        if (ativos >= 5) throw erroHttp(400, 'Máximo de 5 banners ativos. Desative outro antes de ativar este.');
        await tx.prepare(SQL_UPDATE).run(...camposUpdate);
      });
    } else {
      await db.prepare(SQL_UPDATE).run(...camposUpdate);
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.delete('/banners/:id', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    const info = await db.prepare('DELETE FROM banners WHERE id = ? AND loja_id = ?').run(req.params.id, loja.id);
    if (info.changes === 0) throw erroHttp(404, 'Banner não encontrado.');
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ----- Cupons de desconto --------------------------------------------------

/** Converte o valor do cupom conforme o tipo: % inteiro ou centavos. */
function parseValorCupom(tipo: string, valorRaw: unknown): number {
  if (tipo === 'percentual') {
    const v = inteiroPositivo(valorRaw);
    if (!v || v > 90) throw erroHttp(400, 'Percentual inválido (use de 1 a 90).');
    return v;
  }
  const c = reaisParaCentavos(valorRaw);
  if (c === null || c <= 0) throw erroHttp(400, 'Valor do desconto inválido.');
  return c;
}

router.get('/cupons', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    const cupons = await db.prepare('SELECT * FROM cupons WHERE loja_id = ? ORDER BY id DESC').all(loja.id);
    res.json({ cupons });
  } catch (e) { next(e); }
});

router.post('/cupons', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    const codigo = textoLimpo(req.body.codigo, 30).toUpperCase().replace(/\s+/g, '');
    if (codigo.length < 3) throw erroHttp(400, 'O código precisa ter ao menos 3 caracteres.');
    const tipo = req.body.tipo === 'fixo' ? 'fixo' : 'percentual';
    const valor = parseValorCupom(tipo, req.body.valor);
    const minimo = req.body.minimo !== undefined ? (reaisParaCentavos(req.body.minimo) || 0) : 0;
    const usosMax = req.body.usos_max !== undefined ? (inteiroPositivo(req.body.usos_max) || 0) : 0;
    const validade = textoLimpo(req.body.validade || '', 30) || null;

    const existe = await db.prepare('SELECT id FROM cupons WHERE loja_id = ? AND codigo = ?').get(loja.id, codigo);
    if (existe) throw erroHttp(409, `Já existe um cupom "${codigo}".`);

    const info = await db.prepare(
      `INSERT INTO cupons (loja_id, codigo, tipo, valor, minimo_centavos, usos_max, usos_count, validade, ativo, criado_em)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, 1, ?)`
    ).run(loja.id, codigo, tipo, valor, minimo, usosMax, validade, agoraUTC());
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  } catch (e) { next(e); }
});

router.put('/cupons/:id', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    const cupom = await db.prepare('SELECT * FROM cupons WHERE id = ? AND loja_id = ?')
      .get(req.params.id, loja.id) as Record<string, unknown> | undefined;
    if (!cupom) throw erroHttp(404, 'Cupom não encontrado.');

    // Toggle rápido de ativo (a tela manda só { ativo }).
    if (req.body.ativo !== undefined && req.body.codigo === undefined) {
      await db.prepare('UPDATE cupons SET ativo = ? WHERE id = ?').run(req.body.ativo ? 1 : 0, cupom.id);
      return res.json({ ok: true });
    }

    const tipo = req.body.tipo === 'fixo' ? 'fixo' : req.body.tipo === 'percentual' ? 'percentual' : String(cupom.tipo);
    const codigo = textoLimpo(req.body.codigo ?? cupom.codigo, 30).toUpperCase().replace(/\s+/g, '');
    const valor = req.body.valor !== undefined ? parseValorCupom(tipo, req.body.valor) : Number(cupom.valor);
    const minimo = req.body.minimo !== undefined ? (reaisParaCentavos(req.body.minimo) || 0) : Number(cupom.minimo_centavos);
    const usosMax = req.body.usos_max !== undefined ? (inteiroPositivo(req.body.usos_max) || 0) : Number(cupom.usos_max);
    const validade = req.body.validade !== undefined ? (textoLimpo(req.body.validade, 30) || null) : (cupom.validade as string | null);

    await db.prepare(
      'UPDATE cupons SET codigo = ?, tipo = ?, valor = ?, minimo_centavos = ?, usos_max = ?, validade = ? WHERE id = ?'
    ).run(codigo, tipo, valor, minimo, usosMax, validade, cupom.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.delete('/cupons/:id', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    const info = await db.prepare('DELETE FROM cupons WHERE id = ? AND loja_id = ?').run(req.params.id, loja.id);
    if (info.changes === 0) throw erroHttp(404, 'Cupom não encontrado.');
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ----- Mesas e Comandas (dine-in / salão) ----------------------------------

router.get('/mesas', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    const mesas = await db.prepare(`
      SELECT m.id, m.numero,
             /*
              * STATUS DERIVADO DA COMANDA, e não da coluna m.status.
              *
              * mesas.status é cache denormalizado, e cache sai de sincronia: bastou
              * uma limpeza de vendas apagar as comandas pra cinco mesas ficarem
              * "ocupada" sem comanda nenhuma. Na tela isso vira uma mesa que diz
              * Ocupada, não abre painel (não há comanda pra mostrar) e não deixa
              * excluir (o botão só aparece em mesa livre) -- travada, sem saída.
              *
              * A comanda aberta É a verdade sobre a mesa estar ocupada. Derivando
              * aqui, qualquer divergência futura some da tela sozinha.
              */
             CASE WHEN c.id IS NULL THEN 'livre' ELSE 'ocupada' END AS status,
             c.id AS comanda_id,
             COALESCE(t.total_centavos, 0) AS comanda_total,
             c.aberto_em AS comanda_aberto_em,
             COALESCE(t.total_itens, 0) AS total_itens
        FROM mesas m
        LEFT JOIN comandas c ON c.mesa_id = m.id AND c.status = 'aberta'
        LEFT JOIN (
          SELECT comanda_id,
                 SUM(preco_unit_centavos * quantidade) AS total_centavos,
                 SUM(quantidade) AS total_itens
            FROM comanda_itens GROUP BY comanda_id
        ) t ON t.comanda_id = c.id
       WHERE m.loja_id = ? AND m.excluida = 0
       ORDER BY CAST(m.numero AS UNSIGNED), m.numero
    `).all(loja.id);
    res.json({ mesas });
  } catch (e) { next(e); }
});

router.post('/mesas', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    const numero = textoLimpo(req.body.numero, 20);
    if (!numero) throw erroHttp(400, 'Informe o número/nome da mesa.');
    const existe = await db.prepare('SELECT id FROM mesas WHERE loja_id = ? AND numero = ? AND excluida = 0').get(loja.id, numero);
    if (existe) throw erroHttp(409, `Já existe uma mesa "${numero}".`);
    const info = await db.prepare(
      "INSERT INTO mesas (loja_id, numero, status, criado_em) VALUES (?, ?, 'livre', ?)"
    ).run(loja.id, numero, agoraUTC());
    res.status(201).json({ mesa_id: Number(info.lastInsertRowid) });
  } catch (e) { next(e); }
});

router.delete('/mesas/:id', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    const mesa = await db.prepare('SELECT id, status FROM mesas WHERE id = ? AND loja_id = ?')
      .get(req.params.id, loja.id) as { id: number; status: string } | undefined;
    if (!mesa) throw erroHttp(404, 'Mesa não encontrada.');
    if (mesa.status === 'ocupada') throw erroHttp(409, 'Feche a comanda antes de excluir a mesa.');
    // Soft delete: comandas históricas referenciam a mesa, então preservamos
    // o registro e apenas o ocultamos da listagem.
    await db.prepare("UPDATE mesas SET excluida = 1 WHERE id = ?").run(mesa.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post('/mesas/:id/abrir', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    const mesa = await db.prepare('SELECT id, status FROM mesas WHERE id = ? AND loja_id = ?')
      .get(req.params.id, loja.id) as { id: number; status: string } | undefined;
    if (!mesa) throw erroHttp(404, 'Mesa não encontrada.');
    /*
     * Recusa pela COMANDA, não pelo campo `status`. Confiando no campo, uma mesa
     * marcada `ocupada` sem comanda (cache dessincronizado) ficava impossível de
     * abrir: a tela mostrava livre, o clique pedia abrir e o servidor respondia
     * "já está ocupada" — sem caminho nenhum pra sair disso.
     */
    const comandaAberta = await db.prepare(
      "SELECT id FROM comandas WHERE mesa_id = ? AND status = 'aberta' LIMIT 1"
    ).get(mesa.id) as { id: number } | undefined;
    if (comandaAberta) throw erroHttp(409, 'Esta mesa já está ocupada.');

    const comandaId = await comTransacao(async (tx) => {
      const info = await tx.prepare(
        "INSERT INTO comandas (loja_id, mesa_id, status, total_centavos, aberto_em) VALUES (?, ?, 'aberta', 0, ?)"
      ).run(loja.id, mesa.id, agoraUTC());
      await tx.prepare("UPDATE mesas SET status = 'ocupada' WHERE id = ?").run(mesa.id);
      return Number(info.lastInsertRowid);
    });

    res.json({ comanda_id: comandaId });
  } catch (e) { next(e); }
});

router.get('/comandas/:id', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    const comanda = await db.prepare(`
      SELECT c.id, c.status, c.forma_pagamento, c.fechado_em,
             c.aberto_em AS aberto_em,
             m.numero AS mesa_numero,
             COALESCE(SUM(ci.preco_unit_centavos * ci.quantidade), 0) AS total_centavos
        FROM comandas c
        JOIN mesas m ON m.id = c.mesa_id
        LEFT JOIN comanda_itens ci ON ci.comanda_id = c.id
       WHERE c.id = ? AND c.loja_id = ?
       GROUP BY c.id
    `).get(req.params.id, loja.id) as Record<string, unknown> | undefined;
    if (!comanda) throw erroHttp(404, 'Comanda não encontrada.');
    const itens = await db.prepare(
      `SELECT ci.*, p.categoria AS categoria
         FROM comanda_itens ci
         LEFT JOIN produtos p ON p.id = ci.produto_id
        WHERE ci.comanda_id = ? ORDER BY ci.id`
    ).all(comanda.id as number);
    res.json({ comanda, itens });
  } catch (e) { next(e); }
});

router.post('/comandas/:id/itens', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    const comanda = await db.prepare("SELECT id, status FROM comandas WHERE id = ? AND loja_id = ?")
      .get(req.params.id, loja.id) as { id: number; status: string } | undefined;
    if (!comanda) throw erroHttp(404, 'Comanda não encontrada.');
    if (comanda.status !== 'aberta') throw erroHttp(409, 'Esta comanda já foi fechada.');

    const quantidade = inteiroPositivo(req.body.quantidade) || 1;
    const observacao = textoLimpo(req.body.observacao || '', 200);
    let nomeProduto: string;
    let precoUnit: number;

    if (req.body.produto_id) {
      const produto = await meuProduto(loja, req.body.produto_id);
      nomeProduto = produto.nome;
      precoUnit = precoVigente(produto, dataBrasilia());
    } else {
      nomeProduto = textoLimpo(req.body.nome_produto || '', 120);
      precoUnit = inteiroPositivo(req.body.preco_unit_centavos) || 0;
      if (!nomeProduto) throw erroHttp(400, 'Informe o produto ou o nome do item.');
    }

    const info = await db.prepare(
      'INSERT INTO comanda_itens (comanda_id, produto_id, nome_produto, preco_unit_centavos, quantidade, observacao) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(comanda.id, req.body.produto_id || null, nomeProduto, precoUnit, quantidade, observacao);
    res.status(201).json({ item_id: Number(info.lastInsertRowid) });
  } catch (e) { next(e); }
});

router.put('/itens-comanda/:id', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    const item = await db.prepare(`
      SELECT ci.id FROM comanda_itens ci
        JOIN comandas c ON c.id = ci.comanda_id
       WHERE ci.id = ? AND c.loja_id = ? AND c.status = 'aberta'
    `).get(req.params.id, loja.id) as { id: number } | undefined;
    if (!item) throw erroHttp(404, 'Item não encontrado.');
    const quantidade = inteiroPositivo(req.body.quantidade);
    if (!quantidade) throw erroHttp(400, 'Quantidade inválida.');
    await db.prepare('UPDATE comanda_itens SET quantidade = ? WHERE id = ?').run(quantidade, item.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.delete('/itens-comanda/:id', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    const item = await db.prepare(`
      SELECT ci.id FROM comanda_itens ci
        JOIN comandas c ON c.id = ci.comanda_id
       WHERE ci.id = ? AND c.loja_id = ? AND c.status = 'aberta'
    `).get(req.params.id, loja.id) as { id: number } | undefined;
    if (!item) throw erroHttp(404, 'Item não encontrado.');
    await db.prepare('DELETE FROM comanda_itens WHERE id = ?').run(item.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

const PAGAMENTO_COMANDA: Record<string, 'pix' | 'dinheiro' | 'cartao_entrega'> = {
  pix: 'pix', dinheiro: 'dinheiro', cartao: 'cartao_entrega',
};

router.post('/comandas/:id/fechar', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    type ComandaRow = { id: number; mesa_id: number; total_centavos: number };
    const comanda = await db.prepare(`
      SELECT c.id, c.mesa_id,
             COALESCE(SUM(ci.preco_unit_centavos * ci.quantidade), 0) AS total_centavos
        FROM comandas c
        LEFT JOIN comanda_itens ci ON ci.comanda_id = c.id
       WHERE c.id = ? AND c.loja_id = ? AND c.status = 'aberta'
       GROUP BY c.id
    `).get(req.params.id, loja.id) as ComandaRow | undefined;
    if (!comanda) throw erroHttp(404, 'Comanda aberta não encontrada.');

    const formaPagamento = PAGAMENTO_COMANDA[String(req.body.forma_pagamento)];
    if (!formaPagamento) throw erroHttp(400, 'Forma de pagamento inválida.');

    type ItemRow = { produto_id: number | null; nome_produto: string; preco_unit_centavos: number; quantidade: number };
    const itens = await db.prepare(
      'SELECT produto_id, nome_produto, preco_unit_centavos, quantidade FROM comanda_itens WHERE comanda_id = ?'
    ).all(comanda.id) as ItemRow[];

    const comissaoPct = await comissaoPercentualDaLoja(loja.id);
    const comissao = Math.round(comanda.total_centavos * comissaoPct / 100);
    const consumidor = await consumidorBalcao(loja);
    const agora = agoraUTC();

    const pedidoId = await comTransacao(async (tx) => {
      let novoPedidoId: number | null = null;
      if (comanda.total_centavos > 0 && itens.length > 0) {
        const info = await tx.prepare(`
          INSERT INTO pedidos
            (cliente_id, loja_id, status, endereco_entrega, forma_pagamento,
             observacoes, subtotal_centavos, taxa_entrega_centavos, total_centavos,
             comissao_percentual, comissao_centavos, pagamento_status, origem,
             criado_em, atualizado_em)
          VALUES (?, ?, 'entregue', 'Consumo no salão', ?, '', ?, 0, ?, ?, ?, 'aprovado', 'balcao', ?, ?)
        `).run(consumidor, loja.id, formaPagamento,
               comanda.total_centavos, comanda.total_centavos,
               comissaoPct, comissao, agora, agora);
        novoPedidoId = Number(info.lastInsertRowid);
        for (const it of itens) {
          await tx.prepare(
            "INSERT INTO itens_pedido (pedido_id, produto_id, nome_produto, preco_unit_centavos, quantidade, opcoes_texto, opcoes_ids) VALUES (?, ?, ?, ?, ?, '', '[]')"
          ).run(novoPedidoId, it.produto_id, it.nome_produto, it.preco_unit_centavos, it.quantidade);
          // Mesma baixa de estoque do balcão, pelo mesmo motivo (consumo no salão
          // sai do mesmo estoque que a venda online). `produto_id` pode ser NULL
          // em item avulso digitado na comanda — aí não há o que baixar.
          if (it.produto_id) {
            await tx.prepare(
              'UPDATE produtos SET estoque = GREATEST(estoque - ?, 0) WHERE id = ? AND controla_estoque = 1'
            ).run(it.quantidade, it.produto_id);
          }
        }
        await tx.prepare('INSERT INTO historico_status (pedido_id, status, criado_em) VALUES (?, ?, ?)')
          .run(novoPedidoId, 'entregue', agora);
      }
      await tx.prepare(
        "UPDATE comandas SET status = 'fechada', total_centavos = ?, forma_pagamento = ?, pedido_id = ?, fechado_em = ? WHERE id = ?"
      ).run(comanda.total_centavos, formaPagamento, novoPedidoId, agora, comanda.id);
      await tx.prepare("UPDATE mesas SET status = 'livre' WHERE id = ?").run(comanda.mesa_id);
      return novoPedidoId;
    });

    res.json({ ok: true, total_centavos: comanda.total_centavos, pedido_id: pedidoId });
  } catch (e) { next(e); }
});

router.post('/comandas/:id/cancelar', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    const comanda = await db.prepare(
      "SELECT id, mesa_id FROM comandas WHERE id = ? AND loja_id = ? AND status = 'aberta'"
    ).get(req.params.id, loja.id) as { id: number; mesa_id: number } | undefined;
    if (!comanda) throw erroHttp(404, 'Comanda aberta não encontrada.');
    await comTransacao(async (tx) => {
      await tx.prepare('DELETE FROM comanda_itens WHERE comanda_id = ?').run(comanda.id);
      await tx.prepare("UPDATE comandas SET status = 'cancelada', fechado_em = ? WHERE id = ?").run(agoraUTC(), comanda.id);
      await tx.prepare("UPDATE mesas SET status = 'livre' WHERE id = ?").run(comanda.mesa_id);
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/**
 * Envia para a cozinha (KDS) os itens da comanda ainda não despachados.
 * Funciona em "rodadas": só manda o que tem enviado_cozinha = 0 e marca como enviado.
 */
router.post('/comandas/:id/enviar-cozinha', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    const comanda = await db.prepare(
      `SELECT c.id, m.numero AS mesa_numero
         FROM comandas c JOIN mesas m ON m.id = c.mesa_id
        WHERE c.id = ? AND c.loja_id = ? AND c.status = 'aberta'`
    ).get(req.params.id, loja.id) as { id: number; mesa_numero: string } | undefined;
    if (!comanda) throw erroHttp(404, 'Comanda aberta não encontrada.');

    const itens = await db.prepare(
      'SELECT id, nome_produto, quantidade, observacao FROM comanda_itens WHERE comanda_id = ? AND enviado_cozinha = 0'
    ).all(comanda.id) as Array<{ id: number; nome_produto: string; quantidade: number; observacao: string }>;
    if (itens.length === 0) throw erroHttp(400, 'Nenhum item novo para enviar à cozinha.');

    const agora = agoraUTC();
    const ticketId = await comTransacao(async (tx) => {
      const info = await tx.prepare(
        "INSERT INTO cozinha_tickets (loja_id, origem, referencia, comanda_id, status, criado_em) VALUES (?, 'mesa', ?, ?, 'na_fila', ?)"
      ).run(loja.id, `Mesa ${comanda.mesa_numero}`, comanda.id, agora);
      const tid = Number(info.lastInsertRowid);
      for (const it of itens) {
        await tx.prepare('INSERT INTO cozinha_ticket_itens (ticket_id, nome_produto, quantidade, observacao) VALUES (?, ?, ?, ?)')
          .run(tid, it.nome_produto, it.quantidade, it.observacao || '');
        await tx.prepare('UPDATE comanda_itens SET enviado_cozinha = 1 WHERE id = ?').run(it.id);
      }
      return tid;
    });

    res.status(201).json({ ticket_id: ticketId, itens_enviados: itens.length });
  } catch (e) { next(e); }
});

router.get('/comandas-historico', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    const comandas = await db.prepare(`
      SELECT c.id, c.status, c.total_centavos, c.forma_pagamento,
             c.aberto_em AS aberto_em, c.fechado_em,
             m.numero AS mesa_numero
        FROM comandas c JOIN mesas m ON m.id = c.mesa_id
       WHERE c.loja_id = ? AND c.status != 'aberta'
       ORDER BY c.id DESC LIMIT 50
    `).all(loja.id);
    res.json({ comandas });
  } catch (e) { next(e); }
});

// ----- WhatsApp -------------------------------------------------------------

/**
 * Lê a config de WhatsApp da loja (sem devolver o token — só se está preenchido).
 * O "não-oficial" é UMA sessão compartilhada de toda a plataforma (não por loja —
 * o plano contratado só permite uma sessão), então aqui é só leitura do status;
 * quem conecta/desconecta é o super admin.
 */
router.get('/whatsapp', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req) as any;
    const naoOficial = loja.whatsapp_permite_nao_oficial ? await statusSessaoPlataforma() : { conectado: false };
    res.json({
      permite_oficial: !!loja.whatsapp_permite_oficial,
      permite_nao_oficial: !!loja.whatsapp_permite_nao_oficial,
      metodo_ativo: loja.whatsapp_metodo_ativo || 'nenhum',
      enviar_confirmacao: !!loja.whatsapp_enviar_confirmacao,
      oficial: {
        numero: loja.whatsapp_oficial_numero || '',
        phone_id: loja.whatsapp_oficial_phone_id || '',
        business_id: loja.whatsapp_oficial_business_id || '',
        template: loja.whatsapp_oficial_template || 'confirmacao_pedido',
        tem_token: !!loja.whatsapp_oficial_token,
      },
      nao_oficial: {
        status: naoOficial.conectado ? 'conectado' : 'desconectado',
        disponivel: await wbapiConfigurado(),
      },
    });
  } catch (e) { next(e); }
});

/** Salva a config do método oficial (Meta Cloud API). Token só é regravado se enviado (não vazio). */
router.put('/whatsapp/oficial', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req) as any;
    if (!loja.whatsapp_permite_oficial) throw erroHttp(403, 'O WhatsApp oficial não está liberado pra esta loja. Fale com o suporte da plataforma.');

    const numero = textoLimpo(req.body.numero, 20).replace(/\D/g, '');
    const phoneId = textoLimpo(req.body.phone_id, 40);
    const businessId = textoLimpo(req.body.business_id, 40);
    const template = textoLimpo(req.body.template, 60) || 'confirmacao_pedido';
    if (!phoneId) throw erroHttp(400, 'Informe o Phone Number ID (Meta Business).');

    if (typeof req.body.token === 'string' && req.body.token.trim()) {
      await db.prepare(
        `UPDATE lojas SET whatsapp_oficial_numero = ?, whatsapp_oficial_phone_id = ?,
                whatsapp_oficial_business_id = ?, whatsapp_oficial_template = ?, whatsapp_oficial_token = ?
          WHERE id = ?`
      ).run(numero, phoneId, businessId, template, criptografar(req.body.token.trim()), loja.id);
    } else {
      await db.prepare(
        `UPDATE lojas SET whatsapp_oficial_numero = ?, whatsapp_oficial_phone_id = ?,
                whatsapp_oficial_business_id = ?, whatsapp_oficial_template = ?
          WHERE id = ?`
      ).run(numero, phoneId, businessId, template, loja.id);
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/** Testa as credenciais oficiais salvas (chamada leve à Graph API). */
router.post('/whatsapp/oficial/testar', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req) as any;
    const r = await testarCredenciaisOficial(loja.whatsapp_oficial_phone_id || '', loja.whatsapp_oficial_token || '');
    if (!r.ok) throw erroHttp(400, r.erro || 'Falha ao testar credenciais.');
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/** Escolhe qual método fica ativo (só entre os liberados pelo admin) e liga/desliga o envio automático. */
router.put('/whatsapp/ativo', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req) as any;
    const metodo = textoLimpo(req.body.metodo, 20);
    if (!['nenhum', 'oficial', 'nao_oficial'].includes(metodo)) throw erroHttp(400, 'Método inválido.');
    if (metodo === 'oficial' && !loja.whatsapp_permite_oficial) throw erroHttp(403, 'WhatsApp oficial não liberado pra esta loja.');
    if (metodo === 'nao_oficial' && !loja.whatsapp_permite_nao_oficial) throw erroHttp(403, 'WhatsApp não oficial não liberado pra esta loja.');

    const enviarConfirmacao = req.body.enviar_confirmacao !== undefined ? (req.body.enviar_confirmacao ? 1 : 0) : loja.whatsapp_enviar_confirmacao;
    await db.prepare('UPDATE lojas SET whatsapp_metodo_ativo = ?, whatsapp_enviar_confirmacao = ? WHERE id = ?')
      .run(metodo, enviarConfirmacao, loja.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});


/* ══════════════════════ CAIXA POR TURNO ══════════════════════
 *
 * Abertura, sangria/suprimento e fechamento com conferência do DINHEIRO.
 * A conta mora em ../caixa.ts (função pura, coberta por teste) — aqui só entram
 * banco e validação.
 *
 * ESCOPO DELIBERADO: conta o dinheiro que entrou NO CAIXA, ou seja vendas de
 * `origem = 'balcao'` (que cobre balcão e mesa). Dinheiro de entrega vai pra mão
 * do ENTREGADOR, não pra gaveta — misturar faria toda conferência fechar errada
 * até o motoboy voltar e prestar contas, que é outro fluxo e não existe ainda.
 */

type CaixaLinha = {
  id: number; loja_id: number; aberto_em: string; valor_abertura_centavos: number;
  status: string; usuario_abertura_nome: string;
};

/** Caixa aberto da loja, ou undefined. */
async function caixaAbertoDaLoja(lojaId: number): Promise<CaixaLinha | undefined> {
  return await db.prepare(
    "SELECT * FROM caixas WHERE loja_id = ? AND status = 'aberto' ORDER BY id DESC LIMIT 1"
  ).get(lojaId) as CaixaLinha | undefined;
}

/** Movimentos e vendas do caixa, já somados. `fim` congela o corte no fechamento. */
async function dadosDoCaixa(caixa: CaixaLinha, fim?: string) {
  const ate = fim || agoraUTC();
  const movs = await db.prepare(
    'SELECT tipo, valor_centavos, cancelado_em FROM caixa_movimentos WHERE caixa_id = ?'
  ).all(caixa.id) as Array<{ tipo: string; valor_centavos: number; cancelado_em: string }>;
  // somarMovimentos IGNORA cancelados — é o par indispensável do cancelamento
  // marcado: contar a linha cancelada faria "desfazer" não desfazer nada.
  const { sangrias_centavos: sangrias, suprimentos_centavos: suprimentos } = somarMovimentos(movs);

  /*
   * `status <> 'cancelado'` e não `= 'entregue'`: venda de balcão nasce já
   * 'entregue', mas se algum dia nascer em outro status a conferência não pode
   * deixar de contar dinheiro que ENTROU na gaveta.
   */
  const vendasBrutas = await db.prepare(
    `SELECT forma_pagamento, total_centavos FROM pedidos
      WHERE loja_id = ? AND origem = 'balcao' AND status <> 'cancelado'
        AND criado_em >= ? AND criado_em <= ?`
  ).all(caixa.loja_id, caixa.aberto_em, ate) as Array<{ forma_pagamento: string; total_centavos: number }>;

  const vendas = somarVendas(vendasBrutas);
  const resumo = montarResumo({
    aberturaCentavos: caixa.valor_abertura_centavos,
    vendas,
    suprimentosCentavos: suprimentos,
    sangriasCentavos: sangrias,
  });
  return { vendas, resumo };
}

/** Últimos fechamentos da loja, com os totais congelados de cada turno. */
async function fechamentosDaLoja(lojaId: number, limite = 10) {
  return db.prepare(
    `SELECT id, aberto_em, fechado_em, usuario_abertura_nome, usuario_fechamento_nome,
            valor_abertura_centavos, valor_contado_centavos, valor_esperado_centavos,
            diferenca_centavos, vendas_dinheiro_centavos, vendas_cartao_centavos,
            vendas_pix_centavos, vendas_quantidade, sangrias_centavos,
            suprimentos_centavos, observacoes
       FROM caixas WHERE loja_id = ? AND status = 'fechado'
      ORDER BY id DESC LIMIT ${limite}`
  ).all(lojaId);
}

/** Situação atual: caixa aberto com resumo ao vivo, ou histórico dos últimos. */
router.get('/caixa', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    const caixa = await caixaAbertoDaLoja(loja.id);
    // O histórico vai nas DUAS respostas: durante o turno é justamente quando se
    // quer comparar com ontem ("ontem faltou 20 também?"), e antes só aparecia
    // com o caixa fechado.
    const historico = await fechamentosDaLoja(loja.id);
    if (!caixa) return res.json({ aberto: null, historico });

    const { vendas, resumo } = await dadosDoCaixa(caixa);
    const movimentos = await db.prepare(
      'SELECT * FROM caixa_movimentos WHERE caixa_id = ? ORDER BY id DESC'
    ).all(caixa.id);
    // Caixa esquecido aberto continua somando as vendas dos dias seguintes; o
    // aviso faz isso aparecer no dia em que ainda dá pra resolver.
    res.json({
      aberto: caixa, vendas, resumo, movimentos, historico,
      tempo: tempoAberto(caixa.aberto_em),
    });
  } catch (e) { next(e); }
});

/** Abre o caixa com o fundo de troco. */
router.post('/caixa/abrir', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    /*
     * Um caixa aberto por LOJA, não por usuário: a gaveta é física. Dois caixas
     * abertos ao mesmo tempo dariam duas respostas pra "quanto deve ter aqui",
     * cada uma contando as MESMAS vendas.
     */
    const abertura = Math.max(0, inteiroPositivo(req.body?.valor_abertura_centavos) || 0);
    const obsAbertura = textoLimpo(req.body?.observacoes, 300);

    /*
     * CHECAR E INSERIR NA MESMA TRANSAÇÃO, com a linha da loja travada.
     *
     * Sem o mutex era checa-depois-insere: dois caixas clicando "abrir" ao mesmo
     * tempo — ou um duplo clique no PDV — liam "nenhum aberto" antes de qualquer
     * INSERT terminar, e os dois passavam. O resultado é exatamente o que o
     * comentário acima diz que não pode existir: dois caixas abertos contando as
     * MESMAS vendas, cada um com o seu "quanto deve ter na gaveta".
     *
     * O índice (loja_id, status) não é único e não impede — travar a linha da
     * loja é o mesmo recurso já usado no limite de banners.
     */
    const id = await comTransacao(async (tx) => {
      await tx.prepare('SELECT id FROM lojas WHERE id = ? FOR UPDATE').get(loja.id);
      const aberto = await tx.prepare(
        "SELECT id FROM caixas WHERE loja_id = ? AND status = 'aberto' LIMIT 1"
      ).get(loja.id);
      if (aberto) {
        throw erroHttp(409, 'Já existe um caixa aberto nesta loja. Feche o atual antes de abrir outro.');
      }
      const info = await tx.prepare(
        `INSERT INTO caixas (loja_id, usuario_abertura_id, usuario_abertura_nome, aberto_em,
                             valor_abertura_centavos, status, observacoes)
         VALUES (?, ?, ?, ?, ?, 'aberto', ?)`
      ).run(loja.id, req.usuario!.id, req.usuario!.nome, agoraUTC(), abertura, obsAbertura);
      return Number(info.lastInsertRowid);
    });
    res.status(201).json({ id });
  } catch (e) { next(e); }
});

/** Sangria (retirada) ou suprimento (reforço de troco). */
router.post('/caixa/movimento', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    const caixa = await caixaAbertoDaLoja(loja.id);
    if (!caixa) throw erroHttp(409, 'Nenhum caixa aberto. Abra o caixa antes de lançar movimento.');

    const tipoBruto = String(req.body?.tipo || '');
    const tipo = tipoBruto === 'suprimento' || tipoBruto === 'sangria' ? tipoBruto : null;
    if (!tipo) throw erroHttp(400, 'Informe o tipo: sangria ou suprimento.');

    const valor = inteiroPositivo(req.body?.valor_centavos) || 0;
    if (valor <= 0) throw erroHttp(400, 'Informe um valor maior que zero.');

    // Motivo obrigatório na SANGRIA: retirada sem justificativa é exatamente o
    // lançamento que ninguém consegue explicar na conferência do fim do dia.
    const motivo = textoLimpo(req.body?.motivo, 200);
    if (tipo === 'sangria' && !motivo) throw erroHttp(400, 'Descreva o motivo da sangria.');

    await db.prepare(
      `INSERT INTO caixa_movimentos (caixa_id, tipo, valor_centavos, motivo, usuario_nome, criado_em)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(caixa.id, tipo, valor, motivo, req.usuario!.nome, agoraUTC());
    res.status(201).json({ ok: true });
  } catch (e) { next(e); }
});

/**
 * CANCELA um movimento lançado errado. Marca, não apaga.
 *
 * Sem isto o operador não tinha saída: sangria de R$ 1.000 no lugar de R$ 100 só
 * se "corrigia" com um suprimento de R$ 900, e o histórico do turno passava a
 * mostrar duas movimentações que nunca aconteceram. Apagar a linha seria pior —
 * some o rastro de que houve erro, que é justamente o que auditoria procura.
 */
router.post('/caixa/movimento/:id/cancelar', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    const caixa = await caixaAbertoDaLoja(loja.id);
    if (!caixa) throw erroHttp(409, 'Nenhum caixa aberto.');

    // Amarra no caixa ABERTO da loja: sem isso, id de movimento de um turno já
    // fechado (ou de outra loja do mesmo tenant) poderia ser cancelado depois,
    // mudando um esperado que alguém já conferiu e assinou.
    const r = await db.prepare(
      `UPDATE caixa_movimentos SET cancelado_em = ?, cancelado_por = ?
        WHERE id = ? AND caixa_id = ? AND cancelado_em = ''`
    ).run(agoraUTC(), req.usuario!.nome, req.params.id, caixa.id);
    if (r.changes === 0) {
      throw erroHttp(409, 'Movimento não encontrado neste caixa, ou já cancelado.');
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/** Fecha o caixa conferindo o dinheiro contado contra o esperado. */
router.post('/caixa/fechar', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    const caixa = await caixaAbertoDaLoja(loja.id);
    if (!caixa) throw erroHttp(409, 'Nenhum caixa aberto pra fechar.');

    if (req.body?.valor_contado_centavos === undefined) {
      throw erroHttp(400, 'Informe o valor contado na gaveta.');
    }
    const contado = Math.max(0, inteiroPositivo(req.body.valor_contado_centavos) || 0);
    const fechadoEm = agoraUTC();

    /*
     * Congela as vendas ATÉ o instante do fechamento: sem o limite, uma venda
     * registrada entre o cálculo e o UPDATE entraria no esperado de um caixa já
     * conferido, criando divergência do nada.
     */
    const { resumo, vendas } = await dadosDoCaixa(caixa, fechadoEm);
    const diferenca = diferencaDeCaixa(contado, resumo.esperado_centavos);
    const obs = textoLimpo(req.body?.observacoes, 300);

    const r = await db.prepare(
      `UPDATE caixas SET status = 'fechado', fechado_em = ?, usuario_fechamento_nome = ?,
              valor_contado_centavos = ?, valor_esperado_centavos = ?, diferenca_centavos = ?,
              vendas_dinheiro_centavos = ?, vendas_cartao_centavos = ?, vendas_pix_centavos = ?,
              vendas_quantidade = ?, sangrias_centavos = ?, suprimentos_centavos = ?,
              observacoes = TRIM(CONCAT(COALESCE(observacoes, ''), ' ', ?))
        WHERE id = ? AND status = 'aberto'`
    ).run(fechadoEm, req.usuario!.nome, contado, resumo.esperado_centavos, diferenca,
          // Totais CONGELADOS aqui: sem isso, "quanto entrou de cartão naquele
          // turno?" só se respondia reconsultando pedidos por data e
          // reconstruindo — e o número já estava calculado, sendo descartado.
          vendas.dinheiro_centavos, vendas.cartao_centavos, vendas.pix_centavos,
          vendas.quantidade, resumo.sangrias_centavos, resumo.suprimentos_centavos,
          obs, caixa.id);

    // UPDATE condicional: se duas abas fecharem junto, só a primeira vale.
    if (r.changes === 0) throw erroHttp(409, 'Este caixa já foi fechado por outra pessoa.');

    res.json({
      resumo,
      vendas,
      valor_contado_centavos: contado,
      diferenca_centavos: diferenca,
      situacao: classificarDiferenca(diferenca),
    });
  } catch (e) { next(e); }
});

export default router;
