// Parser do CSV de lançamentos financeiros (formato modelo OASIS SOLAR)
// Cabeçalho:
//   USINA;ITEM;Categoria;JANEIRO;FEVEREIRO;MARÇO;ABRIL;...;DEZEMBRO
//
// ITEM:
//   "Receita"       → tipo='rec'
//   "Despesas"      → tipo='des'
//   "Financiamento" → tipo='des' (financiamento é despesa)
//
// Valores em formato R$ brasileiro: "R$ 62.707,03" → 62707.03
// "R$ -" ou vazio → 0
//
// Múltiplas linhas com mesma USINA+Categoria+mês são somadas em um único lançamento.

import { parse } from 'csv-parse/sync';

const MESES = [
  'JANEIRO', 'FEVEREIRO', 'MARCO', 'MARÇO',
  'ABRIL', 'MAIO', 'JUNHO', 'JULHO',
  'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO',
];

/** Converte "R$ 62.707,03" → 62707.03 */
function parseValor(v) {
  if (v == null) return 0;
  const s = String(v).trim();
  if (!s || s === '-' || s === 'R$' || /^R?\$?\s*-\s*$/.test(s)) return 0;
  const limpo = s
    .replace(/R\$|\s/g, '')
    .replace(/\./g, '')    // remove milhares
    .replace(',', '.');    // vírgula vira ponto
  const n = parseFloat(limpo);
  return Number.isFinite(n) ? n : 0;
}

/** Normaliza ITEM para 'rec' | 'des' | 'fin' */
function mapTipo(item) {
  const norm = String(item || '').trim().toUpperCase().replace(/[ÇÃÕÉÍÓÚÁÉÍÓÚÂÊÔ]/g, (c) => ({
    Ç: 'C', Ã: 'A', Õ: 'O', É: 'E', Í: 'I', Ó: 'O', Ú: 'U',
    Á: 'A', Â: 'A', Ê: 'E', Ô: 'O',
  }[c] || c));
  if (norm === 'RECEITA' || norm.startsWith('RECE')) return 'rec';
  if (norm === 'DESPESAS' || norm === 'DESPESA') return 'des';
  if (norm === 'FINANCIAMENTO' || norm.startsWith('FINAN')) return 'fin';
  return null;
}

/**
 * Parseia o buffer/string do CSV.
 * Retorna:
 *   {
 *     linhasIgnoradas: [{linha, motivo}],
 *     itens: [
 *       {usina, tipo: 'rec'|'des', categoria, mes: 1..12, val, originais: [{linhaCSV, valOriginal}]}
 *     ],
 *     resumo: {
 *       totalLinhas, totalLancamentos, porUsina, porCategoria,
 *       totaisReceita, totaisDespesa, liquido,
 *     }
 *   }
 */
export function parseFinanceiroCSV(input) {
  const text = typeof input === 'string' ? input : input.toString('utf-8');

  // Tentativa de fallback se vier com bytes Latin1
  const ruins = (text.match(/[]/g) || []).length;
  const normalized = (ruins > 5 && typeof input !== 'string')
    ? input.toString('latin1')
    : text;

  const rows = parse(normalized, {
    delimiter: ';',
    relax_quotes: true,
    relax_column_count: true,
    skip_empty_lines: true,
    trim: true,
  });

  if (!rows.length) {
    return { itens: [], linhasIgnoradas: [], resumo: { totalLinhas: 0 } };
  }

  // Detecta linha de cabeçalho (procura por USINA;ITEM;Categoria)
  let headerIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 5); i++) {
    const r = rows[i].map((c) => String(c || '').toUpperCase().trim());
    if (r.includes('USINA') && r.some((x) => x.startsWith('CATEG'))) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) {
    throw new Error('Cabeçalho não encontrado. O CSV deve ter a primeira linha: USINA;ITEM;Categoria;JANEIRO;FEVEREIRO;...');
  }

  // Detecta o índice de cada mês no header
  const header = rows[headerIdx].map((c) => String(c || '').toUpperCase().trim().normalize('NFD').replace(/[̀-ͯ]/g, ''));
  const idxUsina = header.indexOf('USINA');
  const idxItem  = header.indexOf('ITEM');
  const idxCat   = header.findIndex((h) => h.startsWith('CATEG'));
  const mesIdx = {}; // mes (1..12) → coluna no CSV
  MESES.forEach((mes, i) => {
    const m = mes.normalize('NFD').replace(/[̀-ͯ]/g, '');
    const col = header.indexOf(m);
    if (col !== -1) {
      // converte para 1..12 (Janeiro=1)
      const numMes = i === 2 || i === 3 ? 3 // MARCO/MARÇO ambos viram 3
        : i === 0 ? 1 : i === 1 ? 2
        : i === 4 ? 4 : i === 5 ? 5 : i === 6 ? 6
        : i === 7 ? 7 : i === 8 ? 8 : i === 9 ? 9
        : i === 10 ? 10 : i === 11 ? 11 : 12;
      mesIdx[numMes] = col;
    }
  });

  // Acumulador por chave usina+tipo+categoria+mes (soma valores duplicados)
  const acumulado = new Map();
  const linhasIgnoradas = [];

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row[idxUsina]) continue;

    const usina = String(row[idxUsina]).trim();
    if (!usina) continue;
    const itemRaw = row[idxItem];
    const tipo = mapTipo(itemRaw);
    if (!tipo) {
      linhasIgnoradas.push({ linha: i + 1, motivo: `ITEM desconhecido: "${itemRaw}"` });
      continue;
    }
    const categoria = String(row[idxCat] || '').trim();
    if (!categoria) {
      linhasIgnoradas.push({ linha: i + 1, motivo: 'Categoria vazia' });
      continue;
    }

    for (const [mesNum, col] of Object.entries(mesIdx)) {
      const valor = parseValor(row[col]);
      if (!valor) continue; // pula meses zerados
      const mes = parseInt(mesNum);
      const key = `${usina}|${tipo}|${categoria}|${mes}`;
      if (!acumulado.has(key)) {
        acumulado.set(key, {
          usina, tipo, categoria, mes, val: 0,
          originais: [],
        });
      }
      const it = acumulado.get(key);
      it.val += valor;
      it.originais.push({ linha: i + 1, val: valor });
    }
  }

  const itens = Array.from(acumulado.values()).sort((a, b) => {
    if (a.usina !== b.usina) return a.usina.localeCompare(b.usina);
    if (a.tipo !== b.tipo) return a.tipo.localeCompare(b.tipo);
    if (a.categoria !== b.categoria) return a.categoria.localeCompare(b.categoria);
    return a.mes - b.mes;
  });

  // Resumo
  const totaisReceita = itens.filter((i) => i.tipo === 'rec').reduce((s, i) => s + i.val, 0);
  const totaisDespesa = itens.filter((i) => i.tipo === 'des').reduce((s, i) => s + i.val, 0);
  const porUsina = {};
  const porCategoria = {};
  for (const it of itens) {
    porUsina[it.usina] = porUsina[it.usina] || { receita: 0, despesa: 0 };
    porCategoria[it.categoria] = porCategoria[it.categoria] || { receita: 0, despesa: 0, qtd: 0 };
    if (it.tipo === 'rec') {
      porUsina[it.usina].receita += it.val;
      porCategoria[it.categoria].receita += it.val;
    } else {
      porUsina[it.usina].despesa += it.val;
      porCategoria[it.categoria].despesa += it.val;
    }
    porCategoria[it.categoria].qtd += 1;
  }

  return {
    itens,
    linhasIgnoradas,
    resumo: {
      totalLinhas: rows.length - headerIdx - 1,
      totalLancamentos: itens.length,
      totaisReceita,
      totaisDespesa,
      liquido: totaisReceita - totaisDespesa,
      porUsina,
      porCategoria,
      usinasDoArquivo: Object.keys(porUsina),
      categoriasDoArquivo: Object.keys(porCategoria),
    },
  };
}
