/**
 * POST /api/upload/imagem — recebe multipart/form-data com campo "imagem",
 * salva em dados/uploads/ e retorna a URL pública /uploads/<filename>.
 *
 * Só LOJISTA e ADMIN. Antes era "qualquer usuário autenticado", o que incluía
 * cliente e entregador — e cliente é auto-cadastro, então qualquer pessoa
 * criava uma conta e gravava 8 MB por requisição, sem limite, no disco do VPS
 * (que é compartilhado por todos os tenants). Nenhuma tela de cliente ou
 * entregador faz upload: só produtos, banners, logo/capa e marca, que são
 * telas de lojista/admin.
 */
import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { autenticar, exigirPerfil } from '../auth';
import { erroHttp } from '../util';

const router = Router();
router.use(autenticar, exigirPerfil('lojista', 'admin'));

/**
 * Segunda camada: limita o volume por CONTA (não por IP — o lojista legítimo
 * costuma estar atrás do mesmo IP da loja inteira). Cadastrar um cardápio
 * grande de uma vez cabe folgado em 60; um script de flood, não.
 */
const limiteUpload = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  /**
   * Conta autenticada é a chave preferida. No fallback por IP, `req.ip` cru
   * NÃO serve: em IPv6 cada usuário recebe um /128, então trocar de endereço
   * dentro do próprio prefixo zeraria o contador e o limite viraria enfeite.
   * `ipKeyGenerator` agrupa o IPv6 por sub-rede (e devolve o IPv4 inalterado).
   * O prefixo `u:` evita que um id numérico colida com um IP.
   */
  keyGenerator: (req) => (req.usuario?.id ? `u:${req.usuario.id}` : ipKeyGenerator(req.ip ?? '')),
  message: { erro: 'Muitos envios de imagem seguidos. Aguarde alguns minutos e tente de novo.' },
});

const UPLOAD_DIR = path.resolve('./dados/uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// A extensão salva vem SEMPRE deste mapa (derivada do mimetype validado), nunca
// do nome original enviado pelo cliente. Assim ninguém grava .svg/.html (que o
// express.static serviria como text/html/svg+xml executável) mandando um
// originalname malicioso com mimetype de imagem — Stored XSS.
const EXT_POR_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/avif': '.avif',
};
const TIPOS_PERMITIDOS = Object.keys(EXT_POR_MIME);
const TAMANHO_MAX = 8 * 1024 * 1024; // 8 MB

const armazenamento = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = EXT_POR_MIME[file.mimetype] || '.jpg';
    const nome = crypto.randomBytes(16).toString('hex') + ext;
    cb(null, nome);
  },
});

const upload = multer({
  storage: armazenamento,
  limits: { fileSize: TAMANHO_MAX },
  fileFilter: (_req, file, cb) => {
    if (TIPOS_PERMITIDOS.includes(file.mimetype)) return cb(null, true);
    cb(new Error('Tipo de arquivo não permitido. Use JPG, PNG, WebP, GIF ou AVIF.'));
  },
});

router.post('/imagem', limiteUpload, upload.single('imagem'), (req, res, next) => {
  try {
    if (!req.file) throw erroHttp(400, 'Nenhuma imagem recebida.');
    const url = `/uploads/${req.file.filename}`;
    res.json({ url });
  } catch (e) { next(e); }
});

export default router;
