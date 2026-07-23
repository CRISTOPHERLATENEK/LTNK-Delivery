/**
 * Módulo do LOJISTA: cadastro/configuração da loja, CRUD completo de
 * produtos com grupos de opções, painel de pedidos e relatórios.
 */
import { Router, Request } from 'express';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import db, { comTransacao, bancoTenantAtual } from '../db-mysql';
import { tenantPorDbNome } from '../tenants-mysql';
import { autenticar, exigirPerfil } from '../auth';
import { agoraUTC, textoLimpo, inteiroPositivo, reaisParaCentavos, erroHttp, lojaAbertaPorAgenda, emailValido, normalizarBairro } from '../util';
import { transicionarStatus } from '../fluxoPedido';
import { enviarPush } from '../push';
import { comissaoPercentualDaLoja } from '../comissao';
import { validarCertificado, lerCertificadoPfx, assinarXmlNfce, assinarPorTag, type CertificadoLido } from '../assinatura';
import QRCode from 'qrcode';
import { montarXmlNfce, urlQrCode, CODIGO_UF, type EmitenteNfce, type VendaNfce } from '../nfce';
import {
  transmitirNfce, montarEventoCancelamento, transmitirCancelamento,
  montarInutilizacao, transmitirInutilizacao,
} from '../sefaz';
import { criptografar, descriptografar } from '../cripto';
import { testarCredenciaisOficial } from '../whatsapp';
import { wbapiConfigurado, statusSessaoPlataforma } from '../whatsapp-nao-oficial';
import { geocodificarTexto } from '../geo';
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
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${base}__loja-${lojaId}.pfx`);
}

// Upload do certificado em memória (validamos antes de gravar em disco).
const uploadCert = multer({ storage: multer.memoryStorage(), limits: { fileSize: 512 * 1024 } });

const router = Router();
router.use(autenticar, exigirPerfil('lojista'));

async function minhaLoja(req: Request, obrigatoria = true): Promise<Loja> {
  const loja = await db.prepare('SELECT * FROM lojas WHERE usuario_id = ?')
    .get(req.usuario!.id) as Loja | undefined;
  if (!loja && obrigatoria) throw erroHttp(404, 'Você ainda não cadastrou sua loja.');
  return loja as Loja;
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
    res.json({ loja, tenant_slug: tenant?.slug ?? null });
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

    // Re-geocodifica só quando o endereço realmente muda (evita bater no
    // Nominatim a cada salvamento de outros campos da loja).
    const enderecoNovo = req.body.endereco !== undefined ? textoLimpo(req.body.endereco, 200) : loja.endereco;
    let lat = lojaQualquer.lat ?? null;
    let lon = lojaQualquer.lon ?? null;
    if (enderecoNovo && enderecoNovo !== loja.endereco) {
      const coord = await geocodificarTexto(enderecoNovo); // best-effort
      lat = coord?.lat ?? null;
      lon = coord?.lon ?? null;
    }

    await db.prepare(
      `UPDATE lojas SET nome = ?, descricao = ?, categoria = ?, endereco = ?, lat = ?, lon = ?,
              taxa_entrega_centavos = ?, tempo_estimado_min = ?, horario_funcionamento = ?,
              logo_url = ?, capa_url = ?, favicon_url = ?, cor_marca = ?, cor_secundaria = ?, slug = ?,
              dominio_personalizado = ?,
              horario_json = ?, auto_horario = ?, minimo_pedido_centavos = ?,
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
          horarioJson, autoHorario, minimoPedido,
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
      'SELECT id, bairro, taxa_centavos FROM zonas_entrega WHERE loja_id = ? ORDER BY bairro'
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
      'INSERT INTO zonas_entrega (loja_id, bairro, taxa_centavos, criado_em) VALUES (?, ?, ?, ?)'
    ).run(loja.id, bairro, taxa, agoraUTC());
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
  servePessoas: number | null; descricao: string; categoria: string; subcategoria: string;
  foto_url: string; destaque: 0 | 1; disponivel: 0 | 1;
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

  let servePessoas: number | null = atual.serve_pessoas ?? null;
  if (corpo.serve_pessoas !== undefined) {
    servePessoas = corpo.serve_pessoas ? inteiroPositivo(corpo.serve_pessoas) : null;
  }

  const vendidoPorRaw = textoLimpo(valor('vendido_por', (atual as any).vendido_por || 'un'), 4);
  const vendidoPor: 'un' | 'kg' = vendidoPorRaw === 'kg' ? 'kg' : 'un';
  // Código de barras: só dígitos (EAN/PLU). Vazio = sem código.
  const codigoBarras = textoLimpo(valor('codigo_barras', (atual as any).codigo_barras || ''), 20).replace(/\D/g, '');

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
    nome, preco, promo, servePessoas,
    descricao: textoLimpo(valor('descricao', atual.descricao || ''), 300),
    categoria: textoLimpo(valor('categoria', atual.categoria), 50) || 'Geral',
    subcategoria: textoLimpo(valor('subcategoria', (atual as any).subcategoria || ''), 80),
    foto_url: textoLimpo(valor('foto_url', atual.foto_url || ''), 500),
    destaque: corpo.destaque !== undefined ? (corpo.destaque ? 1 : 0) : ((atual.destaque || 0) as 0 | 1),
    disponivel: corpo.disponivel !== undefined ? (corpo.disponivel ? 1 : 0) : ((atual.disponivel ?? 1) as 0 | 1),
    vendidoPor, codigoBarras, controlaEstoque, estoque,
  };
}

router.post('/produtos', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    const c = camposProduto(req);
    const info = await db.prepare(
      `INSERT INTO produtos (loja_id, nome, descricao, categoria, subcategoria, preco_centavos,
                             preco_promocional_centavos, serve_pessoas, destaque,
                             foto_url, disponivel, vendido_por, codigo_barras,
                             controla_estoque, estoque, criado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(loja.id, c.nome, c.descricao, c.categoria, c.subcategoria, c.preco, c.promo,
          c.servePessoas, c.destaque, c.foto_url, c.disponivel, c.vendidoPor, c.codigoBarras,
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
              preco_promocional_centavos = ?, serve_pessoas = ?, destaque = ?,
              foto_url = ?, disponivel = ?, vendido_por = ?, codigo_barras = ?,
              controla_estoque = ?, estoque = ? WHERE id = ?`
    ).run(c.nome, c.descricao, c.categoria, c.subcategoria, c.preco, c.promo, c.servePessoas,
          c.destaque, c.foto_url, c.disponivel, c.vendidoPor, c.codigoBarras,
          c.controlaEstoque, c.estoque, produto.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.delete('/produtos/:id', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    const info = await db.prepare(
      'UPDATE produtos SET excluido = 1, disponivel = 0 WHERE id = ? AND loja_id = ? AND excluido = 0'
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
                               foto_url, disponivel, vendido_por, codigo_barras,
                               controla_estoque, estoque, ncm, cfop, csosn, origem,
                               unidade_comercial, cest, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
            `INSERT INTO opcoes_itens (grupo_id, nome, preco_adicional_centavos, disponivel, ordem)
             VALUES (?, ?, ?, ?, ?)`
          ).run(novoGrupoId, o.nome, o.preco_adicional_centavos, o.disponivel, o.ordem);
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
    if (acao === 'ativar') {
      info = await db.prepare(`UPDATE produtos SET disponivel = 1 WHERE loja_id = ? AND excluido = 0 AND id IN (${placeholders})`)
        .run(loja.id, ...ids);
    } else if (acao === 'desativar') {
      info = await db.prepare(`UPDATE produtos SET disponivel = 0 WHERE loja_id = ? AND excluido = 0 AND id IN (${placeholders})`)
        .run(loja.id, ...ids);
    } else {
      info = await db.prepare(`UPDATE produtos SET excluido = 1, disponivel = 0 WHERE loja_id = ? AND excluido = 0 AND id IN (${placeholders})`)
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

router.post('/produtos/:id/grupos', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    const produto = await meuProduto(loja, req.params.id);

    const nome = textoLimpo(req.body.nome, 60);
    const tipo = req.body.tipo === 'multiplo' ? 'multiplo' : 'unico';
    if (nome.length < 2) throw erroHttp(400, 'Informe o nome do grupo (ex.: Tamanho, Borda, Adicionais).');

    const info = await db.prepare(
      `INSERT INTO grupos_opcoes (produto_id, nome, tipo, obrigatorio, max_escolhas, ordem)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(produto.id, nome, tipo,
          req.body.obrigatorio ? 1 : 0,
          inteiroPositivo(req.body.max_escolhas) || 0,
          inteiroPositivo(req.body.ordem) || 0);
    res.status(201).json({ grupo_id: Number(info.lastInsertRowid) });
  } catch (e) { next(e); }
});

router.put('/grupos/:id', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    const grupo = await meuGrupo(loja, req.params.id);
    const nome = req.body.nome !== undefined ? textoLimpo(req.body.nome, 60) : grupo.nome;
    if (nome.length < 2) throw erroHttp(400, 'Nome do grupo inválido.');
    await db.prepare(
      'UPDATE grupos_opcoes SET nome = ?, tipo = ?, obrigatorio = ?, max_escolhas = ? WHERE id = ?'
    ).run(nome,
          req.body.tipo !== undefined ? (req.body.tipo === 'multiplo' ? 'multiplo' : 'unico') : grupo.tipo,
          req.body.obrigatorio !== undefined ? (req.body.obrigatorio ? 1 : 0) : grupo.obrigatorio,
          req.body.max_escolhas !== undefined ? (inteiroPositivo(req.body.max_escolhas) || 0) : grupo.max_escolhas,
          grupo.id);
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
      `INSERT INTO opcoes_itens (grupo_id, nome, preco_adicional_centavos, disponivel, ordem)
       VALUES (?, ?, ?, 1, ?)`
    ).run(grupo.id, nome, precoAdicional, inteiroPositivo(req.body.ordem) || 0);
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
    await db.prepare('UPDATE opcoes_itens SET nome = ?, preco_adicional_centavos = ?, disponivel = ? WHERE id = ?')
      .run(nome, precoAdicional,
           req.body.disponivel !== undefined ? (req.body.disponivel ? 1 : 0) : opcao.disponivel,
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
  try {
    const loja = await minhaLoja(req);
    const itensReq = Array.isArray(req.body.itens) ? req.body.itens : [];
    if (itensReq.length === 0) throw erroHttp(400, 'Adicione ao menos um item à venda.');

    const formaPagamento = PAGAMENTO_BALCAO[String(req.body.forma_pagamento)];
    if (!formaPagamento) throw erroHttp(400, 'Forma de pagamento inválida.');

    // Recalcula tudo no servidor.
    let subtotal = 0;
    const itensValidados: { produto: Produto; quantidade: number; precoUnit: number; detalhe: string }[] = [];
    for (const it of itensReq) {
      const produto = await meuProduto(loja, it.produto_id);
      const precoBase = (produto.preco_promocional_centavos && produto.preco_promocional_centavos > 0)
        ? produto.preco_promocional_centavos : produto.preco_centavos;

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
      const info = await tx.prepare(
        `INSERT INTO pedidos (cliente_id, loja_id, status, endereco_entrega, forma_pagamento,
                              observacoes, subtotal_centavos, taxa_entrega_centavos, total_centavos,
                              comissao_percentual, comissao_centavos, pagamento_status, origem,
                              criado_em, atualizado_em)
         VALUES (?, ?, 'entregue', 'Venda no balcão', ?, ?, ?, 0, ?, ?, ?, 'aprovado', 'balcao', ?, ?)`
      ).run(consumidor, loja.id, formaPagamento, textoLimpo(req.body.observacoes || '', 200),
            subtotal, total, comissaoPct, comissao, agora, agora);
      const novoPedidoId = Number(info.lastInsertRowid);
      for (const { produto, quantidade, precoUnit, detalhe } of itensValidados) {
        await tx.prepare(
          `INSERT INTO itens_pedido (pedido_id, produto_id, nome_produto, preco_unit_centavos, quantidade, opcoes_texto, opcoes_ids)
           VALUES (?, ?, ?, ?, ?, ?, '[]')`
        ).run(novoPedidoId, produto.id, produto.nome, precoUnit, quantidade, detalhe);
      }
      await tx.prepare('INSERT INTO historico_status (pedido_id, status, criado_em) VALUES (?, ?, ?)')
        .run(novoPedidoId, 'entregue', agora);
      return novoPedidoId;
    });

    res.status(201).json({ pedido_id: pedidoId, subtotal_centavos: subtotal, desconto_centavos: desconto, total_centavos: total });
  } catch (e) { next(e); }
});

/** Vendas de balcão de hoje (lista curta + total) para o histórico do PDV. */
router.get('/balcao/hoje', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    const hoje = new Date().toISOString().slice(0, 10);
    const vendas = await db.prepare(
      `SELECT id, total_centavos, forma_pagamento, criado_em
         FROM pedidos
        WHERE loja_id = ? AND origem = 'balcao' AND criado_em >= ?
        ORDER BY id DESC LIMIT 50`
    ).all(loja.id, hoje + 'T00:00:00.000Z') as Array<{ total_centavos: number }>;
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
      .get(req.params.id, loja.id) as { id: number; pagamento_status: string } | undefined;
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
    }
    const atualizado = await transicionarStatus(pedido.id, novoStatus, { camposExtras: extras });
    res.json({ pedido: atualizado });
  } catch (e) { next(e); }
});

/**
 * Estorna um pedido Pix já pago e cancela — o único fluxo de reembolso hoje é
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
    if (pedido.pagamento_status !== 'aprovado') throw erroHttp(409, 'Este pedido não tem um pagamento Pix aprovado pra estornar.');
    if (pedido.estornado_em) throw erroHttp(409, 'Este pedido já foi estornado.');
    if (!pedido.pagamento_gateway_id) throw erroHttp(409, 'Pedido sem referência de pagamento — estorne direto no painel do Mercado Pago.');
    if (['entregue', 'em_entrega'].includes(pedido.status)) {
      throw erroHttp(409, 'Pedido já saiu ou foi entregue — não dá pra estornar por aqui.');
    }

    const { estornarPagamentoMercadoPago } = await import('./pagamentos');
    await estornarPagamentoMercadoPago(loja.id, pedido.pagamento_gateway_id);

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

    const senhaHash = bcrypt.hashSync(senha, 10);
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
        .run(bcrypt.hashSync(senha, 10), entregador.id);
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
    ).run(loja.id, nome, email, bcrypt.hashSync(senha, 10), agoraUTC());
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
        .run(bcrypt.hashSync(senha, 10), conta.id);
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

// ----- Pagamentos (Mercado Pago por loja) ---------------------------------

/** 'teste' (TEST-...) ou 'producao' (qualquer outro formato, ex. APP_USR-...) — ajuda o lojista a saber o que colou. */
function tipoTokenMP(token: string): 'teste' | 'producao' {
  return token.startsWith('TEST-') ? 'teste' : 'producao';
}

/** Retorna se o Pix online está ativo para a loja e o token mascarado. */
router.get('/pagamentos', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    const row = await db.prepare('SELECT mercadopago_token FROM lojas WHERE id = ?').get(loja.id) as
      { mercadopago_token: string | null } | undefined;
    const cifrado = row?.mercadopago_token || null;
    let token: string | null = null;
    if (cifrado) { try { token = descriptografar(cifrado); } catch { token = null; } }
    const mascarado = token ? '****' + token.slice(-8) : null;
    res.json({ ativo: !!cifrado, token_mascarado: mascarado, tipo: token ? tipoTokenMP(token) : null });
  } catch (e) { next(e); }
});

/** Salva ou limpa o token do Mercado Pago da loja. */
router.put('/pagamentos', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    const token = typeof req.body.token === 'string' ? req.body.token.trim() : '';
    // Token de pagamento é segredo: gravado CRIPTOGRAFADO (nunca volta no GET).
    await db.prepare('UPDATE lojas SET mercadopago_token = ? WHERE id = ?')
      .run(token ? criptografar(token) : null, loja.id);
    const mascarado = token ? '****' + token.slice(-8) : null;
    res.json({ ok: true, ativo: !!token, token_mascarado: mascarado, tipo: token ? tipoTokenMP(token) : null });
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
    fs.writeFileSync(caminhoCertificado(loja.id), req.file.buffer);
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

const TIPO_PAG_NFCE: Record<string, 'dinheiro' | 'pix' | 'cartao'> = {
  dinheiro: 'dinheiro', pix: 'pix', cartao: 'cartao', cartao_entrega: 'cartao',
};

/** Dados estruturados do DANFE (para impressão no cliente). */
function montarDanfeDados(emit: EmitenteNfce, venda: VendaNfce) {
  return {
    emitente: {
      nome: emit.razaoSocial, fantasia: emit.nomeFantasia, cnpj: emit.cnpj,
      endereco: `${emit.logradouro}, ${emit.numero} - ${emit.bairro} - ${emit.municipio}/${emit.uf}`,
    },
    itens: venda.itens.map(i => ({
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
    `SELECT i.nome_produto, i.preco_unit_centavos, i.quantidade,
            p.ncm, p.cfop, p.csosn, p.origem, p.unidade_comercial
       FROM itens_pedido i LEFT JOIN produtos p ON p.id = i.produto_id
      WHERE i.pedido_id = ?`
  ).all(pedido.id) as any[];
  if (itens.length === 0) throw erroHttp(400, 'Venda sem itens.');

  const itensNfce = itens.map((it, idx) => ({
    codigo: String(idx + 1), descricao: it.nome_produto,
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
    pagamentos: [{ tipo: TIPO_PAG_NFCE[pedido.forma_pagamento] || 'dinheiro', valorCentavos: totalProdutos - desconto }],
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
      await db.prepare(
        "UPDATE notas_fiscais SET status = 'cancelada', c_stat = ?, motivo = ?, xml = ? WHERE id = ?"
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

/** Lista categorias (registro + as que existem só nos produtos) + estilo. */
router.get('/categorias', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req) as any;
    const registro = await db.prepare(
      'SELECT nome, icone, ordem, setor_id FROM categorias WHERE loja_id = ? ORDER BY ordem, nome'
    ).all(loja.id) as Array<{ nome: string; icone: string; ordem: number; setor_id: number | null }>;
    const mapa = new Map(registro.map(r => [r.nome, r]));
    const doProduto = await db.prepare(
      "SELECT DISTINCT categoria FROM produtos WHERE loja_id = ? AND excluido = 0 AND categoria != ''"
    ).all(loja.id) as Array<{ categoria: string }>;
    for (const { categoria } of doProduto) {
      if (!mapa.has(categoria)) {
        const item = { nome: categoria, icone: '', ordem: 999, setor_id: null };
        mapa.set(categoria, item);
        registro.push(item);
      }
    }
    const categorias = [...mapa.values()].sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome));
    res.json({ categorias, estilo: loja.categoria_estilo || 'cards' });
  } catch (e) { next(e); }
});

/** Salva ícone/ordem/renome/setor das categorias + o estilo de exibição. */
router.put('/categorias', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    const estilo = req.body.estilo === 'chips' ? 'chips' : 'cards';
    const itens: any[] = Array.isArray(req.body.itens) ? req.body.itens : [];

    await comTransacao(async (tx) => {
      await tx.prepare('UPDATE lojas SET categoria_estilo = ? WHERE id = ?').run(estilo, loja.id);
      for (let i = 0; i < itens.length; i++) {
        const it = itens[i];
        const nome = textoLimpo(it.nome, 50);
        if (!nome) continue;
        const icone = textoLimpo(it.icone, 16);
        const ordem = Number.isFinite(Number(it.ordem)) ? Number(it.ordem) : i;
        const setorId = it.setor_id ? Number(it.setor_id) : null;
        const novo = textoLimpo(it.renomear_para, 50);
        const nomeFinal = novo || nome;
        if (novo && novo !== nome) {
          await tx.prepare('UPDATE produtos SET categoria = ? WHERE loja_id = ? AND categoria = ?').run(nomeFinal, loja.id, nome);
          await tx.prepare('DELETE FROM categorias WHERE loja_id = ? AND nome = ?').run(loja.id, nome);
        }
        await tx.prepare(
          `INSERT INTO categorias (loja_id, nome, icone, ordem, setor_id, criado_em) VALUES (?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE icone = VALUES(icone), ordem = VALUES(ordem), setor_id = VALUES(setor_id)`
        ).run(loja.id, nomeFinal, icone, ordem, setorId, agoraUTC());
      }
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ----- Relatórios ---------------------------------------------------------

router.get('/relatorios', async (req, res, next) => {
  try {
    const loja = await minhaLoja(req);
    const periodo = ['dia', 'semana', 'mes'].includes(req.query.periodo as string)
      ? (req.query.periodo as 'dia' | 'semana' | 'mes') : 'dia';
    const dias = { dia: 1, semana: 7, mes: 30 }[periodo];
    const inicio = new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString();

    type Resumo = { pedidos: number; faturamento_centavos: number; comissao_centavos: number; ticket_medio_centavos: number };
    const resumo = await db.prepare(
      `SELECT COUNT(*) AS pedidos,
              COALESCE(SUM(total_centavos), 0)    AS faturamento_centavos,
              COALESCE(SUM(comissao_centavos), 0) AS comissao_centavos,
              COALESCE(AVG(total_centavos), 0)    AS ticket_medio_centavos
         FROM pedidos
        WHERE loja_id = ? AND status = 'entregue' AND criado_em >= ?`
    ).get(loja.id, inicio) as Resumo;

    const maisVendidos = await db.prepare(
      `SELECT i.nome_produto, SUM(i.quantidade) AS quantidade,
              SUM(i.quantidade * i.preco_unit_centavos) AS total_centavos
         FROM itens_pedido i
         JOIN pedidos p ON p.id = i.pedido_id
        WHERE p.loja_id = ? AND p.status = 'entregue' AND p.criado_em >= ?
        GROUP BY i.nome_produto
        ORDER BY quantidade DESC LIMIT 10`
    ).all(loja.id, inicio);

    // Faturamento por forma de pagamento (só entregues).
    const porPagamento = await db.prepare(
      `SELECT forma_pagamento, COUNT(*) AS qtd, COALESCE(SUM(total_centavos),0) AS total_centavos
         FROM pedidos
        WHERE loja_id = ? AND status = 'entregue' AND criado_em >= ?
        GROUP BY forma_pagamento`
    ).all(loja.id, inicio);

    // Taxa de cancelamento (cancelados + recusados sobre o total de pedidos do período).
    const contagem = await db.prepare(
      `SELECT
          SUM(CASE WHEN status IN ('cancelado','recusado') THEN 1 ELSE 0 END) AS cancelados,
          COUNT(*) AS total
         FROM pedidos WHERE loja_id = ? AND criado_em >= ?`
    ).get(loja.id, inicio) as { cancelados: number; total: number };
    const taxaCancelamento = contagem.total > 0
      ? Math.round((contagem.cancelados / contagem.total) * 1000) / 10 : 0;

    // Horário de pico — distribuição por hora (Brasília, UTC-3), só entregues.
    // criado_em é ISO-8601 em UTC guardado como string; STR_TO_DATE ignora o
    // sufixo ".000Z" (trailing) e SUBTIME aplica o deslocamento de fuso.
    const porHora = await db.prepare(
      `SELECT HOUR(SUBTIME(STR_TO_DATE(criado_em, '%Y-%m-%dT%H:%i:%s'), '03:00:00')) AS hora,
              COUNT(*) AS qtd
         FROM pedidos
        WHERE loja_id = ? AND status = 'entregue' AND criado_em >= ?
        GROUP BY hora ORDER BY hora`
    ).all(loja.id, inicio) as Array<{ hora: number; qtd: number }>;

    // Financeiro: bruto, comissão da plataforma e líquido a receber.
    const bruto = resumo.faturamento_centavos;
    const comissao = resumo.comissao_centavos;
    const financeiro = {
      faturamento_bruto_centavos: bruto,
      comissao_plataforma_centavos: comissao,
      liquido_centavos: bruto - comissao,
    };

    res.json({
      periodo,
      resumo: { ...resumo, ticket_medio_centavos: Math.round(resumo.ticket_medio_centavos) },
      mais_vendidos: maisVendidos,
      por_pagamento: porPagamento,
      cancelamento: { cancelados: contagem.cancelados || 0, total: contagem.total || 0, taxa_percent: taxaCancelamento },
      por_hora: porHora,
      financeiro,
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
      SELECT m.id, m.numero, m.status,
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
    if (mesa.status === 'ocupada') throw erroHttp(409, 'Esta mesa já está ocupada.');

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
      precoUnit = (produto.preco_promocional_centavos && produto.preco_promocional_centavos > 0)
        ? produto.preco_promocional_centavos : produto.preco_centavos;
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

export default router;
