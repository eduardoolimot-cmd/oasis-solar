// =================================================
// Helpers para gerar notificações automáticas
// =================================================
import { prisma } from '../db.js';
import { emit, emitToUser } from '../realtime.js';

/**
 * Cria uma notificação para TODOS os usuários ADMIN ativos.
 * Cada admin recebe uma notificação independente (userId próprio).
 * Emite via Socket.IO para cada um.
 *
 * @param {object} params
 * @param {string} params.titulo
 * @param {string} params.body
 * @param {'info'|'ok'|'wn'|'er'} [params.tipo='info']
 * @param {object} [params.exceto] - userId para NÃO notificar (ex: o próprio autor da ação)
 */
export async function notificarAdmins({ titulo, body, tipo = 'info', exceto = null }) {
  try {
    const admins = await prisma.user.findMany({
      where: {
        role: 'ADMIN',
        ativo: true,
        ...(exceto ? { id: { not: exceto } } : {}),
      },
      select: { id: true },
    });

    if (!admins.length) return;

    await prisma.notificacao.createMany({
      data: admins.map((a) => ({
        userId: a.id,
        titulo,
        body,
        tipo,
        lida: false,
      })),
    });

    // Emite via socket para cada admin específico
    for (const a of admins) {
      emitToUser(a.id, 'notificacao:created', {
        userId: a.id,
        titulo,
        body,
        tipo,
        lida: false,
        createdAt: new Date().toISOString(),
      });
    }
  } catch (e) {
    console.error('[notificarAdmins] falhou:', e.message);
  }
}

/**
 * Cria notificação direcionada a um usuário específico.
 */
export async function notificarUsuario(userId, { titulo, body, tipo = 'info' }) {
  if (!userId) return;
  try {
    const n = await prisma.notificacao.create({
      data: { userId, titulo, body, tipo, lida: false },
    });
    emitToUser(userId, 'notificacao:created', {
      ...n,
      createdAt: n.createdAt.toISOString(),
    });
  } catch (e) {
    console.error('[notificarUsuario] falhou:', e.message);
  }
}

/**
 * Cria notificação global (todos os usuários ativos).
 * Usar com parcimônia — gera ruído.
 */
export async function notificarTodos({ titulo, body, tipo = 'info' }) {
  try {
    const usuarios = await prisma.user.findMany({
      where: { ativo: true },
      select: { id: true },
    });
    await prisma.notificacao.createMany({
      data: usuarios.map((u) => ({
        userId: u.id, titulo, body, tipo, lida: false,
      })),
    });
    emit('notificacao:created', { titulo, body, tipo, createdAt: new Date().toISOString() });
  } catch (e) {
    console.error('[notificarTodos] falhou:', e.message);
  }
}

// ---------- Helper de formatação ----------
export function fmtUsuario(user) {
  if (!user) return 'Sistema';
  return `${user.nome || user.email || '?'} (${user.role || '?'})`;
}

export function fmtDataHora(d = new Date()) {
  return d.toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}
