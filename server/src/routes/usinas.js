// CRUD de Usinas (com Skids e Previsões aninhados)
import { Router } from 'express';
import { prisma } from '../db.js';
import { asyncRoute, httpErrors } from '../lib/http.js';
import { usinaSchema } from '../lib/schemas.js';
import {
  requireAuth,
  requireAdmin,
  requireAdminOrTecnico,
} from '../middleware/auth.js';
import { emit } from '../realtime.js';
import { aplicarFiltroUsinas, exigirAcessoUsina } from '../lib/access.js';
import { notificarAdmins, fmtUsuario, fmtDataHora } from '../lib/notificar.js';

const router = Router();

// Toda rota daqui em diante exige autenticação
router.use(requireAuth);

/**
 * Formato de saída padronizado para uma usina.
 */
function shapeUsina(u) {
  return {
    id: u.id,
    nome: u.nome,
    kwp: u.kwp,
    inicio: u.inicio,
    local: u.local,
    obs: u.obs,
    modulos: {
      modelo: u.moduloModelo,
      qtd: u.moduloQtd,
      w: u.moduloW,
      fab: u.moduloFab,
    },
    inversores: {
      modelo: u.inversorModelo,
      qtd: u.inversorQtd,
      kw: u.inversorKw,
      fab: u.inversorFab,
    },
    skids: (u.skids || []).map((s) => ({
      id: s.id,
      nome: s.nome,
      kwp: s.kwp,
      previsoes: (s.previsoes || []).map((p) => ({
        mes: p.mes,
        gen: p.gen,
        irrad: p.irrad,
        pr: p.pr,
      })),
    })),
    previsoes: (u.previsoes || [])
      .filter((p) => p.skidId === null)
      .map((p) => ({ mes: p.mes, gen: p.gen, irrad: p.irrad, pr: p.pr })),
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
  };
}

const INCLUDE_FULL = {
  skids: {
    include: { previsoes: { orderBy: { mes: 'asc' } } },
    orderBy: { nome: 'asc' },
  },
  previsoes: { orderBy: { mes: 'asc' } },
};

// ---------- GET /api/usinas (listar) ----------
router.get(
  '/',
  asyncRoute(async (req, res) => {
    const where = aplicarFiltroUsinas({}, req);
    // Mapeia a restrição (que usa { in: [...] }) para o id (que é o PK da Usina)
    const filtroId = where.usinaId;
    const usinas = await prisma.usina.findMany({
      where: filtroId ? { id: filtroId } : {},
      include: INCLUDE_FULL,
      orderBy: { nome: 'asc' },
    });
    res.json(usinas.map(shapeUsina));
  }),
);

// ---------- GET /api/usinas/:id ----------
router.get(
  '/:id',
  asyncRoute(async (req, res) => {
    exigirAcessoUsina(req.params.id, req);
    const u = await prisma.usina.findUnique({
      where: { id: req.params.id },
      include: INCLUDE_FULL,
    });
    if (!u) throw httpErrors.notFound('Usina não encontrada');
    res.json(shapeUsina(u));
  }),
);

// ---------- POST /api/usinas (criar) ----------
router.post(
  '/',
  requireAdminOrTecnico,
  asyncRoute(async (req, res) => {
    const data = usinaSchema.parse(req.body);

    // Transação: cria a usina, depois popula previsões/skids com usinaId correto
    const usinaId = await prisma.$transaction(async (tx) => {
      const usina = await tx.usina.create({
        data: {
          nome: data.nome,
          kwp: data.kwp,
          inicio: data.inicio,
          local: data.local,
          obs: data.obs,
          moduloModelo: data.moduloModelo,
          moduloQtd: data.moduloQtd ?? 0,
          moduloW: data.moduloW ?? 400,
          moduloFab: data.moduloFab,
          inversorModelo: data.inversorModelo,
          inversorQtd: data.inversorQtd ?? 0,
          inversorKw: data.inversorKw ?? 110,
          inversorFab: data.inversorFab,
        },
      });

      if (data.previsoes.length) {
        await tx.previsao.createMany({
          data: data.previsoes.map((p) => ({
            usinaId: usina.id,
            mes: p.mes,
            gen: p.gen,
            irrad: p.irrad,
            pr: p.pr,
          })),
        });
      }

      for (const s of data.skids) {
        const skid = await tx.skid.create({
          data: { usinaId: usina.id, nome: s.nome, kwp: s.kwp },
        });
        if (s.previsoes?.length) {
          await tx.previsao.createMany({
            data: s.previsoes.map((p) => ({
              usinaId: usina.id,
              skidId: skid.id,
              mes: p.mes,
              gen: p.gen,
              irrad: p.irrad,
              pr: p.pr,
            })),
          });
        }
      }

      return usina.id;
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        acao: 'create',
        recurso: 'Usina',
        recursoId: usinaId,
        payload: JSON.stringify({ nome: data.nome, kwp: data.kwp }),
      },
    });

    const full = await prisma.usina.findUnique({
      where: { id: usinaId },
      include: INCLUDE_FULL,
    });
    const shaped = shapeUsina(full);
    emit('usina:created', shaped);
    notificarAdmins({
      titulo: '🌞 Nova usina cadastrada',
      body: `${fmtUsuario(req.user)} criou "${shaped.nome}" (${shaped.kwp} kWp) em ${fmtDataHora()}`,
      tipo: 'ok',
      exceto: req.user.id,
    });
    res.status(201).json(shaped);
  }),
);

// ---------- PUT /api/usinas/:id (atualizar) ----------
router.put(
  '/:id',
  requireAdminOrTecnico,
  asyncRoute(async (req, res) => {
    const data = usinaSchema.parse(req.body);
    const id = req.params.id;

    const exists = await prisma.usina.findUnique({ where: { id } });
    if (!exists) throw httpErrors.notFound('Usina não encontrada');

    // Estratégia simples: atualizar campos escalares + recriar previsoes/skids
    await prisma.$transaction(async (tx) => {
      // 1. limpar previsões/skids existentes
      await tx.previsao.deleteMany({ where: { usinaId: id } });
      await tx.skid.deleteMany({ where: { usinaId: id } });

      // 2. atualizar campos escalares
      await tx.usina.update({
        where: { id },
        data: {
          nome: data.nome,
          kwp: data.kwp,
          inicio: data.inicio,
          local: data.local,
          obs: data.obs,
          moduloModelo: data.moduloModelo,
          moduloQtd: data.moduloQtd ?? 0,
          moduloW: data.moduloW ?? 400,
          moduloFab: data.moduloFab,
          inversorModelo: data.inversorModelo,
          inversorQtd: data.inversorQtd ?? 0,
          inversorKw: data.inversorKw ?? 110,
          inversorFab: data.inversorFab,
        },
      });

      // 3. previsoes da usina
      if (data.previsoes.length) {
        await tx.previsao.createMany({
          data: data.previsoes.map((p) => ({
            usinaId: id,
            mes: p.mes,
            gen: p.gen,
            irrad: p.irrad,
            pr: p.pr,
          })),
        });
      }

      // 4. skids (com suas previsoes)
      for (const s of data.skids) {
        const skid = await tx.skid.create({
          data: { usinaId: id, nome: s.nome, kwp: s.kwp },
        });
        if (s.previsoes?.length) {
          await tx.previsao.createMany({
            data: s.previsoes.map((p) => ({
              usinaId: id,
              skidId: skid.id,
              mes: p.mes,
              gen: p.gen,
              irrad: p.irrad,
              pr: p.pr,
            })),
          });
        }
      }
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        acao: 'update',
        recurso: 'Usina',
        recursoId: id,
      },
    });

    const updated = await prisma.usina.findUnique({
      where: { id },
      include: INCLUDE_FULL,
    });
    const shaped = shapeUsina(updated);
    emit('usina:updated', shaped);
    notificarAdmins({
      titulo: '✏️ Usina atualizada',
      body: `${fmtUsuario(req.user)} editou "${shaped.nome}" em ${fmtDataHora()}`,
      tipo: 'info',
      exceto: req.user.id,
    });
    res.json(shaped);
  }),
);

// ---------- DELETE /api/usinas/:id ----------
router.delete(
  '/:id',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const id = req.params.id;
    const exists = await prisma.usina.findUnique({ where: { id } });
    if (!exists) throw httpErrors.notFound('Usina não encontrada');

    await prisma.usina.delete({ where: { id } });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        acao: 'delete',
        recurso: 'Usina',
        recursoId: id,
        payload: JSON.stringify({ nome: exists.nome }),
      },
    });

    emit('usina:deleted', { id });
    notificarAdmins({
      titulo: '🗑️ Usina excluída',
      body: `${fmtUsuario(req.user)} removeu "${exists.nome}" em ${fmtDataHora()}`,
      tipo: 'wn',
      exceto: req.user.id,
    });
    res.json({ ok: true });
  }),
);

export default router;
