// CRUD de Lançamentos de geração + importação CSV
import { Router } from 'express';
import { prisma } from '../db.js';
import { asyncRoute, httpErrors } from '../lib/http.js';
import {
  lancamentoSchema,
  lancamentoFiltroSchema,
} from '../lib/schemas.js';
import {
  requireAuth,
  requireAdminOrTecnico,
} from '../middleware/auth.js';
import { uploadCSV } from '../lib/upload.js';
import { parseLancamentosCSV } from '../lib/csv.js';
import { emit } from '../realtime.js';
import { aplicarFiltroUsinas, exigirAcessoUsina } from '../lib/access.js';
import { notificarAdmins, fmtUsuario, fmtDataHora } from '../lib/notificar.js';

const router = Router();
router.use(requireAuth);

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
    periodo: l.periodo,
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

// ---------- GET /api/lancamentos ----------
router.get(
  '/',
  asyncRoute(async (req, res) => {
    const filtros = lancamentoFiltroSchema.parse(req.query);

    const where = {};
    if (filtros.usinaId) where.usinaId = filtros.usinaId;
    if (filtros.skidId) where.skidId = filtros.skidId;
    if (filtros.ano && filtros.mes) {
      where.periodo = `${filtros.ano}-${filtros.mes}`;
    } else if (filtros.ano) {
      where.periodo = { startsWith: `${filtros.ano}-` };
    } else if (filtros.mes) {
      where.periodo = { endsWith: `-${filtros.mes}` };
    }
    aplicarFiltroUsinas(where, req);

    const rows = await prisma.lancamento.findMany({
      where,
      include: INCLUDE,
      orderBy: [{ periodo: 'desc' }, { createdAt: 'desc' }],
    });
    res.json(rows.map(shape));
  }),
);

// ---------- GET /api/lancamentos/:id ----------
router.get(
  '/:id',
  asyncRoute(async (req, res) => {
    const l = await prisma.lancamento.findUnique({
      where: { id: req.params.id },
      include: INCLUDE,
    });
    if (!l) throw httpErrors.notFound('Lançamento não encontrado');
    res.json(shape(l));
  }),
);

// ---------- POST /api/lancamentos ----------
router.post(
  '/',
  requireAdminOrTecnico,
  asyncRoute(async (req, res) => {
    const data = lancamentoSchema.parse(req.body);

    // Valida que a usina existe
    const usina = await prisma.usina.findUnique({
      where: { id: data.usinaId },
    });
    if (!usina) throw httpErrors.badRequest('Usina inválida');

    // Se houver skidId, valida que pertence a essa usina
    if (data.skidId) {
      const skid = await prisma.skid.findUnique({
        where: { id: data.skidId },
      });
      if (!skid || skid.usinaId !== data.usinaId) {
        throw httpErrors.badRequest('SKID inválido para esta usina');
      }
    }

    const created = await prisma.lancamento.create({
      data: { ...data, criadoPorId: req.user.id },
      include: INCLUDE,
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        acao: 'create',
        recurso: 'Lancamento',
        recursoId: created.id,
        payload: JSON.stringify({
          usina: created.usina.nome,
          periodo: created.periodo,
          geracao: created.geracao,
        }),
      },
    });

    const shaped = shape(created);
    emit('lancamento:created', shaped);
    notificarAdmins({
      titulo: '⚡ Novo lançamento de geração',
      body: `${fmtUsuario(req.user)} registrou ${shaped.geracao.toLocaleString('pt-BR')} kWh em ${shaped.usinaNome} (${shaped.periodo}) — ${fmtDataHora()}`,
      tipo: 'ok',
      exceto: req.user.id,
    });
    res.status(201).json(shaped);
  }),
);

// ---------- PUT /api/lancamentos/:id ----------
router.put(
  '/:id',
  requireAdminOrTecnico,
  asyncRoute(async (req, res) => {
    const data = lancamentoSchema.parse(req.body);
    const exists = await prisma.lancamento.findUnique({
      where: { id: req.params.id },
    });
    if (!exists) throw httpErrors.notFound('Lançamento não encontrado');

    const updated = await prisma.lancamento.update({
      where: { id: req.params.id },
      data,
      include: INCLUDE,
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        acao: 'update',
        recurso: 'Lancamento',
        recursoId: updated.id,
      },
    });

    const shaped = shape(updated);
    emit('lancamento:updated', shaped);
    notificarAdmins({
      titulo: '✏️ Lançamento editado',
      body: `${fmtUsuario(req.user)} editou ${shaped.usinaNome} (${shaped.periodo}) → ${shaped.geracao.toLocaleString('pt-BR')} kWh — ${fmtDataHora()}`,
      tipo: 'info',
      exceto: req.user.id,
    });
    res.json(shaped);
  }),
);

// ---------- DELETE /api/lancamentos/:id ----------
router.delete(
  '/:id',
  requireAdminOrTecnico,
  asyncRoute(async (req, res) => {
    const exists = await prisma.lancamento.findUnique({
      where: { id: req.params.id },
    });
    if (!exists) throw httpErrors.notFound('Lançamento não encontrado');

    await prisma.lancamento.delete({ where: { id: req.params.id } });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        acao: 'delete',
        recurso: 'Lancamento',
        recursoId: req.params.id,
      },
    });

    emit('lancamento:deleted', { id: req.params.id });
    notificarAdmins({
      titulo: '🗑️ Lançamento excluído',
      body: `${fmtUsuario(req.user)} removeu ${exists.periodo} de ${exists.usinaId ? '(usina ' + exists.usinaId.slice(0, 8) + ')' : ''} — ${fmtDataHora()}`,
      tipo: 'wn',
      exceto: req.user.id,
    });
    res.json({ ok: true });
  }),
);

// ---------- POST /api/lancamentos/importar (multipart CSV) ----------
router.post(
  '/importar',
  requireAdminOrTecnico,
  uploadCSV.single('file'),
  asyncRoute(async (req, res) => {
    if (!req.file) throw httpErrors.badRequest('Arquivo CSV ausente');

    const parsed = parseLancamentosCSV(req.file.buffer);
    if (!parsed.dados.length) {
      throw httpErrors.badRequest(
        'Nenhum mês encontrado no CSV. Verifique se segue o modelo.',
      );
    }

    // Permite override via campos do form (usinaId, skidId, ano)
    const usinaId = req.body.usinaId;
    const skidId = req.body.skidId || null;
    const ano = req.body.ano || parsed.ano;

    if (!usinaId) {
      throw httpErrors.badRequest(
        'usinaId é obrigatório no form (junto com o arquivo)',
      );
    }
    if (!ano || !/^\d{4}$/.test(ano)) {
      throw httpErrors.badRequest(
        'Ano inválido ou ausente (deve estar no CSV ou ser enviado como campo do form)',
      );
    }

    const usina = await prisma.usina.findUnique({ where: { id: usinaId } });
    if (!usina) throw httpErrors.badRequest('Usina inválida');

    if (skidId) {
      const skid = await prisma.skid.findUnique({ where: { id: skidId } });
      if (!skid || skid.usinaId !== usinaId) {
        throw httpErrors.badRequest('SKID inválido para esta usina');
      }
    }

    let added = 0;
    let updated = 0;
    const erros = [];

    for (const d of parsed.dados) {
      const periodo = `${ano}-${String(d.mes).padStart(2, '0')}`;
      try {
        // Prisma não aceita null em unique composta no `where`, então fazemos
        // upsert manual: findFirst + create/update.
        const existente = await prisma.lancamento.findFirst({
          where: { usinaId, skidId: skidId ?? null, periodo },
          select: { id: true },
        });

        if (existente) {
          await prisma.lancamento.update({
            where: { id: existente.id },
            data: {
              geracao: d.gen,
              irrad: d.irr,
              pr: d.pr,
              disp: d.dsp,
              obs: 'Importado via planilha',
            },
          });
          updated++;
        } else {
          await prisma.lancamento.create({
            data: {
              usinaId,
              skidId,
              periodo,
              geracao: d.gen,
              irrad: d.irr,
              pr: d.pr,
              disp: d.dsp,
              obs: 'Importado via planilha',
              criadoPorId: req.user.id,
            },
          });
          added++;
        }
      } catch (e) {
        erros.push({ periodo, erro: e.message });
      }
    }

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        acao: 'import',
        recurso: 'Lancamento',
        recursoId: usinaId,
        payload: JSON.stringify({
          usina: usina.nome,
          ano,
          skidId,
          added,
          updated,
          erros: erros.length,
        }),
      },
    });

    if (added > 0 || updated > 0) {
      emit('lancamento:batch', { usinaId, ano, added, updated });
    }

    res.json({
      ok: true,
      usina: usina.nome,
      ano,
      skidId,
      processados: parsed.dados.length,
      added,
      updated,
      erros,
    });
  }),
);

// ---------- POST /api/lancamentos/importar/preview ----------
// Lê e valida o CSV sem persistir nada — útil para preview no frontend
router.post(
  '/importar/preview',
  requireAdminOrTecnico,
  uploadCSV.single('file'),
  asyncRoute(async (req, res) => {
    if (!req.file) throw httpErrors.badRequest('Arquivo CSV ausente');
    const parsed = parseLancamentosCSV(req.file.buffer);
    res.json({
      usina: parsed.usina,
      skid: parsed.skid,
      ano: parsed.ano,
      dados: parsed.dados,
      total: parsed.dados.length,
    });
  }),
);

export default router;
