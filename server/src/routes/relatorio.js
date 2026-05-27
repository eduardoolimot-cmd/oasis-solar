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
      ? new Date(new Date(inicio).setUTCMonth(inicio.getUTCMonth() + 1))
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

    // ---------- Cálculos (replicando a página Financeiro) ----------
    const rec = lancamentos.filter((l) => l.tipo === 'rec').reduce((s, l) => s + l.val, 0);
    const des = lancamentos.filter((l) => l.tipo === 'des').reduce((s, l) => s + l.val, 0);
    const fin = lancamentos.filter((l) => l.tipo === 'fin').reduce((s, l) => s + l.val, 0);
    const liqOp = rec - des;
    const liqTotal = rec - des - fin;
    const margem = rec ? +((liqOp / rec) * 100).toFixed(1) : 0;

    // por mês (12 meses)
    const recMes = Array.from({ length: 12 }, () => 0);
    const desMes = Array.from({ length: 12 }, () => 0);
    const finMes = Array.from({ length: 12 }, () => 0);
    for (const l of lancamentos) {
      const m = new Date(l.data).getUTCMonth();
      if (l.tipo === 'rec') recMes[m] += l.val;
      else if (l.tipo === 'des') desMes[m] += l.val;
      else if (l.tipo === 'fin') finMes[m] += l.val;
    }

    // por categoria
    const acc = (tipo) => {
      const grupos = {};
      for (const l of lancamentos) {
        if (l.tipo !== tipo) continue;
        const k = l.cat || 'Sem categoria';
        if (!grupos[k]) grupos[k] = { categoria: k, total: 0, qtd: 0 };
        grupos[k].total += l.val;
        grupos[k].qtd += 1;
      }
      return Object.values(grupos).sort((a, b) => b.total - a.total);
    };
    const catRec = acc('rec');
    const catDes = acc('des');
    const catFin = acc('fin');

    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    res.setHeader('Content-Type', 'application/pdf');
    const fileName = `Financeiro_${usina ? usina.nome.replace(/\s+/g, '_') + '_' : ''}${mes ? mes + '_' : ''}${ano}.pdf`;
    res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);
    doc.pipe(res);

    const PW = doc.page.width;
    const PH = doc.page.height;
    const ML = 40;
    const MR = 40;

    // ---------- Header ----------
    doc.rect(0, 0, PW, 80).fill('#0057B8');
    doc.fillColor('#fff').font('Helvetica-Bold').fontSize(18).text('RELATÓRIO FINANCEIRO', ML, 18);
    doc.font('Helvetica').fontSize(10).text(usina ? usina.nome : 'Consolidado — Todas as usinas', ML, 42);
    doc.font('Helvetica').fontSize(9).text(`Período: ${mes ? MOF[parseInt(mes) - 1] + ' / ' + ano : 'Ano ' + ano}`, ML, 58);
    doc.font('Helvetica').fontSize(8).fillColor('rgba(255,255,255,.8)').text(
      `Gerado em ${new Date().toLocaleString('pt-BR')}`,
      PW - MR - 200, 58, { width: 200, align: 'right' },
    );

    // ---------- Função utilitária pra controlar quebra de página ----------
    let y = 100;
    const limitPage = () => PH - 50;
    const needPage = (extra = 18) => {
      if (y + extra > limitPage()) {
        doc.addPage();
        y = 40;
      }
    };

    // ---------- 1. KPIs ----------
    doc.fillColor('#0057B8').font('Helvetica-Bold').fontSize(11).text('1. INDICADORES', ML, y);
    y += 14;
    doc.moveTo(ML, y).lineTo(PW - MR, y).strokeColor('#0057B8').lineWidth(0.6).stroke();
    y += 10;

    // 5 cards
    const cw = (PW - ML - MR) / 5;
    const cards = [
      { lbl: 'RECEITAS',      val: `R$ ${fmtNum(rec, 2)}`,                                    sub: `${lancamentos.filter((l) => l.tipo === 'rec').length} lanç.`, color: '#10B981' },
      { lbl: 'DESPESAS',      val: `R$ ${fmtNum(des, 2)}`,                                    sub: `${lancamentos.filter((l) => l.tipo === 'des').length} lanç.`, color: '#EF4444' },
      { lbl: 'FINANCIAMENTO', val: `R$ ${fmtNum(fin, 2)}`,                                    sub: `${lancamentos.filter((l) => l.tipo === 'fin').length} lanç.`, color: '#8B5CF6' },
      { lbl: 'LÍQUIDO OP.',   val: `R$ ${fmtNum(liqOp, 2)}`,                                  sub: liqOp >= 0 ? 'Superávit' : 'Déficit',                          color: liqOp >= 0 ? '#0057B8' : '#EF4444' },
      { lbl: 'LÍQUIDO TOTAL', val: `R$ ${fmtNum(liqTotal, 2)}`,                               sub: `Margem ${margem}%`,                                            color: liqTotal >= 0 ? '#0057B8' : '#EF4444' },
    ];
    cards.forEach((c, i) => {
      const x = ML + i * cw;
      doc.rect(x, y, cw - 4, 55).fill('#F8FBFF').strokeColor('#D8E4F5').lineWidth(0.5).stroke();
      doc.fillColor('#8EA3C0').font('Helvetica-Bold').fontSize(7).text(c.lbl, x + 6, y + 6, { width: cw - 16 });
      doc.fillColor(c.color).font('Helvetica-Bold').fontSize(10).text(c.val, x + 6, y + 22, { width: cw - 16 });
      doc.fillColor('#8EA3C0').font('Helvetica').fontSize(7).text(c.sub, x + 6, y + 42);
    });
    y += 70;

    // ---------- 2. Divisão por categoria ----------
    needPage(40);
    doc.fillColor('#0057B8').font('Helvetica-Bold').fontSize(11).text('2. DIVISÃO POR CATEGORIA', ML, y);
    y += 14;
    doc.moveTo(ML, y).lineTo(PW - MR, y).strokeColor('#0057B8').lineWidth(0.6).stroke();
    y += 10;

    const renderCatTable = (titulo, dados, totalTipo, corTitulo) => {
      if (!dados.length) return;
      needPage(30);
      doc.fillColor(corTitulo).font('Helvetica-Bold').fontSize(9).text(titulo, ML, y);
      y += 14;
      // cabeçalho
      doc.rect(ML, y, PW - ML - MR, 16).fill('#0057B8');
      doc.fillColor('#fff').font('Helvetica-Bold').fontSize(8);
      doc.text('Categoria', ML + 6, y + 4);
      doc.text('Valor', ML + 280, y + 4, { width: 110, align: 'right' });
      doc.text('%', ML + 400, y + 4, { width: 50, align: 'right' });
      doc.text('Qtd', ML + 460, y + 4, { width: 50, align: 'right' });
      y += 16;
      dados.forEach((c, i) => {
        needPage(14);
        if (i % 2 === 0) doc.rect(ML, y, PW - ML - MR, 14).fill('#F8FBFF');
        const pct = totalTipo ? ((c.total / totalTipo) * 100).toFixed(1) : '0.0';
        doc.fillColor('#222').font('Helvetica').fontSize(8.5);
        doc.text(c.categoria, ML + 6, y + 3, { width: 270, ellipsis: true });
        doc.font('Helvetica-Bold').text(`R$ ${fmtNum(c.total, 2)}`, ML + 280, y + 3, { width: 110, align: 'right' });
        doc.font('Helvetica').text(`${pct}%`, ML + 400, y + 3, { width: 50, align: 'right' });
        doc.fillColor('#8EA3C0').text(`${c.qtd}`, ML + 460, y + 3, { width: 50, align: 'right' });
        y += 14;
      });
      y += 6;
    };

    renderCatTable('2.1 Receitas', catRec, rec, '#10B981');
    renderCatTable('2.2 Despesas', catDes, des, '#EF4444');
    renderCatTable('2.3 Financiamento', catFin, fin, '#8B5CF6');

    // ---------- 3. Distribuição mensal (só se for ano inteiro) ----------
    if (!mes) {
      needPage(40);
      doc.fillColor('#0057B8').font('Helvetica-Bold').fontSize(11).text('3. DISTRIBUIÇÃO MENSAL', ML, y);
      y += 14;
      doc.moveTo(ML, y).lineTo(PW - MR, y).strokeColor('#0057B8').lineWidth(0.6).stroke();
      y += 10;
      doc.rect(ML, y, PW - ML - MR, 16).fill('#0057B8');
      doc.fillColor('#fff').font('Helvetica-Bold').fontSize(8);
      doc.text('Mês', ML + 6, y + 4);
      doc.text('Receitas', ML + 90, y + 4, { width: 100, align: 'right' });
      doc.text('Despesas', ML + 200, y + 4, { width: 100, align: 'right' });
      doc.text('Financ.', ML + 310, y + 4, { width: 80, align: 'right' });
      doc.text('Líquido', ML + 400, y + 4, { width: 110, align: 'right' });
      y += 16;
      const MOX = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
      for (let m = 0; m < 12; m++) {
        needPage(14);
        if (m % 2 === 0) doc.rect(ML, y, PW - ML - MR, 14).fill('#F8FBFF');
        const liq = recMes[m] - desMes[m] - finMes[m];
        doc.fillColor('#222').font('Helvetica-Bold').fontSize(8.5).text(MOX[m], ML + 6, y + 3);
        doc.font('Helvetica').fillColor('#10B981').text(`R$ ${fmtNum(recMes[m], 2)}`, ML + 90, y + 3, { width: 100, align: 'right' });
        doc.fillColor('#EF4444').text(`R$ ${fmtNum(desMes[m], 2)}`, ML + 200, y + 3, { width: 100, align: 'right' });
        doc.fillColor('#8B5CF6').text(`R$ ${fmtNum(finMes[m], 2)}`, ML + 310, y + 3, { width: 80, align: 'right' });
        doc.fillColor(liq >= 0 ? '#0057B8' : '#EF4444').font('Helvetica-Bold').text(`R$ ${fmtNum(liq, 2)}`, ML + 400, y + 3, { width: 110, align: 'right' });
        y += 14;
      }
      y += 6;
    }

    // ---------- 4. Extrato completo ----------
    needPage(40);
    doc.fillColor('#0057B8').font('Helvetica-Bold').fontSize(11).text(`${mes ? '3' : '4'}. EXTRATO COMPLETO (${lancamentos.length} lançamentos)`, ML, y);
    y += 14;
    doc.moveTo(ML, y).lineTo(PW - MR, y).strokeColor('#0057B8').lineWidth(0.6).stroke();
    y += 10;

    if (!lancamentos.length) {
      doc.fillColor('#888').font('Helvetica-Oblique').fontSize(9).text('Nenhum lançamento no período.', ML, y + 4);
    } else {
      // header
      doc.rect(ML, y, PW - ML - MR, 16).fill('#0057B8');
      doc.fillColor('#fff').font('Helvetica-Bold').fontSize(8);
      doc.text('Data', ML + 6, y + 4);
      doc.text('Usina', ML + 60, y + 4);
      doc.text('Tipo', ML + 200, y + 4);
      doc.text('Categoria', ML + 250, y + 4);
      doc.text('Descrição', ML + 360, y + 4);
      doc.text('Valor', PW - MR - 80, y + 4, { width: 74, align: 'right' });
      y += 16;

      const TIPO_LBL = { rec: 'Receita', des: 'Despesa', fin: 'Financ.' };
      const TIPO_COR = { rec: '#10B981', des: '#EF4444', fin: '#8B5CF6' };

      lancamentos.forEach((l, i) => {
        needPage(14);
        if (i % 2 === 0) doc.rect(ML, y, PW - ML - MR, 14).fill('#F8FBFF');
        doc.fillColor('#222').font('Helvetica').fontSize(7.5);
        doc.text(new Date(l.data).toLocaleDateString('pt-BR'), ML + 6, y + 3);
        doc.text((l.usina.nome || '').slice(0, 24), ML + 60, y + 3, { width: 140 });
        doc.fillColor(TIPO_COR[l.tipo]).font('Helvetica-Bold').text(TIPO_LBL[l.tipo] || l.tipo, ML + 200, y + 3);
        doc.fillColor('#222').font('Helvetica').text((l.cat || '').slice(0, 18), ML + 250, y + 3, { width: 110 });
        doc.text((l.desc || '').slice(0, 30), ML + 360, y + 3, { width: 160 });
        doc.fillColor(TIPO_COR[l.tipo]).font('Helvetica-Bold').text(
          `R$ ${fmtNum(l.val, 2)}`, PW - MR - 80, y + 3, { width: 74, align: 'right' },
        );
        y += 14;
      });
    }

    // Rodapé
    doc.fillColor('#8EA3C0').font('Helvetica').fontSize(8).text(
      `OASIS SOLAR — Página ${doc.bufferedPageRange().count}`,
      ML, PH - 30, { align: 'center', width: PW - ML - MR },
    );

    doc.end();
  }),
);

export default router;
