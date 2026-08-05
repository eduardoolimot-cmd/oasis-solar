// =================================================
// Geração Diária — recurso EM TESTE, restrito a ADMIN.
// CRUD de lançamentos diários + KPIs agregados por dia,
// espelhando as informações do painel principal (mensal),
// porém divididas em dias dentro de um único mês.
// =================================================
import { Router } from 'express';
import { prisma } from '../db.js';
import { asyncRoute, httpErrors } from '../lib/http.js';
import {
  lancamentoDiarioSchema,
  lancamentoDiarioFiltroSchema,
  dashboardDiarioFiltroSchema,
} from '../lib/schemas.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { fatorDegradacao } from '../lib/degradacao.js';

const router = Router();
// Toda a aba de Geração Diária é restrita a ADMIN enquanto estiver em teste.
router.use(requireAuth, requireAdmin);

const INCLUDE = {
  usina: { select: { id: true, nome: true } },
  skid: { select: { id: true, nome: true } },
  criadoPor: { select: { id: true, nome: true } },
};

function shape(l) {
  return {
    id: l.id,
    usinaId: l.usinaId,
    usinaNome: l.usina?.nome ?? null,
    skidId: l.skidId,
    skidNome: l.skid?.nome ?? null,
    data: l.data.toISOString().slice(0, 10),
    geracao: l.geracao,
    irrad: l.irrad,
    pr: l.pr,
    disp: l.disp,
    obs: l.obs,
    criadoPor: l.criadoPor?.nome ?? null,
    createdAt: l.createdAt,
    updatedAt: l.updatedAt,
  };
}

// ---------- GET /api/geracao-diaria/kpis?ano=&mes=&usinaId=&skidId= ----------
router.get(
  '/kpis',
  asyncRoute(async (req, res) => {
    const f = dashboardDiarioFiltroSchema.parse(req.query);

    const usinaWhere = f.usinaId ? { id: f.usinaId } : {};
    const usinas = await prisma.usina.findMany({
      where: usinaWhere,
      include: { previsoes: true, skids: true },
    });

    const anoCalculo = parseInt(f.ano);
    const mesCalculo = parseInt(f.mes);
    const diasNoMes = new Date(Date.UTC(anoCalculo, mesCalculo, 0)).getUTCDate();
    const dataIni = new Date(Date.UTC(anoCalculo, mesCalculo - 1, 1));
    const dataFim = new Date(Date.UTC(anoCalculo, mesCalculo, 1));

    const degPorUsina = Object.fromEntries(
      usinas.map((u) => [u.id, fatorDegradacao(u.inicio, anoCalculo)]),
    );

    const lanWhere = { data: { gte: dataIni, lt: dataFim } };
    if (f.usinaId) lanWhere.usinaId = f.usinaId;
    else lanWhere.usinaId = { in: usinas.map((u) => u.id) };
    if (f.skidId) lanWhere.skidId = f.skidId;

    const lancamentos = await prisma.lancamentoDiario.findMany({
      where: lanWhere,
      include: { usina: { select: { id: true, nome: true, kwp: true } } },
    });

    const previsoesParaUsina = (u) =>
      u.previsoes.filter((p) => (f.skidId ? p.skidId === f.skidId : p.skidId === null) && p.mes === mesCalculo);

    const skidFiltrado = f.skidId
      ? usinas.flatMap((u) => u.skids).find((s) => s.id === f.skidId)
      : null;
    const kwpEfetivo = (u) => (skidFiltrado && skidFiltrado.usinaId === u.id ? skidFiltrado.kwp : u.kwp);
    const kwpTotal = f.skidId
      ? (skidFiltrado?.kwp || 0)
      : usinas.reduce((s, u) => s + (u.kwp || 0), 0);

    // Previsão mensal (já com degradação) e sua fração diária uniforme.
    // Simplificação: distribui o previsto do mês igualmente pelos dias
    // (não há previsão nativa por dia — este recurso está em teste).
    let prevMensal = 0;
    usinas.forEach((u) => {
      const prevs = previsoesParaUsina(u);
      const genU = prevs.reduce((s, p) => s + (p.gen || 0), 0);
      prevMensal += genU * degPorUsina[u.id];
    });
    const prevDiaria = prevMensal / diasNoMes;

    // ---------- Geração total do mês (real) ----------
    const totalGen = lancamentos.reduce((s, l) => s + l.geracao, 0);
    const variacao = prevMensal ? +(((totalGen - prevMensal) / prevMensal) * 100).toFixed(1) : 0;

    const avgPR = lancamentos.length
      ? +(lancamentos.reduce((s, l) => s + l.pr, 0) / lancamentos.length).toFixed(2)
      : 0;
    const avgDisp = lancamentos.length
      ? +(lancamentos.reduce((s, l) => s + l.disp, 0) / lancamentos.length).toFixed(2)
      : 0;

    // ---------- Tabela dia a dia ----------
    const diasData = [];
    for (let d = 1; d <= diasNoMes; d++) {
      const dd = String(d).padStart(2, '0');
      const dataStr = `${f.ano}-${f.mes}-${dd}`;
      const ls = lancamentos.filter((l) => l.data.toISOString().slice(0, 10) === dataStr);
      const gerReal = ls.reduce((s, l) => s + l.geracao, 0);
      const irradReal = ls.length ? ls.reduce((s, l) => s + l.irrad, 0) / ls.length : 0;

      diasData.push({
        dia: d,
        data: dataStr,
        gerReal,
        gerPrev: +prevDiaria.toFixed(2),
        variacao: prevDiaria ? +(((gerReal - prevDiaria) / prevDiaria) * 100).toFixed(1) : 0,
        irrad: +irradReal.toFixed(2),
        pr: ls.length ? +(ls.reduce((s, l) => s + l.pr, 0) / ls.length).toFixed(2) : 0,
        disp: ls.length ? +(ls.reduce((s, l) => s + l.disp, 0) / ls.length).toFixed(2) : 0,
      });
    }

    // ---------- Tabela por usina ----------
    const porUsina = usinas.map((u) => {
      const ls = lancamentos.filter((l) => l.usinaId === u.id);
      const gR = ls.reduce((s, l) => s + l.geracao, 0);
      const prevs = previsoesParaUsina(u);
      const gP = prevs.reduce((s, p) => s + (p.gen || 0), 0) * degPorUsina[u.id];
      const pr = ls.length ? ls.reduce((s, l) => s + l.pr, 0) / ls.length : 0;
      const dsp = ls.length ? ls.reduce((s, l) => s + l.disp, 0) / ls.length : 0;
      const kwpU = kwpEfetivo(u);

      return {
        id: u.id,
        nome: skidFiltrado && skidFiltrado.usinaId === u.id ? `${u.nome} / ${skidFiltrado.nome}` : u.nome,
        kwp: kwpU,
        gerReal: gR,
        gerPrev: gP,
        variacao: gP ? +(((gR - gP) / gP) * 100).toFixed(1) : 0,
        yieldReal: kwpU ? +(gR / kwpU).toFixed(2) : 0,
        yieldPrev: kwpU ? +(gP / kwpU).toFixed(2) : 0,
        pr: +pr.toFixed(2),
        disp: +dsp.toFixed(2),
        degradacao: +((1 - degPorUsina[u.id]) * 100).toFixed(2),
      };
    });

    const distribuicao = usinas.map((u) => ({
      nome: skidFiltrado && skidFiltrado.usinaId === u.id ? `${u.nome} / ${skidFiltrado.nome}` : u.nome,
      kwp: kwpEfetivo(u),
      geracao: lancamentos.filter((l) => l.usinaId === u.id).reduce((s, l) => s + l.geracao, 0),
    }));

    res.json({
      filtros: f,
      diasNoMes,
      kpis: {
        geracao: { valor: totalGen, previsto: prevMensal, variacao },
        disponibilidade: { valor: avgDisp, meta: 98 },
        pr: { valor: avgPR, referencia: 80, meta: 85 },
        produtividade: {
          valor: kwpTotal > 0 ? +(totalGen / kwpTotal).toFixed(2) : 0,
          unidade: 'kWh/kWp',
        },
      },
      diasData,
      porUsina,
      distribuicao,
      totalLancamentos: lancamentos.length,
      kwpTotal,
    });
  }),
);

// ---------- GET /api/geracao-diaria ----------
router.get(
  '/',
  asyncRoute(async (req, res) => {
    const filtros = lancamentoDiarioFiltroSchema.parse(req.query);
    const where = {};
    if (filtros.usinaId) where.usinaId = filtros.usinaId;
    if (filtros.skidId) where.skidId = filtros.skidId;
    if (filtros.ano && filtros.mes) {
      const ano = parseInt(filtros.ano);
      const mes = parseInt(filtros.mes);
      where.data = { gte: new Date(Date.UTC(ano, mes - 1, 1)), lt: new Date(Date.UTC(ano, mes, 1)) };
    } else if (filtros.ano) {
      const ano = parseInt(filtros.ano);
      where.data = { gte: new Date(Date.UTC(ano, 0, 1)), lt: new Date(Date.UTC(ano + 1, 0, 1)) };
    }

    const rows = await prisma.lancamentoDiario.findMany({
      where,
      include: INCLUDE,
      orderBy: [{ data: 'desc' }, { createdAt: 'desc' }],
    });
    res.json(rows.map(shape));
  }),
);

// ---------- POST /api/geracao-diaria ----------
router.post(
  '/',
  asyncRoute(async (req, res) => {
    const data = lancamentoDiarioSchema.parse(req.body);

    const usina = await prisma.usina.findUnique({ where: { id: data.usinaId } });
    if (!usina) throw httpErrors.badRequest('Usina inválida');

    if (data.skidId) {
      const skid = await prisma.skid.findUnique({ where: { id: data.skidId } });
      if (!skid || skid.usinaId !== data.usinaId) {
        throw httpErrors.badRequest('SKID inválido para esta usina');
      }
    }

    const created = await prisma.lancamentoDiario.create({
      data: { ...data, criadoPorId: req.user.id },
      include: INCLUDE,
    });

    res.status(201).json(shape(created));
  }),
);

// ---------- PUT /api/geracao-diaria/:id ----------
router.put(
  '/:id',
  asyncRoute(async (req, res) => {
    const data = lancamentoDiarioSchema.parse(req.body);
    const exists = await prisma.lancamentoDiario.findUnique({ where: { id: req.params.id } });
    if (!exists) throw httpErrors.notFound('Lançamento diário não encontrado');

    const updated = await prisma.lancamentoDiario.update({
      where: { id: req.params.id },
      data,
      include: INCLUDE,
    });
    res.json(shape(updated));
  }),
);

// ---------- DELETE /api/geracao-diaria/:id ----------
router.delete(
  '/:id',
  asyncRoute(async (req, res) => {
    const exists = await prisma.lancamentoDiario.findUnique({ where: { id: req.params.id } });
    if (!exists) throw httpErrors.notFound('Lançamento diário não encontrado');

    await prisma.lancamentoDiario.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  }),
);

export default router;
