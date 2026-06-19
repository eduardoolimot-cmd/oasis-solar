// CRUD de Fit Energia (relatórios de faturamento PDF)
import { Router } from 'express';
import path from 'node:path';
import { prisma } from '../db.js';
import { asyncRoute, httpErrors } from '../lib/http.js';
import { fitEnergiaSchema, fitFiltroSchema } from '../lib/schemas.js';
import {
  requireAuth, requireAdminOrTecnico,
} from '../middleware/auth.js';
import { uploadFitPDF, uploadFitExcel, UPLOAD_ROOT } from '../lib/upload.js';
import { parseFitPDF } from '../lib/fit-parser.js';
import { parseFitExcel } from '../lib/fit-excel-parser.js';
import { emit } from '../realtime.js';
import { aplicarFiltroUsinas, exigirAcessoUsina } from '../lib/access.js';
import { notificarAdmins, fmtUsuario, fmtDataHora } from '../lib/notificar.js';

const router = Router();
router.use(requireAuth);

const INCLUDE = {
  usina: { select: { id: true, nome: true, kwp: true } },
  skid: { select: { id: true, nome: true } },
  criadoPor: { select: { id: true, nome: true } },
};

function shape(f) {
  return {
    id: f.id,
    usinaId: f.usinaId,
    usinaNome: f.usina?.nome ?? null,
    usinaKwp: f.usina?.kwp ?? null,
    skidId: f.skidId,
    skidNome: f.skid?.nome ?? null,
    periodo: f.periodo,
    geracaoKwh: f.geracaoKwh,
    valorFaturado: f.valorFaturado,
    tarifa: f.tarifa,
    distribuidora: f.distribuidora,
    beneficiarios: f.beneficiarios,
    arquivoUrl: f.arquivoUrl,
    arquivoNome: f.arquivoNome,
    obs: f.obs,
    criadoPor: f.criadoPor?.nome ?? null,
    createdAt: f.createdAt,
    updatedAt: f.updatedAt,
  };
}

// ---------- GET /api/fit ----------
router.get(
  '/',
  asyncRoute(async (req, res) => {
    const f = fitFiltroSchema.parse(req.query);
    const where = {};
    if (f.usinaId) where.usinaId = f.usinaId;
    if (f.skidId) where.skidId = f.skidId;
    if (f.ano && f.mes) where.periodo = `${f.ano}-${f.mes}`;
    else if (f.ano) where.periodo = { startsWith: `${f.ano}-` };
    else if (f.mes) where.periodo = { endsWith: `-${f.mes}` };
    aplicarFiltroUsinas(where, req);

    const rows = await prisma.fitEnergia.findMany({
      where,
      include: INCLUDE,
      orderBy: [{ periodo: 'desc' }, { createdAt: 'desc' }],
    });
    res.json(rows.map(shape));
  }),
);

// ---------- GET /api/fit/:id ----------
router.get(
  '/:id',
  asyncRoute(async (req, res) => {
    const f = await prisma.fitEnergia.findUnique({
      where: { id: req.params.id },
      include: INCLUDE,
    });
    if (!f) throw httpErrors.notFound('Registro não encontrado');
    exigirAcessoUsina(f.usinaId, req);
    res.json(shape(f));
  }),
);

// ---------- POST /api/fit/upload/preview ----------
// Recebe PDF, extrai dados e devolve sem salvar. Frontend usa para preview editável.
router.post(
  '/upload/preview',
  requireAdminOrTecnico,
  uploadFitPDF.single('file'),
  asyncRoute(async (req, res) => {
    if (!req.file) throw httpErrors.badRequest('Arquivo PDF ausente');
    let parsed;
    try {
      parsed = await parseFitPDF(req.file.buffer);
    } catch (e) {
      throw httpErrors.badRequest(`Falha ao ler PDF: ${e.message}`);
    }
    res.json({
      ok: true,
      arquivoNome: req.file.originalname,
      ...parsed,
    });
  }),
);

// ---------- POST /api/fit ----------
// Cria/atualiza registro com os dados editados pelo usuário
router.post(
  '/',
  requireAdminOrTecnico,
  asyncRoute(async (req, res) => {
    const data = fitEnergiaSchema.parse(req.body);
    const arquivoNome = req.body.arquivoNome || null;

    const usina = await prisma.usina.findUnique({ where: { id: data.usinaId } });
    if (!usina) throw httpErrors.badRequest('Usina inválida');
    exigirAcessoUsina(data.usinaId, req);

    // Valida SKID se informado
    if (data.skidId) {
      const skid = await prisma.skid.findUnique({ where: { id: data.skidId } });
      if (!skid || skid.usinaId !== data.usinaId) {
        throw httpErrors.badRequest('SKID inválido para esta usina');
      }
    }

    // tarifa auto se vier 0 e tiver geração + valor
    const tarifa = data.tarifa || (data.geracaoKwh > 0 ? +(data.valorFaturado / data.geracaoKwh).toFixed(4) : 0);

    // upsert por (usina, skid, período) — usa findFirst pra suportar skidId=null
    const existente = await prisma.fitEnergia.findFirst({
      where: { usinaId: data.usinaId, skidId: data.skidId ?? null, periodo: data.periodo },
      select: { id: true },
    });

    let saved;
    if (existente) {
      saved = await prisma.fitEnergia.update({
        where: { id: existente.id },
        data: { ...data, tarifa, arquivoNome },
        include: INCLUDE,
      });
    } else {
      saved = await prisma.fitEnergia.create({
        data: { ...data, tarifa, arquivoNome, criadoPorId: req.user.id },
        include: INCLUDE,
      });
    }

    const shaped = shape(saved);
    emit('fit:created', shaped);
    notificarAdmins({
      titulo: '📄 Faturamento Fit registrado',
      body: `${fmtUsuario(req.user)}: ${shaped.usinaNome} ${shaped.periodo} → ${shaped.geracaoKwh.toLocaleString('pt-BR')} kWh / R$ ${shaped.valorFaturado.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} — ${fmtDataHora()}`,
      tipo: 'ok',
      exceto: req.user.id,
    });

    res.status(existente ? 200 : 201).json(shaped);
  }),
);

// ---------- PUT /api/fit/:id ----------
router.put(
  '/:id',
  requireAdminOrTecnico,
  asyncRoute(async (req, res) => {
    const data = fitEnergiaSchema.parse(req.body);
    const exists = await prisma.fitEnergia.findUnique({ where: { id: req.params.id } });
    if (!exists) throw httpErrors.notFound('Registro não encontrado');
    exigirAcessoUsina(data.usinaId, req);

    const tarifa = data.tarifa || (data.geracaoKwh > 0 ? +(data.valorFaturado / data.geracaoKwh).toFixed(4) : 0);
    const updated = await prisma.fitEnergia.update({
      where: { id: req.params.id },
      data: { ...data, tarifa },
      include: INCLUDE,
    });
    const shaped = shape(updated);
    emit('fit:updated', shaped);
    res.json(shaped);
  }),
);

// ---------- DELETE /api/fit/:id ----------
router.delete(
  '/:id',
  requireAdminOrTecnico,
  asyncRoute(async (req, res) => {
    const exists = await prisma.fitEnergia.findUnique({ where: { id: req.params.id } });
    if (!exists) throw httpErrors.notFound('Registro não encontrado');
    await prisma.fitEnergia.delete({ where: { id: req.params.id } });
    emit('fit:deleted', { id: req.params.id });
    res.json({ ok: true });
  }),
);

// ---------- POST /api/fit/excel/preview ----------
// Recebe XLSX, parseia e devolve preview sem persistir.
router.post(
  '/excel/preview',
  requireAdminOrTecnico,
  uploadFitExcel.single('file'),
  asyncRoute(async (req, res) => {
    if (!req.file) throw httpErrors.badRequest('Arquivo Excel ausente');
    const anoFallback = req.body.anoFallback ? parseInt(req.body.anoFallback) : null;
    let parsed;
    try {
      parsed = parseFitExcel(req.file.buffer, { anoFallback });
    } catch (e) {
      throw httpErrors.badRequest(`Falha ao ler Excel: ${e.message}`);
    }
    res.json({
      ok: true,
      arquivoNome: req.file.originalname,
      sheets: parsed.sheets,
      sheetUsado: parsed.sheetUsado,
      colunas: parsed.colunas,
      resumo: parsed.resumo,
      linhasIgnoradas: parsed.linhasIgnoradas,
      items: parsed.items,
    });
  }),
);

// ---------- POST /api/fit/excel/import ----------
// Body: { usinaId, skidId?, items: [{periodo, geracaoKwh, valorFaturado, tarifa, distribuidora, beneficiarios}], arquivoNome? }
// Persiste em lote — upsert por (usinaId, skidId, periodo).
router.post(
  '/excel/import',
  requireAdminOrTecnico,
  asyncRoute(async (req, res) => {
    const { usinaId, skidId, items, arquivoNome } = req.body || {};
    if (!usinaId) throw httpErrors.badRequest('usinaId é obrigatório');
    if (!Array.isArray(items) || !items.length) throw httpErrors.badRequest('Sem itens para importar');

    const usina = await prisma.usina.findUnique({ where: { id: usinaId } });
    if (!usina) throw httpErrors.badRequest('Usina inválida');
    exigirAcessoUsina(usinaId, req);

    if (skidId) {
      const skid = await prisma.skid.findUnique({ where: { id: skidId } });
      if (!skid || skid.usinaId !== usinaId) {
        throw httpErrors.badRequest('SKID inválido para esta usina');
      }
    }

    let added = 0;
    let updated = 0;
    const erros = [];
    const salvos = [];

    for (const it of items) {
      try {
        if (!it.periodo || !/^\d{4}-(0[1-9]|1[0-2])$/.test(it.periodo)) {
          erros.push({ ...it, erro: `Período inválido: ${it.periodo}` });
          continue;
        }
        const geracaoKwh = parseFloat(it.geracaoKwh) || 0;
        const valorFaturado = parseFloat(it.valorFaturado) || 0;
        const tarifa = parseFloat(it.tarifa) || (geracaoKwh > 0 ? +(valorFaturado / geracaoKwh).toFixed(4) : 0);

        const existente = await prisma.fitEnergia.findFirst({
          where: { usinaId, skidId: skidId ?? null, periodo: it.periodo },
          select: { id: true },
        });

        let row;
        if (existente) {
          row = await prisma.fitEnergia.update({
            where: { id: existente.id },
            data: {
              geracaoKwh, valorFaturado, tarifa,
              distribuidora: it.distribuidora || null,
              beneficiarios: it.beneficiarios ? parseInt(it.beneficiarios) : null,
              arquivoNome: arquivoNome || null,
            },
            include: INCLUDE,
          });
          updated++;
        } else {
          row = await prisma.fitEnergia.create({
            data: {
              usinaId, skidId: skidId || null, periodo: it.periodo,
              geracaoKwh, valorFaturado, tarifa,
              distribuidora: it.distribuidora || null,
              beneficiarios: it.beneficiarios ? parseInt(it.beneficiarios) : null,
              arquivoNome: arquivoNome || null,
              criadoPorId: req.user.id,
            },
            include: INCLUDE,
          });
          added++;
        }
        salvos.push(shape(row));
      } catch (e) {
        erros.push({ ...it, erro: e.message });
      }
    }

    if (added > 0 || updated > 0) emit('fit:batch', { usinaId, added, updated });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        acao: 'import',
        recurso: 'FitEnergia',
        recursoId: usinaId,
        payload: JSON.stringify({ added, updated, erros: erros.length, arquivoNome }),
      },
    });

    notificarAdmins({
      titulo: '📊 Faturamento Fit importado (Excel)',
      body: `${fmtUsuario(req.user)}: ${usina.nome} → ${added} novos, ${updated} atualizados em ${fmtDataHora()}`,
      tipo: 'ok',
      exceto: req.user.id,
    });

    res.json({
      ok: true,
      processados: items.length,
      added,
      updated,
      erros,
      salvos,
    });
  }),
);

// ---------- GET /api/fit/comparativo ----------
// Junta lançamentos (medidos pela usina) × fit (relatório da distribuidora) por mês
router.get(
  '/relatorio/comparativo',
  asyncRoute(async (req, res) => {
    const f = fitFiltroSchema.parse(req.query);
    const where = {};
    if (f.usinaId) where.usinaId = f.usinaId;
    if (f.ano) where.periodo = { startsWith: `${f.ano}-` };
    aplicarFiltroUsinas(where, req);

    const [fits, lancs] = await Promise.all([
      prisma.fitEnergia.findMany({
        where,
        include: {
          usina: { select: { id: true, nome: true } },
          skid: { select: { id: true, nome: true } },
        },
      }),
      prisma.lancamento.findMany({
        where,
        include: {
          usina: { select: { id: true, nome: true } },
          skid: { select: { id: true, nome: true } },
        },
      }),
    ]);

    // Agrupa por usina+periodo
    const mapa = new Map(); // key = usinaId|periodo
    function obter(usinaId, periodo, nome) {
      const key = `${usinaId}|${periodo}`;
      if (!mapa.has(key)) {
        mapa.set(key, {
          usinaId, usinaNome: nome, periodo,
          geracaoUsina: 0,         // medido pela usina (lancamentos)
          geracaoFit: 0,           // reportado no relatório fit
          valorFaturado: 0,
          tarifa: 0,
        });
      }
      return mapa.get(key);
    }
    for (const l of lancs) {
      const o = obter(l.usinaId, l.periodo, l.usina.nome);
      o.geracaoUsina += l.geracao;
    }
    for (const ft of fits) {
      const o = obter(ft.usinaId, ft.periodo, ft.usina.nome);
      o.geracaoFit += ft.geracaoKwh;
      o.valorFaturado += ft.valorFaturado;
      o.tarifa = ft.tarifa;
    }
    // calcula diff
    const items = [...mapa.values()].map((x) => {
      const diff = x.geracaoUsina && x.geracaoFit ? x.geracaoFit - x.geracaoUsina : 0;
      const pct = x.geracaoUsina ? +((diff / x.geracaoUsina) * 100).toFixed(2) : 0;
      return { ...x, diff, pct };
    });
    items.sort((a, b) => b.periodo.localeCompare(a.periodo) || a.usinaNome.localeCompare(b.usinaNome));

    res.json({ items, total: items.length });
  }),
);

export default router;
