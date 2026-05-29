// Endpoint agregador do dashboard — KPIs prontos para o front
import { Router } from 'express';
import { prisma } from '../db.js';
import { asyncRoute } from '../lib/http.js';
import { dashboardFiltroSchema } from '../lib/schemas.js';
import { requireAuth } from '../middleware/auth.js';
import { exigirAcessoUsina } from '../lib/access.js';
import { fatorDegradacao } from '../lib/degradacao.js';

const router = Router();
router.use(requireAuth);

// Calcula tempo de operação em anos+meses a partir da menor data de início
function calcOpTime(usinas) {
  const datas = usinas.filter((u) => u.inicio).map((u) => new Date(u.inicio));
  if (!datas.length) return { val: 'N/D', sub: 'Sem data de início' };
  const oldest = new Date(Math.min(...datas.map((d) => d.getTime())));
  const now = new Date();
  const totalM =
    (now.getFullYear() - oldest.getFullYear()) * 12 +
    (now.getMonth() - oldest.getMonth());
  const yrs = Math.floor(totalM / 12);
  const mths = totalM % 12;
  return {
    val: yrs > 0 ? `${yrs}a ${mths}m` : `${mths}m`,
    sub:
      yrs > 0
        ? `${yrs} ano${yrs > 1 ? 's' : ''} e ${mths} mês${mths !== 1 ? 'es' : ''}`
        : `${mths} meses operando`,
  };
}

// GET /api/dashboard/kpis?ano=&mes=&usinaId=&skidId=
router.get(
  '/kpis',
  asyncRoute(async (req, res) => {
    const f = dashboardFiltroSchema.parse(req.query);

    // Se filtrou por usina específica, valida o acesso
    if (f.usinaId) exigirAcessoUsina(f.usinaId, req);

    // Sem filtro: limita às usinas acessíveis (ADMIN não tem limite)
    const allowed = req.user.allowedUsinaIds;
    const usinaWhere = f.usinaId
      ? { id: f.usinaId }
      : allowed
      ? { id: { in: allowed } }
      : {};

    // ---------- Selecionar usinas alvo ----------
    const usinas = await prisma.usina.findMany({
      where: usinaWhere,
      include: {
        previsoes: true,
        skids: true,
      },
    });

    // ---------- Filtrar lançamentos ----------
    const lanWhere = {};
    if (f.usinaId) lanWhere.usinaId = f.usinaId;
    else if (allowed) lanWhere.usinaId = { in: allowed };
    if (f.skidId) lanWhere.skidId = f.skidId;
    if (f.ano && f.mes) lanWhere.periodo = `${f.ano}-${f.mes}`;
    else if (f.ano) lanWhere.periodo = { startsWith: `${f.ano}-` };
    else if (f.mes) lanWhere.periodo = { endsWith: `-${f.mes}` };

    const lancamentos = await prisma.lancamento.findMany({
      where: lanWhere,
      include: { usina: { select: { id: true, nome: true, kwp: true } } },
    });

    // Ano de cálculo para a degradação (default: ano atual)
    const anoCalculo = f.ano ? parseInt(f.ano) : new Date().getFullYear();
    // Cache do fator de degradação por usina
    const degPorUsina = Object.fromEntries(
      usinas.map((u) => [u.id, fatorDegradacao(u.inicio, anoCalculo)]),
    );

    // ---------- Escopo do cálculo: SKID ou Usina inteira ----------
    // Quando f.skidId está setado, todos os cálculos devem usar:
    //   - previsões com skidId === f.skidId
    //   - kwp do SKID (não da usina)
    // Senão, usa previsões da usina (skidId === null) e kwp da usina.
    const skidFiltrado = f.skidId
      ? usinas.flatMap((u) => u.skids).find((s) => s.id === f.skidId)
      : null;

    // Helper que retorna as previsões a usar para uma usina
    const previsoesParaUsina = (u) =>
      u.previsoes.filter((p) => (f.skidId ? p.skidId === f.skidId : p.skidId === null));

    // kWp efetivo: do SKID se filtrado, senão da usina
    const kwpEfetivo = (u) => (skidFiltrado && skidFiltrado.usinaId === u.id ? skidFiltrado.kwp : u.kwp);
    const kwpTotal = f.skidId
      ? (skidFiltrado?.kwp || 0)
      : usinas.reduce((s, u) => s + (u.kwp || 0), 0);

    // Helper: soma previsão de um campo (gen/irrad) já aplicada degradação para 'gen'
    const somaPrevisao = (campo, mesFiltro) =>
      usinas.reduce((soma, u) => {
        const prevs = previsoesParaUsina(u)
          .filter((p) => !mesFiltro || p.mes === mesFiltro);
        const valor = prevs.reduce((s, p) => s + (p[campo] || 0), 0);
        return soma + (campo === 'gen' ? valor * degPorUsina[u.id] : valor);
      }, 0);

    // ---------- KPI: Geração total ----------
    const totalGen = lancamentos.reduce((s, l) => s + l.geracao, 0);

    // ---------- KPI: Previsão (com degradação aplicada) ----------
    const mesFiltro = f.mes ? parseInt(f.mes) : null;
    const prevGen = somaPrevisao('gen', mesFiltro);
    const variacao = prevGen ? +(((totalGen - prevGen) / prevGen) * 100).toFixed(1) : 0;

    // ---------- KPI: PR e Disponibilidade médios ----------
    const avgPR = lancamentos.length
      ? +(lancamentos.reduce((s, l) => s + l.pr, 0) / lancamentos.length).toFixed(2)
      : 0;
    const avgDisp = lancamentos.length
      ? +(lancamentos.reduce((s, l) => s + l.disp, 0) / lancamentos.length).toFixed(2)
      : 0;

    // ---------- KPI: Tempo de operação ----------
    const opTime = calcOpTime(usinas);

    // ---------- Tabela mês a mês (12 meses) ----------
    const mesesData = [];
    for (let m = 1; m <= 12; m++) {
      const mm = String(m).padStart(2, '0');
      const periodo = f.ano ? `${f.ano}-${mm}` : null;
      const ls = lancamentos.filter((l) => l.periodo.endsWith(`-${mm}`));
      const gerReal = ls.reduce((s, l) => s + l.geracao, 0);

      // Soma previsões do mês, aplicando degradação por usina
      // Quando há filtro de SKID, usa previsão do SKID em vez da usina
      let gerPrev = 0;
      let irradPrev = 0;
      let prPrev = 0;
      let countPrev = 0;
      usinas.forEach((u) => {
        const prevs = previsoesParaUsina(u).filter((p) => p.mes === m);
        if (!prevs.length) return;
        const genU = prevs.reduce((s, p) => s + (p.gen || 0), 0);
        gerPrev += genU * degPorUsina[u.id];
        const irrU = prevs.filter((p) => p.irrad).reduce((s, p) => s + p.irrad, 0);
        const prU = prevs.filter((p) => p.pr).reduce((s, p) => s + p.pr, 0);
        const nIrr = prevs.filter((p) => p.irrad).length;
        const nPr = prevs.filter((p) => p.pr).length;
        if (nIrr > 0) { irradPrev += irrU / nIrr; countPrev++; }
        if (nPr > 0) prPrev += prU / nPr;
      });
      if (countPrev > 0) irradPrev = irradPrev / countPrev;
      if (countPrev > 0) prPrev = prPrev / countPrev;

      const irradReal = ls.length
        ? ls.reduce((s, l) => s + l.irrad, 0) / ls.length
        : 0;
      const yieldReal = kwpTotal > 0 ? gerReal / kwpTotal : 0;
      const yieldPrev = kwpTotal > 0 ? gerPrev / kwpTotal : 0;

      mesesData.push({
        mes: m,
        periodo,
        gerReal,
        gerPrev,
        variacao: gerPrev ? +(((gerReal - gerPrev) / gerPrev) * 100).toFixed(1) : 0,
        irrad: +irradReal.toFixed(2),
        irradPrev: +irradPrev.toFixed(2),
        pr: ls.length
          ? +(ls.reduce((s, l) => s + l.pr, 0) / ls.length).toFixed(2)
          : 0,
        prPrev: +prPrev.toFixed(2),
        disp: ls.length
          ? +(ls.reduce((s, l) => s + l.disp, 0) / ls.length).toFixed(2)
          : 0,
        yieldReal: +yieldReal.toFixed(2),
        yieldPrev: +yieldPrev.toFixed(2),
      });
    }

    // ---------- Tabela por usina (com degradação aplicada) ----------
    // Conjunto de meses que têm lançamentos (1..12) — usado quando NÃO há filtro de mês,
    // para evitar comparar 'real até o mês X' com 'previsão de 12 meses'.
    const mesesComLancPorUsina = {};
    for (const l of lancamentos) {
      const mm = parseInt(l.periodo.split('-')[1]);
      if (!mesesComLancPorUsina[l.usinaId]) mesesComLancPorUsina[l.usinaId] = new Set();
      mesesComLancPorUsina[l.usinaId].add(mm);
    }

    const porUsina = usinas.map((u) => {
      const ls = lancamentos.filter((l) => l.usinaId === u.id);
      const gR = ls.reduce((s, l) => s + l.geracao, 0);
      // Quando há filtro de SKID, usa as previsões do SKID; senão, da usina
      const previsoesAnuais = previsoesParaUsina(u);

      let prevsParaSomar;
      if (mesFiltro) {
        prevsParaSomar = previsoesAnuais.filter((p) => p.mes === mesFiltro);
      } else {
        const mesesUsina = mesesComLancPorUsina[u.id];
        prevsParaSomar = mesesUsina && mesesUsina.size > 0
          ? previsoesAnuais.filter((p) => mesesUsina.has(p.mes))
          : previsoesAnuais;
      }
      const gP = prevsParaSomar.reduce((s, p) => s + p.gen, 0) * degPorUsina[u.id];

      const pr = ls.length
        ? ls.reduce((s, l) => s + l.pr, 0) / ls.length
        : previsoesAnuais[0]?.pr || 0;
      const dsp = ls.length
        ? ls.reduce((s, l) => s + l.disp, 0) / ls.length
        : 0;
      const variacao = gP ? ((gR - gP) / gP) * 100 : 0;
      // Yield usa o kWp efetivo (SKID se filtrado, senão usina)
      const kwpU = kwpEfetivo(u);

      return {
        id: u.id,
        nome: skidFiltrado && skidFiltrado.usinaId === u.id ? `${u.nome} / ${skidFiltrado.nome}` : u.nome,
        kwp: kwpU,
        gerReal: gR,
        gerPrev: gP,
        variacao: +variacao.toFixed(1),
        yieldReal: kwpU ? +(gR / kwpU).toFixed(2) : 0,
        yieldPrev: kwpU ? +(gP / kwpU).toFixed(2) : 0,
        pr: +pr.toFixed(2),
        disp: +dsp.toFixed(2),
        degradacao: +((1 - degPorUsina[u.id]) * 100).toFixed(2),
        mesesComDados: mesesComLancPorUsina[u.id]?.size || 0,
        status: dsp < 95 || pr < 78 ? 'Alerta' : 'Ativo',
      };
    });

    // ---------- Distribuição por usina (gráfico de pizza) ----------
    const distribuicao = usinas.map((u) => ({
      nome: skidFiltrado && skidFiltrado.usinaId === u.id ? `${u.nome} / ${skidFiltrado.nome}` : u.nome,
      kwp: kwpEfetivo(u),
      geracao: lancamentos
        .filter((l) => l.usinaId === u.id)
        .reduce((s, l) => s + l.geracao, 0),
    }));

    res.json({
      filtros: f,
      kpis: {
        geracao: {
          valor: totalGen,
          previsto: prevGen,
          variacao,
        },
        disponibilidade: {
          valor: avgDisp,
          meta: 98,
        },
        operacao: opTime,
        pr: {
          valor: avgPR,
          referencia: 80,
          meta: 85,
        },
        produtividade: {
          valor: kwpTotal > 0 ? +(totalGen / kwpTotal).toFixed(2) : 0,
          unidade: 'kWh/kWp',
        },
      },
      mesesData,
      porUsina,
      distribuicao,
      totalLancamentos: lancamentos.length,
      kwpTotal,
      anoCalculo,
    });
  }),
);

export default router;
