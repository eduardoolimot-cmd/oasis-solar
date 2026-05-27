// =================================================
// OASIS SOLAR — servidor HTTP + WebSocket
// =================================================
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from './lib/env.js';
import { errorHandler } from './lib/http.js';
import authRoutes from './routes/auth.js';
import usinasRoutes from './routes/usinas.js';
import lancamentosRoutes from './routes/lancamentos.js';
import manutencoesRoutes from './routes/manutencoes.js';
import financeiroRoutes from './routes/financeiro.js';
import notificacoesRoutes from './routes/notificacoes.js';
import dashboardRoutes from './routes/dashboard.js';
import relatorioRoutes from './routes/relatorio.js';
import adminRoutes from './routes/admin.js';
import fitRoutes from './routes/fit.js';
import { setupRealtime } from './realtime.js';
import { iniciarJobVencimento } from './jobs/manutencao-vencimento.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const server = http.createServer(app);

// ---------- Middlewares globais ----------
app.use(
  cors({
    origin: env.CORS_ORIGIN.split(',').map((s) => s.trim()),
    credentials: true,
  }),
);
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Servir arquivos enviados (uploads) publicamente
app.use(
  '/uploads',
  express.static(path.join(__dirname, '..', env.UPLOAD_DIR)),
);

// Servir o frontend estático (client/)
const CLIENT_DIR = path.join(__dirname, '..', '..', 'client');
app.use(express.static(CLIENT_DIR));

// ---------- Rotas ----------
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    service: 'oasis-solar-server',
    env: env.NODE_ENV,
    timestamp: new Date().toISOString(),
  });
});

// Rotas
app.use('/api/auth', authRoutes);
app.use('/api/usinas', usinasRoutes);
app.use('/api/lancamentos', lancamentosRoutes);
app.use('/api/manutencoes', manutencoesRoutes);
app.use('/api/financeiro', financeiroRoutes);
app.use('/api/notificacoes', notificacoesRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/relatorio', relatorioRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/fit', fitRoutes);

// 404 para qualquer /api/* não tratado
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Endpoint não encontrado', path: req.path });
});

// Handler global de erros (deve ser o último middleware)
app.use(errorHandler);

// ---------- Socket.IO ----------
setupRealtime(server);

// ---------- Jobs em background ----------
iniciarJobVencimento();

// ---------- Boot ----------
server.listen(env.PORT, () => {
  console.log(`🌞 OASIS SOLAR — servidor rodando em http://localhost:${env.PORT}`);
  console.log(`   Ambiente: ${env.NODE_ENV}`);
  console.log(`   CORS:     ${env.CORS_ORIGIN}`);
  console.log(`   Health:   http://localhost:${env.PORT}/api/health`);
});

// Graceful shutdown
const shutdown = (signal) => {
  console.log(`\n${signal} recebido. Encerrando...`);
  server.close(() => {
    console.log('Servidor HTTP encerrado.');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
