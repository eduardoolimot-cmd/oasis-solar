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
import { uploadCSV } from '../lib/upload.js';
import { parseFinanceiroCSV } from '../lib/csv-fin.js';
import { notificarAdmins, fmtUsuario, fmtDataHora } from '../lib/notificar.js';

const TIPO_LBL = { rec: 'Receita', des: 'Despesa', fin: 'Financiamento' };

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

    // Filtro multi-categoria: ?cats=A,B,C ou ?cats=A&cats=B
    let cats = req.query.cats;
    if (typeof cats === 'string' && cats.length) {
      cats = cats.split(',').map((s) => s.trim()).filter(Boolean);
    }
    if (Array.isArray(cats) && cats.length) where.cat = { in: cats };
    else if (req.query.cat) where.cat = req.query.cat; // compat single

    // Janela de tempo (ano + mês opcional)
    if (f.ano && f.mes) {
      const ini = new Date(`${f.ano}-${f.mes}-01T00:00:00.000Z`);
      const fim = new Date(ini); fim.setUTCMonth(fim.getUTCMonth() + 1);
      where.data = { gte: ini, lt: fim };
    } else if (f.ano) {
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

    // Janela temporal: ano + mês opcional (mesma lógica do GET /)
    if (f.ano && f.mes) {
      const ini = new Date(`${f.ano}-${f.mes}-01T00:00:00.000Z`);
      const fim = new Date(ini); fim.setUTCMonth(fim.getUTCMonth() + 1);
      where.data = { gte: ini, lt: fim };
    } else if (f.ano) {
      where.data = {
        gte: new Date(`${f.ano}-01-01T00:00:00.000Z`),
        lt: new Date(`${parseInt(f.ano) + 1}-01-01T00:00:00.000Z`),
      };
    }
    aplicarFiltroUsinas(where, req);

    const all = await prisma.financeiro.findMany({ where });
    const rec = all.filter((x) => x.tipo === 'rec').reduce((s, x) => s + x.val, 0);
    const des = all.filter((x) => x.tipo === 'des').reduce((s, x) => s + x.val, 0);
    const fin = all.filter((x) => x.tipo === 'fin').reduce((s, x) => s + x.val, 0);
    const liqOperacional = rec - des;                   // sem financiamento
    const liqTotal = rec - des - fin;                   // com financiamento
    const margem = rec ? +(((liqOperacional / rec) * 100).toFixed(2)) : 0;

    // Por mês: receitas, despesas e financiamentos
    const recMes = Array.from({ length: 12 }, () => 0);
    const desMes = Array.from({ length: 12 }, () => 0);
    const finMes = Array.from({ length: 12 }, () => 0);
    for (const r of all) {
      const m = new Date(r.data).getUTCMonth();
      if (r.tipo === 'rec') recMes[m] += r.val;
      else if (r.tipo === 'des') desMes[m] += r.val;
      else if (r.tipo === 'fin') finMes[m] += r.val;
    }

    // Agregação por categoria
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
      mes: f.mes ?? null,
      usinaId: f.usinaId ?? null,
      totais: {
        receitas: rec,
        despesas: des,
        financiamentos: fin,
        liquido: liqOperacional,         // mantém nome antigo (compat)
        liquidoOperacional: liqOperacional,
        liquidoTotal: liqTotal,
        margem,
        qtdReceitas: all.filter((x) => x.tipo === 'rec').length,
        qtdDespesas: all.filter((x) => x.tipo === 'des').length,
        qtdFinanciamentos: all.filter((x) => x.tipo === 'fin').length,
      },
      mensal: { receitas: recMes, despesas: desMes, financiamentos: finMes },
      porCategoria: {
        receitas: acc('rec'),
        despesas: acc('des'),
        financiamentos: acc('fin'),
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
    notificarAdmins({
      titulo: '💰 Novo lançamento financeiro',
      body: `${fmtUsuario(req.user)}: ${TIPO_LBL[shaped.tipo]} de R$ ${shaped.val.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (${shaped.cat}) em ${shaped.usinaNome} — ${fmtDataHora()}`,
      tipo: shaped.tipo === 'rec' ? 'ok' : 'info',
      exceto: req.user.id,
    });
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
    notificarAdmins({
      titulo: '✏️ Lançamento financeiro editado',
      body: `${fmtUsuario(req.user)}: ${TIPO_LBL[shaped.tipo]} (${shaped.cat}) ${shaped.usinaNome} → R$ ${shaped.val.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} — ${fmtDataHora()}`,
      tipo: 'info',
      exceto: req.user.id,
    });
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
    notificarAdmins({
      titulo: '🗑️ Lançamento financeiro excluído',
      body: `${fmtUsuario(req.user)} removeu ${TIPO_LBL[exists.tipo]} R$ ${exists.val.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (${exists.cat}) — ${fmtDataHora()}`,
      tipo: 'wn',
      exceto: req.user.id,
    });
    res.json({ ok: true });
  }),
);

// ---------- POST /api/financeiro/importar/preview ----------
// Faz o parse do CSV sem persistir nada. Retorna preview + diagnósticos.
router.post(
  '/importar/preview',
  requireAdminOrTecnico,
  uploadCSV.single('file'),
  asyncRoute(async (req, res) => {
    if (!req.file) throw httpErrors.badRequest('Arquivo CSV ausente');

    let parsed;
    try {
      parsed = parseFinanceiroCSV(req.file.buffer);
    } catch (e) {
      throw httpErrors.badRequest(`Falha no parse: ${e.message}`);
    }

    // Casamento usina (nome) → id
    const usinasDB = await prisma.usina.findMany({ select: { id: true, nome: true } });
    const mapNome = new Map(usinasDB.map((u) => [u.nome, u.id]));
    const usinasNaoEncontradas = parsed.resumo.usinasDoArquivo.filter(
      (n) => !mapNome.has(n),
    );

    res.json({
      ok: parsed.itens.length > 0,
      resumo: parsed.resumo,
      linhasIgnoradas: parsed.linhasIgnoradas,
      usinasNaoEncontradas,
      itens: parsed.itens, // payload completo, frontend usa pra editar/confirmar
    });
  }),
);

// ---------- POST /api/financeiro/importar ----------
// Persiste os lançamentos (espera body com {ano, itens, modo: 'substituir'|'mesclar'})
router.post(
  '/importar',
  requireAdminOrTecnico,
  asyncRoute(async (req, res) => {
    const { ano, itens, modo, usinaOverrideId } = req.body || {};
    if (!ano || !/^\d{4}$/.test(String(ano))) {
      throw httpErrors.badRequest('Ano inválido (deve ser AAAA)');
    }
    if (!Array.isArray(itens) || itens.length === 0) {
      throw httpErrors.badRequest('Nenhum item para importar');
    }

    // Resolve usinas
    const usinasDB = await prisma.usina.findMany({ select: { id: true, nome: true } });
    const mapNome = new Map(usinasDB.map((u) => [u.nome, u.id]));

    // Se foi escolhida uma usina override, valida que existe
    let usinaOverrideObj = null;
    if (usinaOverrideId) {
      usinaOverrideObj = usinasDB.find((u) => u.id === usinaOverrideId);
      if (!usinaOverrideObj) throw httpErrors.badRequest('Usina destino inválida');
    }

    // Helper que resolve a usina final de um item:
    //   1) Se há override, todos vão pra ele
    //   2) Senão, usa o nome do CSV
    const resolveUsina = (it) => usinaOverrideObj?.id || mapNome.get(it.usina);

    // Se modo='substituir', remove lançamentos antigos do ano para essas usinas + categorias
    if (modo === 'substituir') {
      const usinaIds = [...new Set(itens.map(resolveUsina).filter(Boolean))];
      const categorias = [...new Set(itens.map((i) => i.categoria))];
      const del = await prisma.financeiro.deleteMany({
        where: {
          usinaId: { in: usinaIds },
          cat: { in: categorias },
          data: {
            gte: new Date(`${ano}-01-01T00:00:00.000Z`),
            lt: new Date(`${parseInt(ano) + 1}-01-01T00:00:00.000Z`),
          },
        },
      });
      console.log(`[import-fin] removidos ${del.count} lançamentos antigos`);
    }

    let added = 0;
    let updated = 0;
    const erros = [];

    for (const it of itens) {
      const usinaId = resolveUsina(it);
      if (!usinaId) {
        erros.push({ ...it, erro: `Usina "${it.usina}" não encontrada` });
        continue;
      }
      const mes = parseInt(it.mes);
      if (!mes || mes < 1 || mes > 12) {
        erros.push({ ...it, erro: `Mês inválido: ${it.mes}` });
        continue;
      }
      const data = new Date(`${ano}-${String(mes).padStart(2, '0')}-01T00:00:00.000Z`);
      // Preserva o tipo original do parser ('rec'|'des'|'fin')
      const tipo = ['rec', 'des', 'fin'].includes(it.tipo) ? it.tipo : 'des';

      try {
        if (modo === 'mesclar') {
          // upsert manual por (usina, cat, mês, tipo)
          const existente = await prisma.financeiro.findFirst({
            where: { usinaId, cat: it.categoria, tipo, data },
            select: { id: true },
          });
          if (existente) {
            await prisma.financeiro.update({
              where: { id: existente.id },
              data: { val: it.val },
            });
            updated++;
            continue;
          }
        }
        // create
        await prisma.financeiro.create({
          data: {
            usinaId, tipo,
            data,
            cat: it.categoria,
            desc: 'Importado via planilha financeira',
            val: it.val,
            st: 'pg',
            criadoPorId: req.user.id,
          },
        });
        added++;
      } catch (e) {
        erros.push({ ...it, erro: e.message });
      }
    }

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        acao: 'import',
        recurso: 'Financeiro',
        payload: JSON.stringify({ ano, modo, added, updated, erros: erros.length }),
      },
    });

    if (added > 0 || updated > 0) {
      emit('financeiro:batch', { ano, added, updated });
    }

    res.json({
      ok: true,
      ano, modo,
      added, updated,
      erros,
      totalProcessado: itens.length,
    });
  }),
);

export default router;
