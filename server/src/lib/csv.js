// Parser do CSV de lançamentos (formato do modelo OASIS SOLAR)
// O modelo tem nas primeiras linhas:
//   Usina:;UFV Central;;;
//   SKID:;SKID-01;;;
//   Ano:;2025;;;
// Depois cabeçalho e 12 linhas com nome do mês em PT.

import { parse } from 'csv-parse/sync';

const M_MAP = {
  JANEIRO: 1,
  FEVEREIRO: 2,
  MARCO: 3,
  'MARÇO': 3,
  ABRIL: 4,
  MAIO: 5,
  JUNHO: 6,
  JULHO: 7,
  AGOSTO: 8,
  SETEMBRO: 9,
  OUTUBRO: 10,
  NOVEMBRO: 11,
  DEZEMBRO: 12,
};

/**
 * Limpa um valor: remove caracteres não-numéricos exceto vírgula/ponto/sinal,
 * troca vírgula por ponto, e retorna float ou 0 se vazio.
 */
function num(v) {
  if (v == null) return 0;
  const s = String(v)
    .replace(/[^\d,.\-]/g, '')
    .replace(',', '.');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Recebe o buffer (ou string) do CSV e devolve:
 *   { usina, skid, ano, dados: [{ mes, gen, irr, pr, dsp }] }
 */
export function parseLancamentosCSV(input) {
  const text = typeof input === 'string' ? input : input.toString('utf-8');

  // tenta encoding latin-1/windows-1252 se o texto tiver muitos caracteres ruins
  const ruins = (text.match(/[]/g) || []).length;
  let normalized = text;
  if (ruins > 5 && typeof input !== 'string') {
    normalized = input.toString('latin1');
  }

  const rows = parse(normalized, {
    delimiter: ';',
    relax_quotes: true,
    relax_column_count: true,
    skip_empty_lines: false,
    trim: true,
  });

  let usina = '';
  let skid = '';
  let ano = '';
  const dados = [];

  for (const row of rows) {
    if (!row || !row[0]) continue;
    const key = String(row[0])
      .trim()
      .replace(':', '')
      .toUpperCase()
      .replace(/[^A-Z0-9ÀÁÂÃÄÇÉÊÍÓÔÕÚ]/g, '');

    if (key === 'USINA') {
      usina = (row[1] || '').trim();
    } else if (key === 'SKID') {
      skid = (row[1] || '').trim();
    } else if (key === 'ANO') {
      ano = (row[1] || '').trim();
    } else {
      const semAcento = key.normalize('NFD').replace(/[̀-ͯ]/g, '');
      const mes = M_MAP[key] || M_MAP[semAcento];
      if (mes) {
        dados.push({
          mes,
          gen: num(row[1]),
          irr: num(row[2]),
          pr: num(row[3]),
          dsp: num(row[4]),
        });
      }
    }
  }

  return { usina, skid, ano, dados };
}
