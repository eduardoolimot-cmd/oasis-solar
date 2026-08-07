// =================================================
// Geração Diária — CRUD de lançamentos diários + KPIs
// agregados por dia, espelhando as informações do painel
// principal (mensal), porém divididas em dias dentro de
// um único mês. Dado independente do Lancamento mensal.
//
// Hierarquia de lançamento: Usina → SKID → Inversor.
//   - A soma da geração dos inversores de um SKID = geração do SKID.
//   - A soma dos SKIDs = geração da usina.
//   - Irradiação NÃO se soma entre inversores/SKIDs do mesmo dia —
//     é a mesma medição ambiental, por isso é sempre calculada como
//     média (nunca soma) dentro de um dia.
//   - PR só é calculado no nível da usina (nunca por SKID/inversor),
//     sempre a partir dos totais agregados (geração total ÷
//     (kWp da usina × irradiação do período)), nunca pela média dos
//     PRs individuais de cada lançamento.
// =================================================
import { Router } from 'express';
import { prisma } from '../db.js';
import { asyncRoute, httpErrors } from '../lib/http.js';
import {
  lancamentoDiarioSchema,
  lancamentoDiarioFiltroSchema,
  dashboardDiarioFiltroSchema,
} from '../lib/schemas.js';
import { requireAuth, requireAdminOrTecnico } from '../middleware/auth.js';
import { fatorDegradacao } from '../lib/degradacao.js';
import { aplicarFiltroUsinas, exigirAcessoUsina } from '../lib/access.js';

const router = Router();
router.use(requireAuth);

const INCLUDE = {
  usina: { select: { id: true, nome: true } },
  skid: { select: { id: true, nome: true } },
  inversor: { select: { id: true, nome: true } },
  criadoPor: { select: { id: true, nome: true } },
};

function shape(l) {
  return {
    id: l.id,
    usinaId: l.usinaId,
    usinaNome: l.usina?.nome ?? null,
    skidId: l.skidId,
    skidNome: l.skid?.nome ?? null,
    inversorId: l.inversorId,
    inversorNome: l.inversor?.nome ?? null,
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

// PR = Geração / (Potência Pico × Irradiação) — sempre calculado no servidor,
// nunca confiando no valor enviado pelo cliente, e SEMPRE com o kWp total da
// usina (nunca do SKID ou do inversor — ver cabeçalho do arquivo).
function calcularPR(geracao, irrad, kwpUsina) {
  if (!kwpUsina || !irrad) return 0;
  return +((geracao / (kwpUsina * irrad)) * 100).toFixed(2);
}

// Soma a irradiação de um conjunto de lançamentos ao longo de um período:
// para cada dia, tira a MÉDIA dos registros daquele dia (várias entradas do
// mesmo dia — ex: um por inversor — representam a mesma medição, não se
// somam) e depois SOMA essas médias diárias entre os dias do período
// (irradiação acumulada, como convencionado nas Previsões mensais).
function irradTotalPeriodo(lancamentos) {
  const porDia = {};
  for (const l of lancamentos) {
    const key = l.data.toISOString().slice(0, 10);
    (porDia[key] ??= []).push(l.irrad);
  }
  return Object.values(porDia).reduce(
    (soma, vals) => soma + vals.reduce((s, v) => s + v, 0) / vals.length,
    0,
  );
}

// ---------- GET /api/geracao-diaria/kpis?ano=&mes=&usinaId=&skidId= ----------
router.get(
  '/kpis',
  asyncRoute(async (req, res) => {
    const f = dashboardDiarioFiltroSchema.parse(req.query);
    if (f.usinaId) exigirAcessoUsina(f.usinaId, req);

    const allowed = req.user.allowedUsinaIds;
    const usinaWhere = f.usinaId
      ? { id: f.usinaId }
      : allowed
      ? { id: { in: allowed } }
      : {};
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

    const lanWhereBase = { data: { gte: dataIni, lt: dataFim }, usinaId: { in: usinas.map((u) => u.id) } };
    if (f.usinaId) lanWhereBase.usinaId = f.usinaId;

    // `lancamentos`: escopo do filtro (pode incluir SKID) — usado para exibir
    // geração/irradiação/gráficos do recorte que o usuário escolheu.
    const lanWhere = { ...lanWhereBase };
    if (f.skidId) lanWhere.skidId = f.skidId;
    const lancamentos = await prisma.lancamentoDiario.findMany({
      where: lanWhere,
      include: { usina: { select: { id: true, nome: true, kwp: true } } },
    });

    // `lancamentosUsina`: SEMPRE no nível da(s) usina(s) inteira(s), ignorando
    // um eventual filtro de SKID — é a única base válida pra calcular PR
    // (ver cabeçalho do arquivo). Se não há filtro de SKID, é igual ao acima.
    const lancamentosUsina = f.skidId
      ? await prisma.lancamentoDiario.findMany({ where: lanWhereBase })
      : lancamentos;

    const previsoesParaUsina = (u) =>
      u.previsoes.filter((p) => (f.skidId ? p.skidId === f.skidId : p.skidId === null) && p.mes === mesCalculo);

    const skidFiltrado = f.skidId
      ? usinas.flatMap((u) => u.skids).find((s) => s.id === f.skidId)
      : null;
    // kWp para exibição/yield (pode ser do SKID quando filtrado); o PR,
    // no entanto, usa sempre o kWp da usina inteira (ver calcularPR).
    const kwpEfetivo = (u) => (skidFiltrado && skidFiltrado.usinaId === u.id ? skidFiltrado.kwp : u.kwp);
    const kwpTotal = f.skidId
      ? (skidFiltrado?.kwp || 0)
      : usinas.reduce((s, u) => s + (u.kwp || 0), 0);
    const kwpUsinasTotal = usinas.reduce((s, u) => s + (u.kwp || 0), 0);

    // Previsão mensal de geração (já com degradação) e sua fração diária uniforme.
    // Simplificação: distribui o previsto do mês igualmente pelos dias
    // (não há previsão nativa por dia).
    let prevMensal = 0;
    let irradPrevMensal = 0;
    let countIrrPrev = 0;
    usinas.forEach((u) => {
      const prevs = previsoesParaUsina(u);
      const genU = prevs.reduce((s, p) => s + (p.gen || 0), 0);
      prevMensal += genU * degPorUsina[u.id];
      const irrVals = prevs.filter((p) => p.irrad).map((p) => p.irrad);
      if (irrVals.length) {
        irradPrevMensal += irrVals.reduce((s, v) => s + v, 0) / irrVals.length;
        countIrrPrev++;
      }
    });
    const prevDiaria = prevMensal / diasNoMes;
    const irradPrevDiaria = (countIrrPrev > 0 ? irradPrevMensal / countIrrPrev : 0) / diasNoMes;

    // ---------- Geração total do período (real) ----------
    const totalGen = lancamentos.reduce((s, l) => s + l.geracao, 0);
    const variacao = prevMensal ? +(((totalGen - prevMensal) / prevMensal) * 100).toFixed(1) : 0;

    // PR agregado sempre a partir dos totais da USINA INTEIRA (nunca média
    // dos PRs individuais de cada lançamento, nem restrito a um SKID).
    const totalGenUsina = lancamentosUsina.reduce((s, l) => s + l.geracao, 0);
    const irradTotalGeral = irradTotalPeriodo(lancamentosUsina);
    const avgPR = totalGenUsina && kwpUsinasTotal && irradTotalGeral
      ? +((totalGenUsina / (kwpUsinasTotal * irradTotalGeral)) * 100).toFixed(2)
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
      // Irradiação do dia é a MÉDIA das entradas daquele dia (mesma medição
      // repetida por SKID/inversor), nunca a soma.
      const irradReal = ls.length ? ls.reduce((s, l) => s + l.irrad, 0) / ls.length : 0;
      // PR do dia usa sempre o total da usina inteira, mesmo com filtro de SKID.
      const lsUsina = lancamentosUsina.filter((l) => l.data.toISOString().slice(0, 10) === dataStr);
      const gerRealUsinaDia = lsUsina.reduce((s, l) => s + l.geracao, 0);
      const irradRealUsinaDia = lsUsina.length ? lsUsina.reduce((s, l) => s + l.irrad, 0) / lsUsina.length : 0;
      const prDia = gerRealUsinaDia && kwpUsinasTotal && irradRealUsinaDia
        ? +((gerRealUsinaDia / (kwpUsinasTotal * irradRealUsinaDia)) * 100).toFixed(2)
        : 0;

      diasData.push({
        dia: d,
        data: dataStr,
        gerReal,
        gerPrev: +prevDiaria.toFixed(2),
        variacao: prevDiaria ? +(((gerReal - prevDiaria) / prevDiaria) * 100).toFixed(1) : 0,
        irrad: +irradReal.toFixed(2),
        irradPrev: +irradPrevDiaria.toFixed(2),
        pr: prDia,
        disp: ls.length ? +(ls.reduce((s, l) => s + l.disp, 0) / ls.length).toFixed(2) : 0,
      });
    }

    // ---------- Tabela por usina ----------
    const porUsina = usinas.map((u) => {
      const ls = lancamentos.filter((l) => l.usinaId === u.id);
      const gR = ls.reduce((s, l) => s + l.geracao, 0);
      const prevs = previsoesParaUsina(u);
      const gP = prevs.reduce((s, p) => s + (p.gen || 0), 0) * degPorUsina[u.id];
      const dsp = ls.length ? ls.reduce((s, l) => s + l.disp, 0) / ls.length : 0;
      const kwpU = kwpEfetivo(u);
      // PR desta usina no período: geração total da usina inteira (ignora
      // filtro de SKID) ÷ (kWp da usina × irradiação total do período) —
      // nunca média de PRs de SKID/inversor.
      const lsUsina = lancamentosUsina.filter((l) => l.usinaId === u.id);
      const gRUsina = lsUsina.reduce((s, l) => s + l.geracao, 0);
      const irradTotalU = irradTotalPeriodo(lsUsina);
      const pr = gRUsina && u.kwp && irradTotalU ? (gRUsina / (u.kwp * irradTotalU)) * 100 : 0;

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
    aplicarFiltroUsinas(where, req);

    const rows = await prisma.lancamentoDiario.findMany({
      where,
      include: INCLUDE,
      orderBy: [{ data: 'desc' }, { createdAt: 'desc' }],
    });
    res.json(rows.map(shape));
  }),
);

// Valida usina/skid/inversor e retorna o kWp da usina (única base válida pra PR).
async function validarHierarquia(data) {
  const usina = await prisma.usina.findUnique({ where: { id: data.usinaId } });
  if (!usina) throw httpErrors.badRequest('Usina inválida');

  if (data.skidId) {
    const skid = await prisma.skid.findUnique({ where: { id: data.skidId } });
    if (!skid || skid.usinaId !== data.usinaId) {
      throw httpErrors.badRequest('SKID inválido para esta usina');
    }
  } else if (data.inversorId) {
    throw httpErrors.badRequest('Inversor requer um SKID selecionado');
  }

  if (data.inversorId) {
    const inversor = await prisma.inversor.findUnique({ where: { id: data.inversorId } });
    if (!inversor || inversor.skidId !== data.skidId) {
      throw httpErrors.badRequest('Inversor inválido para este SKID');
    }
  }

  return usina;
}

// ---------- POST /api/geracao-diaria ----------
router.post(
  '/',
  requireAdminOrTecnico,
  asyncRoute(async (req, res) => {
    const data = lancamentoDiarioSchema.parse(req.body);
    exigirAcessoUsina(data.usinaId, req);
    const usina = await validarHierarquia(data);

    // PR só é válido no nível da usina inteira — lançamentos de SKID/inversor
    // não carregam um PR próprio (é derivado dos totais em /kpis).
    data.pr = data.skidId ? 0 : calcularPR(data.geracao, data.irrad, usina.kwp);

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
  requireAdminOrTecnico,
  asyncRoute(async (req, res) => {
    const data = lancamentoDiarioSchema.parse(req.body);
    exigirAcessoUsina(data.usinaId, req);
    const exists = await prisma.lancamentoDiario.findUnique({ where: { id: req.params.id } });
    if (!exists) throw httpErrors.notFound('Lançamento diário não encontrado');
    const usina = await validarHierarquia(data);

    data.pr = data.skidId ? 0 : calcularPR(data.geracao, data.irrad, usina.kwp);

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
  requireAdminOrTecnico,
  asyncRoute(async (req, res) => {
    const exists = await prisma.lancamentoDiario.findUnique({ where: { id: req.params.id } });
    if (!exists) throw httpErrors.notFound('Lançamento diário não encontrado');
    exigirAcessoUsina(exists.usinaId, req);

    await prisma.lancamentoDiario.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  }),
);

export default router;
