// Configuração do Multer para upload de arquivos
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { env } from './env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_ROOT = path.resolve(__dirname, '..', '..', env.UPLOAD_DIR);

// Garante que o diretório existe
if (!fs.existsSync(UPLOAD_ROOT)) {
  fs.mkdirSync(UPLOAD_ROOT, { recursive: true });
}

// Storage em disco com nomes únicos
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Subpasta opcional definida em req.uploadSubdir (ex: 'manutencoes', 'csv')
    const sub = req.uploadSubdir || '';
    const dest = path.join(UPLOAD_ROOT, sub);
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    cb(null, dest);
  },
  filename: (req, file, cb) => {
    const ts = Date.now();
    const rand = Math.random().toString(36).slice(2, 8);
    const safe = file.originalname
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .slice(0, 80);
    cb(null, `${ts}_${rand}_${safe}`);
  },
});

// CSVs (apenas .csv/.txt, em memória — não persiste no disco)
export const uploadCSV = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.UPLOAD_MAX_BYTES },
  fileFilter: (req, file, cb) => {
    const ok =
      /\.(csv|txt)$/i.test(file.originalname) ||
      ['text/csv', 'text/plain', 'application/vnd.ms-excel'].includes(
        file.mimetype,
      );
    cb(ok ? null : new Error('Apenas arquivos CSV (.csv/.txt) são aceitos'), ok);
  },
});

// Arquivos gerais de manutenção (imagens + PDFs/docs)
export const uploadManutencao = multer({
  storage,
  limits: { fileSize: env.UPLOAD_MAX_BYTES },
  fileFilter: (req, file, cb) => {
    const ok =
      /^image\/(jpeg|png|gif|webp|heic)$/.test(file.mimetype) ||
      file.mimetype === 'application/pdf' ||
      /\.(pdf|doc|docx|xls|xlsx)$/i.test(file.originalname);
    cb(ok ? null : new Error('Tipo de arquivo não permitido'), ok);
  },
});

export { UPLOAD_ROOT };
