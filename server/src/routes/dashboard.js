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
    // kWp total das usinas no escopo (usado para yield agregado)
    const kwpTotal = usinas.reduce((s, u) => s + (u.kwp || 0), 0);

    // Helper: soma previsão de um campo (gen/irrad) já aplicada degradação para 'gen'
    const somaPrevisao = (campo, mesFiltro) =>
      usinas.reduce((soma, u) => {
        const prevs = u.previsoes
          .filter((p) => p.skidId === null)
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
      let gerPrev = 0;
      let irradPrev = 0;
      let prPrev = 0;
      let countPrev = 0;
      usinas.forEach((u) => {
        const p = u.previsoes.find((p) => p.mes === m && p.skidId === null);
        if (!p) return;
        gerPrev += (p.gen || 0) * degPorUsina[u.id];
        if (p.irrad) {
          irradPrev += p.irrad;
          countPrev++;
        }
        if (p.pr) prPrev += p.pr;
      });
      if (countPrev > 0) irradPrev = irradPrev / countPrev; // média
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
      const previsoesAnuais = u.previsoes.filter((p) => p.skidId === null);

      // Filtro de previsão: respeita mês explícito; se não tiver, respeita os meses
      // que realmente têm lançamento (para comparação justa). Se não tem nenhum
      // lançamento ainda, mostra os 12 meses inteiros.
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
        : u.previsoes[0]?.pr || 0;
      const dsp = ls.length
        ? ls.reduce((s, l) => s + l.disp, 0) / ls.length
        : 0;
      const variacao = gP ? ((gR - gP) / gP) * 100 : 0;

      return {
        id: u.id,
        nome: u.nome,
        kwp: u.kwp,
        gerReal: gR,
        gerPrev: gP,
        variacao: +variacao.toFixed(1),
        yieldReal: u.kwp ? +(gR / u.kwp).toFixed(2) : 0,
        yieldPrev: u.kwp ? +(gP / u.kwp).toFixed(2) : 0,
        pr: +pr.toFixed(2),
        disp: +dsp.toFixed(2),
        degradacao: +((1 - degPorUsina[u.id]) * 100).toFixed(2),
        mesesComDados: mesesComLancPorUsina[u.id]?.size || 0,
        status: dsp < 95 || pr < 78 ? 'Alerta' : 'Ativo',
      };
    });

    // ---------- Distribuição por usina (gráfico de pizza) ----------
    const distribuicao = usinas.map((u) => ({
      nome: u.nome,
      kwp: u.kwp,
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
