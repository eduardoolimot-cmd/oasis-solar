// CRUD Financeiro
import { Router } from 'express';
import { prisma } from '../db.js';
import { asyncRoute, httpErrors } from '../lib/http.js';
import {
  financeiroSchema,
  financeiroFiltroSchema,
} from '../lib/schemas.js';
import {
  requireAuth,
  requireAdminOrTecnico,
} from '../middleware/auth.js';
import { emit } from '../realtime.js';
import { aplicarFiltroUsinas } from '../lib/access.js';

const router = Router();
router.use(requireAuth);

const INCLUDE = {
  usina: { select: { id: true, nome: true } },
  criadoPor: { select: { id: true, nome: true } },
};

function shape(f) {
  return {
    id: f.id,
    usinaId: f.usinaId,
    usinaNome: f.usina?.nome ?? null,
    tipo: f.tipo,
    data: f.data,
    cat: f.cat,
    desc: f.desc,
    val: f.val,
    st: f.st,
    criadoPor: f.criadoPor?.nome ?? null,
    createdAt: f.createdAt,
    updatedAt: f.updatedAt,
  };
}

// ---------- GET /api/financeiro/categorias ----------
// Lista categorias já usadas (distinct) — incluindo as default sempre presentes.
const CATEGORIAS_PADRAO = [
  'Energia Gerada', 'Manutenção', 'Seguro',
  'Arrendamento', 'Impostos', 'O&M', 'Outros',
];

router.get(
  '/categorias',
  asyncRoute(async (req, res) => {
    const rows = await prisma.financeiro.findMany({
      select: { cat: true },
      distinct: ['cat'],
      where: { cat: { not: '' } },
    });
    const usadas = rows.map((r) => r.cat).filter(Boolean);
    // une padrão + usadas, mantém ordem padrão primeiro
    const unicas = Array.from(new Set([...CATEGORIAS_PADRAO, ...usadas]));
    res.json({ categorias: unicas });
  }),
);

router.get(
  '/',
  asyncRoute(async (req, res) => {
    const f = financeiroFiltroSchema.parse(req.query);
    const where = {};
    if (f.usinaId) where.usinaId = f.usinaId;
    if (f.tipo) where.tipo = f.tipo;
    if (f.st) where.st = f.st;
    if (f.ano) {
      where.data = {
        gte: new Date(`${f.ano}-01-01T00:00:00.000Z`),
        lt: new Date(`${parseInt(f.ano) + 1}-01-01T00:00:00.000Z`),
      };
    }
    aplicarFiltroUsinas(where, req);
    const rows = await prisma.financeiro.findMany({
      where,
      include: INCLUDE,
      orderBy: [{ data: 'desc' }, { createdAt: 'desc' }],
    });
    res.json(rows.map(shape));
  }),
);

// Endpoint agregador (KPIs do tab financeiro)
router.get(
  '/sumario',
  asyncRoute(async (req, res) => {
    const f = financeiroFiltroSchema.parse(req.query);
    const where = {};
    if (f.usinaId) where.usinaId = f.usinaId;
    if (f.ano) {
      where.data = {
        gte: new Date(`${f.ano}-01-01T00:00:00.000Z`),
        lt: new Date(`${parseInt(f.ano) + 1}-01-01T00:00:00.000Z`),
      };
    }
    aplicarFiltroUsinas(where, req);

    const all = await prisma.financeiro.findMany({ where });
    const rec = all.filter((x) => x.tipo === 'rec').reduce((s, x) => s + x.val, 0);
    const des = all.filter((x) => x.tipo === 'des').reduce((s, x) => s + x.val, 0);
    const liq = rec - des;
    const margem = rec ? +(((liq / rec) * 100).toFixed(2)) : 0;

    // Receitas e despesas por mês
    const recMes = Array.from({ length: 12 }, () => 0);
    const desMes = Array.from({ length: 12 }, () => 0);
    for (const r of all) {
      const m = new Date(r.data).getUTCMonth();
      if (r.tipo === 'rec') recMes[m] += r.val;
      else desMes[m] += r.val;
    }

    // Agregação por categoria (separa receitas e despesas)
    const acc = (tipo) => {
      const grupos = {};
      for (const r of all) {
        if (r.tipo !== tipo) continue;
        const cat = r.cat || 'Sem categoria';
        if (!grupos[cat]) grupos[cat] = { categoria: cat, total: 0, qtd: 0 };
        grupos[cat].total += r.val;
        grupos[cat].qtd += 1;
      }
      return Object.values(grupos).sort((a, b) => b.total - a.total);
    };

    res.json({
      ano: f.ano ?? null,
      usinaId: f.usinaId ?? null,
      totais: {
        receitas: rec,
        despesas: des,
        liquido: liq,
        margem,
        qtdReceitas: all.filter((x) => x.tipo === 'rec').length,
        qtdDespesas: all.filter((x) => x.tipo === 'des').length,
      },
      mensal: { receitas: recMes, despesas: desMes },
      porCategoria: {
        despesas: acc('des'),
        receitas: acc('rec'),
      },
    });
  }),
);

router.get(
  '/:id',
  asyncRoute(async (req, res) => {
    const f = await prisma.financeiro.findUnique({
      where: { id: req.params.id },
      include: INCLUDE,
    });
    if (!f) throw httpErrors.notFound('Lançamento não encontrado');
    res.json(shape(f));
  }),
);

router.post(
  '/',
  requireAdminOrTecnico,
  asyncRoute(async (req, res) => {
    const data = financeiroSchema.parse(req.body);
    const usina = await prisma.usina.findUnique({
      where: { id: data.usinaId },
    });
    if (!usina) throw httpErrors.badRequest('Usina inválida');

    const created = await prisma.financeiro.create({
      data: { ...data, criadoPorId: req.user.id },
      include: INCLUDE,
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        acao: 'create',
        recurso: 'Financeiro',
        recursoId: created.id,
        payload: JSON.stringify({ tipo: created.tipo, val: created.val }),
      },
    });

    const shaped = shape(created);
    emit('financeiro:created', shaped);
    res.status(201).json(shaped);
  }),
);

router.put(
  '/:id',
  requireAdminOrTecnico,
  asyncRoute(async (req, res) => {
    const data = financeiroSchema.parse(req.body);
    const exists = await prisma.financeiro.findUnique({
      where: { id: req.params.id },
    });
    if (!exists) throw httpErrors.notFound('Lançamento não encontrado');

    const updated = await prisma.financeiro.update({
      where: { id: req.params.id },
      data,
      include: INCLUDE,
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        acao: 'update',
        recurso: 'Financeiro',
        recursoId: updated.id,
      },
    });

    const shaped = shape(updated);
    emit('financeiro:updated', shaped);
    res.json(shaped);
  }),
);

router.delete(
  '/:id',
  requireAdminOrTecnico,
  asyncRoute(async (req, res) => {
    const exists = await prisma.financeiro.findUnique({
      where: { id: req.params.id },
    });
    if (!exists) throw httpErrors.notFound('Lançamento não encontrado');

    await prisma.financeiro.delete({ where: { id: req.params.id } });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        acao: 'delete',
        recurso: 'Financeiro',
        recursoId: req.params.id,
      },
    });

    emit('financeiro:deleted', { id: req.params.id });
    res.json({ ok: true });
  }),
);

export default router;
