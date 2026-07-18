/**
 * POST /api/upload/imagem — recebe multipart/form-data com campo "imagem",
 * salva em dados/uploads/ e retorna a URL pública /uploads/<filename>.
 * Qualquer usuário autenticado pode fazer upload.
 */
import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { autenticar } from '../auth';
import { erroHttp } from '../util';

const router = Router();
router.use(autenticar);

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

router.post('/imagem', upload.single('imagem'), (req, res, next) => {
  try {
    if (!req.file) throw erroHttp(400, 'Nenhuma imagem recebida.');
    const url = `/uploads/${req.file.filename}`;
    res.json({ url });
  } catch (e) { next(e); }
});

export default router;
