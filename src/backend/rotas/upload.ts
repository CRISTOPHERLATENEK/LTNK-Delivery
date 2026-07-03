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

const TIPOS_PERMITIDOS = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];
const TAMANHO_MAX = 8 * 1024 * 1024; // 8 MB

const armazenamento = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    const nome = crypto.randomBytes(16).toString('hex') + ext;
    cb(null, nome);
  },
});

const upload = multer({
  storage: armazenamento,
  limits: { fileSize: TAMANHO_MAX },
  fileFilter: (_req, file, cb) => {
    if (TIPOS_PERMITIDOS.includes(file.mimetype)) return cb(null, true);
    cb(new Error('Tipo de arquivo não permitido. Use JPG, PNG, WebP ou GIF.'));
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
