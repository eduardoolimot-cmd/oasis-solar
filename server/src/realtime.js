// Socket.IO — broadcast de eventos para clientes autenticados
import { Server as IOServer } from 'socket.io';
import { COOKIE_NAME, verifyToken } from './lib/jwt.js';
import { env } from './lib/env.js';
import { prisma } from './db.js';

let io = null;

export function setupRealtime(httpServer) {
  io = new IOServer(httpServer, {
    cors: {
      origin: env.CORS_ORIGIN.split(',').map((s) => s.trim()),
      credentials: true,
    },
  });

  // Middleware: extrai o JWT do cookie e valida o usuário
  io.use(async (socket, next) => {
    try {
      const raw = socket.handshake.headers.cookie || '';
      const m = raw.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
      if (!m) return next(new Error('no auth'));
      const payload = verifyToken(m[1]);
      const u = await prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, nome: true, role: true, ativo: true },
      });
      if (!u || !u.ativo) return next(new Error('user inactive'));
      socket.user = u;
      next();
    } catch (e) {
      next(new Error('auth failed'));
    }
  });

  io.on('connection', (socket) => {
    socket.join('all');
    socket.join(`user:${socket.user.id}`);
    console.log(`🔌 Socket conectado: ${socket.user.nome} (${socket.user.role})`);

    socket.on('disconnect', () => {
      console.log(`🔌 Socket desconectado: ${socket.user.nome}`);
    });
  });

  return io;
}

/**
 * Emite um evento para todos os clientes conectados (sala 'all').
 * Uso: emit('usina:created', { id, nome, ... })
 */
export function emit(evento, payload) {
  if (!io) return;
  io.to('all').emit(evento, payload);
}

/** Emite um evento apenas para um usuário específico */
export function emitToUser(userId, evento, payload) {
  if (!io) return;
  io.to(`user:${userId}`).emit(evento, payload);
}

export function getIO() {
  return io;
}
