// =================================================
// Parser de Excel (XLSX) com dados de faturamento Fit Energia
// =================================================
// Detecta cabeçalho automaticamente nas primeiras 15 linhas.
// Procura por colunas com:
//   - período (Mês/Ano, Período, Data, "Abril/2026", "04/2026")
//   - geração (kWh, Geração, Energia Gerada, "Geração deste mês")
//   - valor faturado (R$, Valor, Valor Total, Total, Faturado)
//   - tarifa, distribuidora, beneficiários (opcionais)
//
// Devolve { items, headers, sheets, linhasIgnoradas }
// =================================================

import * as XLSX from 'xlsx';

const MESES_MAP = {
  JAN: 1, JANEIRO: 1,
  FEV: 2, FEVEREIRO: 2,
  MAR: 3, MARCO: 3, 'MARÇO': 3,
  ABR: 4, ABRIL: 4,
  MAI: 5, MAIO: 5,
  JUN: 6, JUNHO: 6,
  JUL: 7, JULHO: 7,
  AGO: 8, AGOSTO: 8,
  SET: 9, SETEMBRO: 9,
  OUT: 10, OUTUBRO: 10,
  NOV: 11, NOVEMBRO: 11,
  DEZ: 12, DEZEMBRO: 12,
};

const norm = (s) => String(s || '')
  .trim()
  .toUpperCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, ''); // remove acentos

/** Verifica se a string parece um cabeçalho de coluna conhecida */
function detectarTipoColuna(headerStr) {
  const h = norm(headerStr);
  if (!h) return null;

  if (/PERIODO|PER\.|^MES$|REFERENCIA|COMPETENCIA/.test(h)) return 'periodo';
  if (/^ANO$|EXERCICIO/.test(h)) return 'ano';
  if (h === 'MES' || /^MES\b/.test(h)) return 'mes';
  if (/GERACAO|ENERGIA\s*GERADA|KWH|INJETAD|ENERGIA\s*ATIVA/.test(h)) return 'geracao';
  if (/VALOR.*FATURADO|VALOR.*TOTAL|TOTAL.*PAGAR|TOTAL.*FATURADO|^VALOR$|R\$|VALOR.*BRUTO/.test(h)) return 'valor';
  if (/TARIFA|R\$\/KWH|PRECO\s*KWH|CUSTO\s*KWH/.test(h)) return 'tarifa';
  if (/DISTRIBUIDORA|CONCESSIONARIA|UTILITY/.test(h)) return 'distribuidora';
  if (/BENEFICIARIOS|UC|UNIDADE.*CONSUMIDOR/.test(h)) return 'beneficiarios';
  return null;
}

/** Tenta extrair número de uma célula (suporta vários formatos BR/EN) */
function parseNum(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return v;
  let s = String(v).trim();
  if (!s) return 0;
  // Remove R$, espaços, e qualquer texto antes/depois do número
  s = s.replace(/R\$|\s|kWh|\$/gi, '');
  // Formato BR: 1.234,56 → 1234.56
  if (s.includes(',') && s.includes('.')) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (s.includes(',')) {
    s = s.replace(',', '.');
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

/** Tenta extrair período (mes+ano) de várias formas */
function parsePeriodo(cellValue) {
  if (!cellValue) return { mes: null, ano: null };
  // Excel pode trazer Date
  if (cellValue instanceof Date) {
    return { mes: cellValue.getUTCMonth() + 1, ano: cellValue.getUTCFullYear() };
  }
  const s = String(cellValue).trim();
  if (!s) return { mes: null, ano: null };

  // "04/2026" ou "4/2026"
  let m = s.match(/(\d{1,2})\s*[\/\-.]\s*(\d{4})/);
  if (m) return { mes: parseInt(m[1]), ano: parseInt(m[2]) };

  // "ABRIL/2026" ou "ABRIL DE 2026"
  m = s.match(/(\w+)\s*(?:[\/\-]|DE)\s*(\d{4})/i);
  if (m) {
    const mes = MESES_MAP[norm(m[1])];
    if (mes) return { mes, ano: parseInt(m[2]) };
  }

  // Só mês "ABRIL"
  const mesOnly = MESES_MAP[norm(s)];
  if (mesOnly) return { mes: mesOnly, ano: null };

  // Só ano "2026"
  if (/^\d{4}$/.test(s)) return { mes: null, ano: parseInt(s) };

  return { mes: null, ano: null };
}

/**
 * Encontra a linha de cabeçalho dentro das primeiras N linhas.
 * Devolve { headerRowIdx, colunas: { periodo, geracao, valor, tarifa, distribuidora, beneficiarios, mes, ano } }
 */
function detectarCabecalho(rows) {
  const limit = Math.min(15, rows.length);
  let melhorIdx = -1;
  let melhorCols = null;
  let melhorScore = 0;

  for (let i = 0; i < limit; i++) {
    const row = rows[i] || [];
    const cols = {};
    let score = 0;
    for (let c = 0; c < row.length; c++) {
      const tipo = detectarTipoColuna(row[c]);
      if (tipo && cols[tipo] === undefined) {
        cols[tipo] = c;
        score++;
      }
    }
    // Pelo menos geração + valor + (período OU mes/ano)
    const temPeriodo = cols.periodo !== undefined || (cols.mes !== undefined);
    const ok = cols.geracao !== undefined && cols.valor !== undefined && temPeriodo;
    if (ok && score > melhorScore) {
      melhorScore = score;
      melhorIdx = i;
      melhorCols = cols;
    }
  }
  return { headerRowIdx: melhorIdx, colunas: melhorCols };
}

/** Parser principal */
export function parseFitExcel(buffer, opts = {}) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });

  // Por padrão usa a primeira aba; opts.sheetName permite escolher outra
  const sheetName = opts.sheetName || wb.SheetNames[0];
  if (!sheetName) throw new Error('Arquivo Excel sem abas.');

  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, {
    header: 1, // matriz de arrays
    raw: false,
    defval: null,
  });

  const { headerRowIdx, colunas } = detectarCabecalho(rows);
  if (headerRowIdx === -1 || !colunas) {
    throw new Error(
      'Cabeçalho não detectado. A planilha precisa de colunas com "Período" (ou Mês+Ano), "Geração" (kWh) e "Valor" (R$).',
    );
  }

  const items = [];
  const linhasIgnoradas = [];
  let anoFallback = opts.anoFallback || null;

  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const row = rows[i] || [];
    if (!row.length || row.every((c) => c == null || String(c).trim() === '')) continue;

    // Extrair período
    let mes = null, ano = null;
    if (colunas.periodo !== undefined) {
      ({ mes, ano } = parsePeriodo(row[colunas.periodo]));
    }
    if (mes == null && colunas.mes !== undefined) {
      const p = parsePeriodo(row[colunas.mes]);
      mes = p.mes || mes;
    }
    if (ano == null && colunas.ano !== undefined) {
      const v = row[colunas.ano];
      if (v) {
        const n = parseInt(String(v).match(/\d{4}/)?.[0] || '0');
        if (n >= 1900 && n <= 2200) ano = n;
      }
    }
    // Fallback ao ano "padrão" se só veio o mês
    if (mes != null && ano == null && anoFallback) ano = anoFallback;
    // Memoriza ano pra próximas linhas (relatórios costumam ter ano só no cabeçalho)
    if (mes != null && ano != null && !anoFallback) anoFallback = ano;

    const geracao = parseNum(row[colunas.geracao]);
    const valor = parseNum(row[colunas.valor]);
    const tarifa = colunas.tarifa !== undefined ? parseNum(row[colunas.tarifa]) : 0;
    const distribuidora = colunas.distribuidora !== undefined ? (row[colunas.distribuidora] ? String(row[colunas.distribuidora]).trim() : null) : null;
    const beneficiarios = colunas.beneficiarios !== undefined ? parseInt(parseNum(row[colunas.beneficiarios])) || null : null;

    // Precisa ter pelo menos mês+ano OU geração+valor pra ser útil
    if (!geracao && !valor && (mes == null || ano == null)) {
      linhasIgnoradas.push({ linha: i + 1, motivo: 'Linha sem dados úteis' });
      continue;
    }
    if (mes == null || ano == null) {
      linhasIgnoradas.push({ linha: i + 1, motivo: `Período não identificado (mes=${mes}, ano=${ano})` });
      continue;
    }
    if (!geracao && !valor) {
      linhasIgnoradas.push({ linha: i + 1, motivo: 'Sem geração nem valor' });
      continue;
    }

    const periodo = `${ano}-${String(mes).padStart(2, '0')}`;
    items.push({
      linha: i + 1,
      periodo,
      mes,
      ano,
      geracaoKwh: geracao,
      valorFaturado: valor,
      tarifa: tarifa || (geracao > 0 ? +(valor / geracao).toFixed(4) : 0),
      distribuidora,
      beneficiarios,
    });
  }

  // Ordena por período asc
  items.sort((a, b) => a.periodo.localeCompare(b.periodo));

  return {
    sheets: wb.SheetNames,
    sheetUsado: sheetName,
    headerRowIdx,
    colunas,
    items,
    linhasIgnoradas,
    resumo: {
      totalLinhas: rows.length - headerRowIdx - 1,
      totalItens: items.length,
      ignoradas: linhasIgnoradas.length,
      somaGeracao: items.reduce((s, x) => s + x.geracaoKwh, 0),
      somaValor: items.reduce((s, x) => s + x.valorFaturado, 0),
    },
  };
}
