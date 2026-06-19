// =================================================
// Helper para buscar valor faturado na categoria "Fit" do Financeiro
// =================================================
// Quando um registro de FitEnergia é criado (Excel ou PDF), o valor
// faturado vem do módulo Financeiro — qualquer lançamento da categoria
// "Fit" (case-insensitive) na MESMA usina e MESMO mês é somado.
// =================================================

import { prisma } from '../db.js';

/**
 * Busca o total faturado da categoria "Fit" para uma usina em um mês específico.
 * @param {string} usinaId
 * @param {string} periodo - formato YYYY-MM
 * @returns {Promise<{total:number, lancamentos:number}>}
 */
export async function buscarValorFitFinanceiro(usinaId, periodo) {
  if (!usinaId || !periodo || !/^\d{4}-(0[1-9]|1[0-2])$/.test(periodo)) {
    return { total: 0, lancamentos: 0 };
  }
  const [ano, mes] = periodo.split('-').map((s) => parseInt(s));
  const inicio = new Date(Date.UTC(ano, mes - 1, 1));
  const fim = new Date(Date.UTC(ano, mes, 1));

  // Busca qualquer lançamento da usina no mês cuja categoria contém "fit"
  // (insensible a case e acentos)
  const rows = await prisma.financeiro.findMany({
    where: {
      usinaId,
      data: { gte: inicio, lt: fim },
      cat: { contains: 'fit', mode: 'insensitive' },
    },
    select: { val: true, cat: true },
  });

  const total = rows.reduce((s, r) => s + (r.val || 0), 0);
  return { total, lancamentos: rows.length };
}
