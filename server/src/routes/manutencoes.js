// CRUD de Manutenções + upload de arquivos
import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../db.js';
import { asyncRoute, httpErrors } from '../lib/http.js';
import {
  manutencaoSchema,
  manutencaoFiltroSchema,
  manutencaoStatusSchema,
} from '../lib/schemas.js';
import {
  requireAuth,
  requireAdminOrTecnico,
} from '../middleware/auth.js';
import { uploadManutencao, UPLOAD_ROOT } from '../lib/upload.js';
import { emit } from '../realtime.js';
import { aplicarFiltroUsinas, exigirAcessoUsina } from '../lib/access.js';
import { notificarAdmins, fmtUsuario, fmtDataHora } from '../lib/notificar.js';

const router = Router();
router.use(requireAuth);

const INCLUDE = {
  usina: { select: { id: true, nome: true } },
  criadoPor: { select: { id: true, nome: true } },
  arquivos: true,
};

function shape(m) {
  const agora = new Date();
  const vencida = m.vencimento && m.status !== 'ok' && new Date(m.vencimento) < agora;
  return {
    id: m.id,
    usinaId: m.usinaId,
    usinaNome: m.usina?.nome ?? null,
    tipo: m.tipo,
    status: m.status,
    titulo: m.titulo,
    data: m.data,
    vencimento: m.vencimento,
    vencida: !!vencida,
    resp: m.resp,
    comp: m.comp,
    detalhe: m.detalhe,
    criadoPor: m.criadoPor?.nome ?? null,
    criadoPorId: m.criadoPorId ?? null,
    arquivos: (m.arquivos || []).map((a) => ({
      id: a.id,
      nome: a.nome,
      url: a.url,
      mime: a.mime,
      tamanho: a.tamanho,
      isImg: a.mime?.startsWith('image/'),
    })),
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
  };
}

// ---------- GET /api/manutencoes ----------
router.get(
  '/',
  asyncRoute(async (req, res) => {
    const f = manutencaoFiltroSchema.parse(req.query);
    const where = {};
    if (f.usinaId) where.usinaId = f.usinaId;
    if (f.tipo) where.tipo = f.tipo;
    if (f.status) where.status = f.status;
    if (f.ano) {
      where.data = {
        gte: new Date(`${f.ano}-01-01T00:00:00.000Z`),
        lt: new Date(`${parseInt(f.ano) + 1}-01-01T00:00:00.000Z`),
      };
    }
    aplicarFiltroUsinas(where, req);
    const rows = await prisma.manutencao.findMany({
      where,
      include: INCLUDE,
      orderBy: [{ data: 'desc' }, { createdAt: 'desc' }],
    });
    res.json(rows.map(shape));
  }),
);

router.get(
  '/:id',
  asyncRoute(async (req, res) => {
    const m = await prisma.manutencao.findUnique({
      where: { id: req.params.id },
      include: INCLUDE,
    });
    if (!m) throw httpErrors.notFound('Manutenção não encontrada');
    res.json(shape(m));
  }),
);

// ---------- POST /api/manutencoes ----------
router.post(
  '/',
  requireAdminOrTecnico,
  asyncRoute(async (req, res) => {
    const data = manutencaoSchema.parse(req.body);
    const usina = await prisma.usina.findUnique({
      where: { id: data.usinaId },
    });
    if (!usina) throw httpErrors.badRequest('Usina inválida');

    const created = await prisma.manutencao.create({
      data: { ...data, criadoPorId: req.user.id },
      include: INCLUDE,
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        acao: 'create',
        recurso: 'Manutencao',
        recursoId: created.id,
        payload: JSON.stringify({ titulo: created.titulo }),
      },
    });

    const shaped = shape(created);
    emit('manutencao:created', shaped);
    const venc = shaped.vencimento ? ` (vence em ${new Date(shaped.vencimento).toLocaleDateString('pt-BR')})` : '';
    notificarAdmins({
      titulo: '🔧 Nova ordem de manutenção',
      body: `${fmtUsuario(req.user)} criou "${shaped.titulo}" em ${shaped.usinaNome}${venc} — ${fmtDataHora()}`,
      tipo: 'info',
      exceto: req.user.id,
    });
    res.status(201).json(shaped);
  }),
);

router.put(
  '/:id',
  requireAdminOrTecnico,
  asyncRoute(async (req, res) => {
    const data = manutencaoSchema.parse(req.body);
    const exists = await prisma.manutencao.findUnique({
      where: { id: req.params.id },
    });
    if (!exists) throw httpErrors.notFound('Manutenção não encontrada');

    // Se o vencimento foi alterado, reseta a flag pra notificar de novo se vencer
    const vencimentoMudou = (exists.vencimento?.getTime() || 0) !== (data.vencimento?.getTime() || 0);
    const updateData = { ...data };
    if (vencimentoMudou) updateData.vencimentoNotificado = false;

    const updated = await prisma.manutencao.update({
      where: { id: req.params.id },
      data: updateData,
      include: INCLUDE,
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        acao: 'update',
        recurso: 'Manutencao',
        recursoId: updated.id,
      },
    });

    const shaped = shape(updated);
    emit('manutencao:updated', shaped);
    notificarAdmins({
      titulo: '✏️ Manutenção editada',
      body: `${fmtUsuario(req.user)} editou "${shaped.titulo}" em ${shaped.usinaNome} — ${fmtDataHora()}`,
      tipo: 'info',
      exceto: req.user.id,
    });
    res.json(shaped);
  }),
);

// PATCH /:id/status — mover entre colunas do Kanban
router.patch(
  '/:id/status',
  requireAdminOrTecnico,
  asyncRoute(async (req, res) => {
    const { status } = manutencaoStatusSchema.parse(req.body);
    const exists = await prisma.manutencao.findUnique({
      where: { id: req.params.id },
    });
    if (!exists) throw httpErrors.notFound('Manutenção não encontrada');

    const updated = await prisma.manutencao.update({
      where: { id: req.params.id },
      data: { status },
      include: INCLUDE,
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        acao: 'update',
        recurso: 'Manutencao',
        recursoId: updated.id,
        payload: JSON.stringify({ status }),
      },
    });

    const shaped = shape(updated);
    emit('manutencao:updated', shaped);
    const STATUS_LBL = { plan: 'Planejada', exec: 'Em Execução', ok: 'Concluída' };
    notificarAdmins({
      titulo: '🔄 Manutenção movida no Kanban',
      body: `${fmtUsuario(req.user)} moveu "${shaped.titulo}" → ${STATUS_LBL[status]} (${shaped.usinaNome}) — ${fmtDataHora()}`,
      tipo: status === 'ok' ? 'ok' : 'info',
      exceto: req.user.id,
    });
    res.json(shaped);
  }),
);

router.delete(
  '/:id',
  requireAdminOrTecnico,
  asyncRoute(async (req, res) => {
    const m = await prisma.manutencao.findUnique({
      where: { id: req.params.id },
      include: { arquivos: true },
    });
    if (!m) throw httpErrors.notFound('Manutenção não encontrada');

    // remove arquivos físicos antes de deletar (cascade no DB também limpa as rows)
    for (const a of m.arquivos) {
      try {
        const filePath = path.join(UPLOAD_ROOT, a.url);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } catch {
        /* ignora falhas de IO */
      }
    }

    await prisma.manutencao.delete({ where: { id: m.id } });
    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        acao: 'delete',
        recurso: 'Manutencao',
        recursoId: m.id,
      },
    });
    emit('manutencao:deleted', { id: m.id });
    notificarAdmins({
      titulo: '🗑️ Manutenção excluída',
      body: `${fmtUsuario(req.user)} removeu "${m.titulo}" — ${fmtDataHora()}`,
      tipo: 'wn',
      exceto: req.user.id,
    });
    res.json({ ok: true });
  }),
);

// ---------- POST /:id/arquivos — upload de fotos/PDFs ----------
router.post(
  '/:id/arquivos',
  requireAdminOrTecnico,
  (req, res, next) => {
    req.uploadSubdir = 'manutencoes';
    next();
  },
  uploadManutencao.array('files', 10),
  asyncRoute(async (req, res) => {
    const m = await prisma.manutencao.findUnique({
      where: { id: req.params.id },
    });
    if (!m) throw httpErrors.notFound('Manutenção não encontrada');
    if (!req.files?.length) throw httpErrors.badRequest('Nenhum arquivo enviado');

    const created = [];
    for (const f of req.files) {
      const url = `manutencoes/${path.basename(f.path)}`;
      const arq = await prisma.arquivo.create({
        data: {
          manutencaoId: m.id,
          nome: f.originalname,
          url,
          mime: f.mimetype,
          tamanho: f.size,
        },
      });
      created.push({
        id: arq.id,
        nome: arq.nome,
        url: arq.url,
        mime: arq.mime,
        tamanho: arq.tamanho,
        isImg: arq.mime.startsWith('image/'),
      });
    }
    res.status(201).json({ arquivos: created });
  }),
);

// DELETE /:id/arquivos/:arquivoId
router.delete(
  '/:id/arquivos/:arquivoId',
  requireAdminOrTecnico,
  asyncRoute(async (req, res) => {
    const arq = await prisma.arquivo.findUnique({
      where: { id: req.params.arquivoId },
    });
    if (!arq || arq.manutencaoId !== req.params.id) {
      throw httpErrors.notFound('Arquivo não encontrado');
    }
    try {
      const filePath = path.join(UPLOAD_ROOT, arq.url);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch {}
    await prisma.arquivo.delete({ where: { id: arq.id } });
    res.json({ ok: true });
  }),
);

export default router;
