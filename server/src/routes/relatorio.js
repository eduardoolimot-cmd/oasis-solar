// Gera PDFs de relatório no servidor (PDFKit)
import { Router } from 'express';
import PDFDocument from 'pdfkit';
import { prisma } from '../db.js';
import { asyncRoute, httpErrors } from '../lib/http.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

const MOF = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

function fmtNum(v, dec = 0) {
  if (v == null || isNaN(v)) return '—';
  return Number(v).toLocaleString('pt-BR', {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  });
}

// GET /api/relatorio/pdf?usinaId=...&mes=12&ano=2024
router.get(
  '/pdf',
  asyncRoute(async (req, res) => {
    const { usinaId, ano, mes } = req.query;
    if (!usinaId || !ano || !mes) {
      throw httpErrors.badRequest('usinaId, ano e mes são obrigatórios');
    }

    const usina = await prisma.usina.findUnique({
      where: { id: usinaId },
      include: { previsoes: { where: { skidId: null } } },
    });
    if (!usina) throw httpErrors.notFound('Usina não encontrada');

    const periodo = `${ano}-${String(mes).padStart(2, '0')}`;
    const lancamentos = await prisma.lancamento.findMany({
      where: { usinaId, periodo },
    });

    const manutencoes = await prisma.manutencao.findMany({
      where: { usinaId, status: 'ok' },
      orderBy: { data: 'desc' },
      take: 10,
    });

    const gR = lancamentos.reduce((s, l) => s + l.geracao, 0);
    const prevMes = usina.previsoes.find((p) => p.mes === parseInt(mes));
    const gP = prevMes?.gen || 0;
    const iP = prevMes?.irrad || 0;
    const pP = prevMes?.pr || 0;
    const iR = lancamentos.length
      ? lancamentos.reduce((s, l) => s + l.irrad, 0) / lancamentos.length
      : 0;
    const pR = lancamentos.length
      ? lancamentos.reduce((s, l) => s + l.pr, 0) / lancamentos.length
      : 0;

    const variacaoG = gP ? +(((gR - gP) / gP) * 100).toFixed(1) : 0;
    const variacaoI = iP && iR ? +(((iR - iP) / iP) * 100).toFixed(1) : 0;
    const variacaoP = +(pR - pP).toFixed(1);

    // Cria o PDF
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=Relatorio_${usina.nome.replace(/\s+/g, '_')}_${mes}_${ano}.pdf`,
    );
    doc.pipe(res);

    // Cabeçalho azul
    doc.rect(0, 0, doc.page.width, 70).fill('#0057B8');
    doc.fillColor('#fff').font('Helvetica-Bold').fontSize(18).text('RELATÓRIO DE GERAÇÃO SOLAR', 40, 22);
    doc.font('Helvetica').fontSize(10).text(usina.nome, 40, 46);
    doc.font('Helvetica-Bold').fontSize(11).text(`${MOF[parseInt(mes) - 1]} / ${ano}`, 40, 46, { align: 'right' });

    // Seção 1: Dados da instalação
    doc.fillColor('#0057B8').font('Helvetica-Bold').fontSize(11).text('1. DADOS DA INSTALAÇÃO', 40, 90);
    doc.moveTo(40, 105).lineTo(doc.page.width - 40, 105).strokeColor('#0057B8').lineWidth(0.6).stroke();
    doc.fillColor('#222').font('Helvetica').fontSize(9);
    const dataInfo = [
      ['Instalação:', usina.nome, 'Potência:', `${fmtNum(usina.kwp)} kWp`],
      [
        'Início:',
        usina.inicio ? new Date(usina.inicio).toLocaleDateString('pt-BR') : 'N/D',
        'Localização:',
        usina.local || 'N/D',
      ],
      [
        'Módulos:',
        usina.moduloQtd ? `${usina.moduloQtd}× ${usina.moduloModelo}` : 'N/D',
        'Inversores:',
        usina.inversorQtd ? `${usina.inversorQtd}× ${usina.inversorModelo}` : 'N/D',
      ],
    ];
    dataInfo.forEach((row, i) => {
      const y = 115 + i * 14;
      doc.font('Helvetica-Bold').text(row[0], 40, y);
      doc.font('Helvetica').text(row[1], 100, y);
      doc.font('Helvetica-Bold').text(row[2], 290, y);
      doc.font('Helvetica').text(row[3], 360, y);
    });

    // Seção 2: Resumo operacional
    let y = 175;
    doc.fillColor('#0057B8').font('Helvetica-Bold').fontSize(11).text('2. RESUMO OPERACIONAL DO MÊS', 40, y);
    y += 15;
    doc.moveTo(40, y).lineTo(doc.page.width - 40, y).strokeColor('#0057B8').lineWidth(0.6).stroke();
    y += 8;

    // cabeçalho da tabela
    doc.rect(40, y, doc.page.width - 80, 18).fill('#0057B8');
    doc.fillColor('#fff').font('Helvetica-Bold').fontSize(9);
    doc.text('Indicador', 46, y + 5);
    doc.text('Previsto', 240, y + 5);
    doc.text('Realizado', 320, y + 5);
    doc.text('Variação', 420, y + 5);
    y += 18;

    const linhas = [
      ['Geração (kWh)', fmtNum(gP), fmtNum(gR), `${variacaoG}%`, variacaoG],
      ['Irradiação (kWh/m²)', iP.toFixed(1), iR.toFixed(1), `${variacaoI}%`, variacaoI],
      ['Performance Ratio (%)', pP.toFixed(1) + '%', pR.toFixed(1) + '%', `${variacaoP} p.p.`, variacaoP],
    ];
    linhas.forEach((l, i) => {
      if (i % 2 === 0) doc.rect(40, y, doc.page.width - 80, 18).fill('#F8FBFF');
      doc.fillColor('#222').font('Helvetica-Bold').fontSize(9).text(l[0], 46, y + 5);
      doc.font('Helvetica').text(l[1], 240, y + 5);
      doc.text(l[2], 320, y + 5);
      doc.fillColor(l[4] >= 0 ? '#10B981' : '#EF4444').font('Helvetica-Bold').text(l[3], 420, y + 5);
      y += 18;
    });

    // Seção 3: Manutenções concluídas
    y += 16;
    doc.fillColor('#0057B8').font('Helvetica-Bold').fontSize(11).text('3. HISTÓRICO DE MANUTENÇÃO', 40, y);
    y += 15;
    doc.moveTo(40, y).lineTo(doc.page.width - 40, y).strokeColor('#0057B8').lineWidth(0.6).stroke();
    y += 8;

    if (manutencoes.length) {
      doc.rect(40, y, doc.page.width - 80, 18).fill('#0057B8');
      doc.fillColor('#fff').font('Helvetica-Bold').fontSize(9);
      doc.text('Tipo', 46, y + 5);
      doc.text('Data', 130, y + 5);
      doc.text('Título', 200, y + 5);
      doc.text('Responsável', 420, y + 5);
      y += 18;
      const tipoLbl = { prev: 'Preventiva', corr: 'Corretiva', pred: 'Preditiva', plan: 'Planejada' };
      manutencoes.forEach((m, i) => {
        if (i % 2 === 0) doc.rect(40, y, doc.page.width - 80, 16).fill('#F8FBFF');
        doc.fillColor('#222').font('Helvetica').fontSize(8.5);
        doc.text(tipoLbl[m.tipo] || m.tipo, 46, y + 4);
        doc.text(m.data ? new Date(m.data).toLocaleDateString('pt-BR') : '', 130, y + 4);
        doc.text((m.titulo || '').slice(0, 50), 200, y + 4);
        doc.text((m.resp || '').slice(0, 25), 420, y + 4);
        y += 16;
      });
    } else {
      doc.fillColor('#888').font('Helvetica-Oblique').fontSize(9).text(
        'Nenhuma manutenção registrada no período.',
        40,
        y + 2,
      );
      y += 16;
    }

    // Observação
    y += 16;
    doc.rect(40, y, doc.page.width - 80, 36).fill('#F0F5FC');
    doc.rect(40, y, 3, 36).fill('#0057B8');
    doc.fillColor('#324').font('Helvetica').fontSize(9).text(
      'A operação encontra-se monitorada e dentro dos parâmetros. Recomenda-se a continuidade do monitoramento preventivo para preservação da vida útil dos equipamentos.',
      50,
      y + 6,
      { width: doc.page.width - 100 },
    );

    // Rodapé
    doc.fillColor('#8EA3C0').font('Helvetica').fontSize(8).text(
      `Documento gerado pelo sistema OASIS SOLAR em ${new Date().toLocaleString('pt-BR')}`,
      40,
      doc.page.height - 30,
      { align: 'center', width: doc.page.width - 80 },
    );

    doc.end();
  }),
);

// =========================================================
// GET /api/relatorio/financeiro.pdf?usinaId=&ano=&mes=
// =========================================================
router.get(
  '/financeiro.pdf',
  asyncRoute(async (req, res) => {
    const { usinaId, ano, mes } = req.query;
    if (!ano) throw httpErrors.badRequest('ano é obrigatório');

    // Janela temporal
    const inicio = mes
      ? new Date(`${ano}-${String(mes).padStart(2, '0')}-01T00:00:00.000Z`)
      : new Date(`${ano}-01-01T00:00:00.000Z`);
    const fim = mes
      ? new Date(new Date(inicio).setMonth(inicio.getMonth() + 1))
      : new Date(`${parseInt(ano) + 1}-01-01T00:00:00.000Z`);

    const where = { data: { gte: inicio, lt: fim } };
    if (usinaId) where.usinaId = usinaId;

    const [usina, lancamentos] = await Promise.all([
      usinaId ? prisma.usina.findUnique({ where: { id: usinaId } }) : null,
      prisma.financeiro.findMany({
        where,
        include: { usina: { select: { nome: true } } },
        orderBy: { data: 'asc' },
      }),
    ]);

    const rec = lancamentos.filter((l) => l.tipo === 'rec').reduce((s, l) => s + l.val, 0);
    const des = lancamentos.filter((l) => l.tipo === 'des').reduce((s, l) => s + l.val, 0);
    const liq = rec - des;

    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    res.setHeader('Content-Type', 'application/pdf');
    const fileName = `Financeiro_${usina ? usina.nome.replace(/\s+/g, '_') + '_' : ''}${mes ? mes + '_' : ''}${ano}.pdf`;
    res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);
    doc.pipe(res);

    // Header
    doc.rect(0, 0, doc.page.width, 70).fill('#0057B8');
    doc.fillColor('#fff').font('Helvetica-Bold').fontSize(18).text('RELATÓRIO FINANCEIRO', 40, 22);
    doc.font('Helvetica').fontSize(10).text(usina ? usina.nome : 'Todas as usinas', 40, 46);
    doc
      .font('Helvetica-Bold').fontSize(11)
      .text(mes ? `${MOF[parseInt(mes) - 1]} / ${ano}` : `Ano ${ano}`, 40, 46, { align: 'right' });

    // Resumo
    let y = 90;
    doc.fillColor('#0057B8').font('Helvetica-Bold').fontSize(11).text('1. RESUMO', 40, y);
    y += 15;
    doc.moveTo(40, y).lineTo(doc.page.width - 40, y).strokeColor('#0057B8').lineWidth(0.6).stroke();
    y += 12;

    // 4 cards lado a lado
    const cw = (doc.page.width - 80) / 4;
    const cards = [
      { lbl: 'RECEITAS', val: `R$ ${fmtNum(rec, 2)}`, color: '#10B981' },
      { lbl: 'DESPESAS', val: `R$ ${fmtNum(des, 2)}`, color: '#EF4444' },
      { lbl: 'LÍQUIDO', val: `R$ ${fmtNum(liq, 2)}`, color: liq >= 0 ? '#0057B8' : '#EF4444' },
      { lbl: 'MARGEM', val: rec ? `${((liq / rec) * 100).toFixed(1)}%` : '—', color: '#444' },
    ];
    cards.forEach((c, i) => {
      const x = 40 + i * cw;
      doc.rect(x, y, cw - 6, 50).fill('#F8FBFF').strokeColor('#D8E4F5').lineWidth(0.5).stroke();
      doc.fillColor('#8EA3C0').font('Helvetica-Bold').fontSize(8).text(c.lbl, x + 8, y + 8);
      doc.fillColor(c.color).font('Helvetica-Bold').fontSize(12).text(c.val, x + 8, y + 24);
    });
    y += 65;

    // Extrato (tabela)
    doc.fillColor('#0057B8').font('Helvetica-Bold').fontSize(11).text('2. EXTRATO', 40, y);
    y += 15;
    doc.moveTo(40, y).lineTo(doc.page.width - 40, y).strokeColor('#0057B8').lineWidth(0.6).stroke();
    y += 8;

    if (!lancamentos.length) {
      doc.fillColor('#888').font('Helvetica-Oblique').fontSize(9).text(
        'Nenhum lançamento no período.', 40, y + 4,
      );
    } else {
      // header
      doc.rect(40, y, doc.page.width - 80, 18).fill('#0057B8');
      doc.fillColor('#fff').font('Helvetica-Bold').fontSize(8.5);
      doc.text('Data', 46, y + 5);
      doc.text('Usina', 100, y + 5);
      doc.text('Tipo', 230, y + 5);
      doc.text('Categoria', 280, y + 5);
      doc.text('Descrição', 370, y + 5);
      doc.text('Valor', 480, y + 5, { width: 65, align: 'right' });
      y += 18;

      lancamentos.forEach((l, i) => {
        if (y > doc.page.height - 60) {
          doc.addPage();
          y = 40;
        }
        if (i % 2 === 0) doc.rect(40, y, doc.page.width - 80, 16).fill('#F8FBFF');
        doc.fillColor('#222').font('Helvetica').fontSize(8);
        doc.text(new Date(l.data).toLocaleDateString('pt-BR'), 46, y + 4);
        doc.text((l.usina.nome || '').slice(0, 22), 100, y + 4);
        doc.fillColor(l.tipo === 'rec' ? '#10B981' : '#EF4444').font('Helvetica-Bold').text(
          l.tipo === 'rec' ? 'Receita' : 'Despesa',
          230, y + 4,
        );
        doc.fillColor('#222').font('Helvetica').text((l.cat || '').slice(0, 18), 280, y + 4);
        doc.text((l.desc || '').slice(0, 20), 370, y + 4);
        doc.fillColor(l.tipo === 'rec' ? '#10B981' : '#EF4444').font('Helvetica-Bold').text(
          `R$ ${fmtNum(l.val, 2)}`, 480, y + 4, { width: 65, align: 'right' },
        );
        y += 16;
      });
    }

    // Rodapé
    doc.fillColor('#8EA3C0').font('Helvetica').fontSize(8).text(
      `Documento gerado pelo sistema OASIS SOLAR em ${new Date().toLocaleString('pt-BR')}`,
      40, doc.page.height - 30,
      { align: 'center', width: doc.page.width - 80 },
    );

    doc.end();
  }),
);

export default router;
