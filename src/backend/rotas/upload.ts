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
import { paraWeb } from '../imagem-web';

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

/*
 * MEMORIA, NAO DISCO — e a mudanca que permite converter.
 *
 * O `diskStorage` gravava o arquivo como veio e so depois o handler rodava; nao
 * havia como intervir sem ler de volta e reescrever. Com o buffer em memoria a
 * conversao acontece ANTES de existir arquivo, e o que chega ao disco ja e o
 * WebP.
 *
 * O custo e ate 8 MB de RAM por requisicao em andamento, contido pelo limite de
 * 60 envios por 10 minutos por conta que ja existia acima.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: TAMANHO_MAX },
  fileFilter: (_req, file, cb) => {
    if (TIPOS_PERMITIDOS.includes(file.mimetype)) return cb(null, true);
    cb(new Error('Tipo de arquivo não permitido. Use JPG, PNG, WebP, GIF ou AVIF.'));
  },
});

router.post('/imagem', limiteUpload, upload.single('imagem'), async (req, res, next) => {
  try {
    if (!req.file) throw erroHttp(400, 'Nenhuma imagem recebida.');

    /*
     * CONVERTE ANTES DE GRAVAR. Medido nos 88 arquivos que estavam em producao:
     * 29 MB, media de 329 KB, o maior com 1.776 KB. Em WebP 1200px o mesmo
     * arquivo de 1.776 KB fica em 103 KB — 94% menor, sem diferenca visivel.
     *
     * Um PNG de 1.776 KB e treze vezes o bundle inteiro do app comprimido:
     * numa vitrine com vinte produtos, a foto E o carregamento.
     */
    const convertida = await paraWeb(req.file.buffer, req.file.mimetype);

    /*
     * FALHA NA CONVERSAO NAO PERDE O ENVIO. Arquivo corrompido, formato que o
     * `sharp` recusa, memoria curta: grava o original com a extensao derivada
     * do mimetype validado (nunca do nome que o cliente mandou — ver o mapa
     * acima). Uma foto pesada e pior que uma foto leve; nenhuma foto e pior que
     * as duas.
     */
    const ext = convertida ? convertida.extensao : (EXT_POR_MIME[req.file.mimetype] || '.jpg');
    const dados = convertida ? convertida.buffer : req.file.buffer;
    const nome = crypto.randomBytes(16).toString('hex') + ext;
    await fs.promises.writeFile(path.join(UPLOAD_DIR, nome), dados);

    if (convertida) {
      console.log(`[upload] ${req.file.mimetype} ${Math.round(req.file.size / 1024)}KB`
        + ` -> webp ${convertida.largura}x${convertida.altura} ${Math.round(dados.length / 1024)}KB`);
    } else {
      console.log(`[upload] ${req.file.mimetype} ${Math.round(req.file.size / 1024)}KB gravado sem converter`);
    }

    res.json({ url: `/uploads/${nome}` });
  } catch (e) { next(e); }
});

export default router;
