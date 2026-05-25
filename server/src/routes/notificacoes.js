// Notificações: lista, marcar como lida, criar (admin)
import { Router } from 'express';
import { prisma } from '../db.js';
import { asyncRoute, httpErrors } from '../lib/http.js';
import { notificacaoSchema } from '../lib/schemas.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { emit, emitToUser } from '../realtime.js';

const router = Router();
router.use(requireAuth);

function shape(n) {
  return {
    id: n.id,
    titulo: n.titulo,
    body: n.body,
    tipo: n.tipo,
    lida: n.lida,
    userId: n.userId,
    createdAt: n.createdAt,
  };
}

// GET — retorna notificações globais (userId null) + as do usuário logado
router.get(
  '/',
  asyncRoute(async (req, res) => {
    const rows = await prisma.notificacao.findMany({
      where: { OR: [{ userId: null }, { userId: req.user.id }] },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json({
      total: rows.length,
      naoLidas: rows.filter((n) => !n.lida).length,
      items: rows.map(shape),
    });
  }),
);

// PATCH /:id/lida — marcar como lida
router.patch(
  '/:id/lida',
  asyncRoute(async (req, res) => {
    const n = await prisma.notificacao.findUnique({
      where: { id: req.params.id },
    });
    if (!n) throw httpErrors.notFound('Notificação não encontrada');
    if (n.userId && n.userId !== req.user.id) {
      throw httpErrors.forbidden('Notificação não é sua');
    }
    const updated = await prisma.notificacao.update({
      where: { id: n.id },
      data: { lida: true },
    });
    res.json(shape(updated));
  }),
);

// POST /marcar-todas-lidas
router.post(
  '/marcar-todas-lidas',
  asyncRoute(async (req, res) => {
    const r = await prisma.notificacao.updateMany({
      where: {
        OR: [{ userId: null }, { userId: req.user.id }],
        lida: false,
      },
      data: { lida: true },
    });
    res.json({ ok: true, marcadas: r.count });
  }),
);

// POST / — criar notificação (admin)
router.post(
  '/',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const data = notificacaoSchema.parse(req.body);
    const created = await prisma.notificacao.create({ data });
    const shaped = shape(created);
    if (created.userId) emitToUser(created.userId, 'notificacao:created', shaped);
    else emit('notificacao:created', shaped);
    res.status(201).json(shaped);
  }),
);

// DELETE /:id (admin)
router.delete(
  '/:id',
  requireAdmin,
  asyncRoute(async (req, res) => {
    await prisma.notificacao
      .delete({ where: { id: req.params.id } })
      .catch(() => {
        throw httpErrors.notFound('Notificação não encontrada');
      });
    res.json({ ok: true });
  }),
);

export default router;
