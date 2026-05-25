// Rotas de administração — usuários, audit log, exportações
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../db.js';
import { asyncRoute, httpErrors } from '../lib/http.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

// ==========================================================
// USUÁRIOS (admin only)
// ==========================================================
// Senha opcional na criação — se vazia, usa "1234" (deve ser trocada no 1º login)
const DEFAULT_PASSWORD = '1234';
const userCreateSchema = z.object({
  email: z.string().email().toLowerCase(),
  senha: z.string().optional().nullable(),
  nome: z.string().min(1),
  role: z.enum(['ADMIN', 'TECNICO', 'VISUALIZADOR']).default('VISUALIZADOR'),
});

const userUpdateSchema = z.object({
  nome: z.string().min(1).optional(),
  role: z.enum(['ADMIN', 'TECNICO', 'VISUALIZADOR']).optional(),
  ativo: z.boolean().optional(),
  senha: z.string().min(4).optional().nullable(),
  usinaIds: z.array(z.string()).optional(),
});

// Aceita usinaIds opcional no payload de criação
const userCreateExtSchema = userCreateSchema.extend({
  usinaIds: z.array(z.string()).optional(),
});

function shapeUser(u) {
  return {
    id: u.id,
    email: u.email,
    nome: u.nome,
    role: u.role,
    ativo: u.ativo,
    ultimoLogin: u.ultimoLogin,
    createdAt: u.createdAt,
    usinaIds: u.acessos ? u.acessos.map((a) => a.usinaId) : undefined,
  };
}

router.get(
  '/usuarios',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      include: { acessos: { select: { usinaId: true } } },
    });
    res.json(users.map(shapeUser));
  }),
);

router.post(
  '/usuarios',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const data = userCreateExtSchema.parse(req.body);
    const senhaUsada = data.senha && data.senha.length > 0 ? data.senha : DEFAULT_PASSWORD;
    const senhaHash = await bcrypt.hash(senhaUsada, 10);

    const usinaIds = data.usinaIds && data.role !== 'ADMIN' ? data.usinaIds : [];

    const u = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: { email: data.email, senhaHash, nome: data.nome, role: data.role },
      });
      if (usinaIds.length) {
        await tx.usinaAccess.createMany({
          data: usinaIds.map((usinaId) => ({ userId: created.id, usinaId })),
        });
      }
      return tx.user.findUnique({
        where: { id: created.id },
        include: { acessos: { select: { usinaId: true } } },
      });
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        acao: 'create',
        recurso: 'User',
        recursoId: u.id,
        payload: JSON.stringify({
          email: u.email,
          role: u.role,
          senhaPadrao: senhaUsada === DEFAULT_PASSWORD,
          usinaIds,
        }),
      },
    });
    res.status(201).json({ ...shapeUser(u), senhaPadrao: senhaUsada === DEFAULT_PASSWORD });
  }),
);

router.put(
  '/usuarios/:id',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const data = userUpdateSchema.parse(req.body);
    const exists = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!exists) throw httpErrors.notFound('Usuário não encontrado');

    const updateData = {};
    if (data.nome !== undefined) updateData.nome = data.nome;
    if (data.role !== undefined) updateData.role = data.role;
    if (data.ativo !== undefined) updateData.ativo = data.ativo;
    if (data.senha) updateData.senhaHash = await bcrypt.hash(data.senha, 10);

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.user.update({
        where: { id: req.params.id },
        data: updateData,
      });

      // Atualiza acessos por usina se vier no payload
      if (data.usinaIds !== undefined) {
        // ADMIN não tem acessos restritos
        const finalRole = data.role ?? exists.role;
        const finalUsinaIds = finalRole === 'ADMIN' ? [] : data.usinaIds;

        await tx.usinaAccess.deleteMany({ where: { userId: u.id } });
        if (finalUsinaIds.length) {
          await tx.usinaAccess.createMany({
            data: finalUsinaIds.map((usinaId) => ({ userId: u.id, usinaId })),
          });
        }
      }

      return tx.user.findUnique({
        where: { id: u.id },
        include: { acessos: { select: { usinaId: true } } },
      });
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        acao: 'update',
        recurso: 'User',
        recursoId: updated.id,
        payload: data.usinaIds !== undefined
          ? JSON.stringify({ usinaIds: data.usinaIds })
          : null,
      },
    });
    res.json(shapeUser(updated));
  }),
);

router.delete(
  '/usuarios/:id',
  requireAdmin,
  asyncRoute(async (req, res) => {
    if (req.params.id === req.user.id) {
      throw httpErrors.badRequest('Você não pode excluir o próprio usuário');
    }
    await prisma.user.delete({ where: { id: req.params.id } }).catch(() => {
      throw httpErrors.notFound('Usuário não encontrado');
    });
    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        acao: 'delete',
        recurso: 'User',
        recursoId: req.params.id,
      },
    });
    res.json({ ok: true });
  }),
);

// ==========================================================
// AUDIT LOG (admin only)
// ==========================================================
router.get(
  '/audit',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const recurso = req.query.recurso;
    const userId = req.query.userId;

    const where = {};
    if (recurso) where.recurso = recurso;
    if (userId) where.userId = userId;

    const logs = await prisma.auditLog.findMany({
      where,
      include: { user: { select: { id: true, nome: true, email: true } } },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    res.json(logs);
  }),
);

// ==========================================================
// EXPORTAÇÃO CSV (qualquer usuário autenticado)
// ==========================================================
function toCSV(rows) {
  return rows
    .map((r) =>
      r
        .map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`)
        .join(';'),
    )
    .join('\n');
}

router.get(
  '/exportar/lancamentos.csv',
  asyncRoute(async (req, res) => {
    const where = {};
    if (req.query.usinaId) where.usinaId = req.query.usinaId;
    if (req.query.ano) where.periodo = { startsWith: `${req.query.ano}-` };
    const rows = await prisma.lancamento.findMany({
      where,
      include: { usina: { select: { nome: true } }, skid: { select: { nome: true } } },
      orderBy: { periodo: 'desc' },
    });
    const csv = toCSV([
      ['Usina', 'SKID', 'Periodo', 'Geração (kWh)', 'Irradiação', 'PR (%)', 'Disp (%)', 'Obs'],
      ...rows.map((l) => [
        l.usina.nome, l.skid?.nome || '', l.periodo, l.geracao, l.irrad, l.pr, l.disp, l.obs || '',
      ]),
    ]);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=lancamentos.csv');
    res.send('﻿' + csv);
  }),
);

router.get(
  '/exportar/financeiro.csv',
  asyncRoute(async (req, res) => {
    const where = {};
    if (req.query.usinaId) where.usinaId = req.query.usinaId;
    if (req.query.ano) {
      where.data = {
        gte: new Date(`${req.query.ano}-01-01T00:00:00.000Z`),
        lt: new Date(`${parseInt(req.query.ano) + 1}-01-01T00:00:00.000Z`),
      };
    }
    const rows = await prisma.financeiro.findMany({
      where,
      include: { usina: { select: { nome: true } } },
      orderBy: { data: 'desc' },
    });
    const csv = toCSV([
      ['Data', 'Usina', 'Tipo', 'Categoria', 'Descrição', 'Valor (R$)', 'Status'],
      ...rows.map((f) => [
        f.data.toISOString().slice(0, 10),
        f.usina.nome,
        f.tipo === 'rec' ? 'Receita' : 'Despesa',
        f.cat,
        f.desc || '',
        f.val,
        f.st,
      ]),
    ]);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=financeiro.csv');
    res.send('﻿' + csv);
  }),
);

// ==========================================================
// STATS (visão geral pro admin)
// ==========================================================
router.get(
  '/stats',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const [usinas, lancs, manuts, fins, users, sumRec, sumDes] = await Promise.all([
      prisma.usina.count(),
      prisma.lancamento.count(),
      prisma.manutencao.count(),
      prisma.financeiro.count(),
      prisma.user.count(),
      prisma.financeiro.aggregate({
        where: { tipo: 'rec' },
        _sum: { val: true },
      }),
      prisma.financeiro.aggregate({
        where: { tipo: 'des' },
        _sum: { val: true },
      }),
    ]);

    res.json({
      usinas,
      lancamentos: lancs,
      manutencoes: manuts,
      financeiros: fins,
      usuarios: users,
      totalReceitas: sumRec._sum.val || 0,
      totalDespesas: sumDes._sum.val || 0,
    });
  }),
);

export default router;
