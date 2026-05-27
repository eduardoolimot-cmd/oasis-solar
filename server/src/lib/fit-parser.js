// =================================================
// Parser de PDF de faturamento Fit Energia (genérico)
// =================================================
// Extrai texto do PDF e tenta identificar:
//   - mes/ano de referência
//   - geração em kWh
//   - valor faturado em R$
//   - distribuidora
// Cada distribuidora tem formato diferente — esse parser é heurístico.
// O usuário sempre revisa/edita antes de salvar.
// =================================================

// pdf-parse 2.x exporta named { pdf }, v1.x exporta default.
// Resolvemos os 2 formatos para o import funcionar em qualquer versão.
import * as PdfParseLib from 'pdf-parse';
const pdfParse = PdfParseLib.pdf || PdfParseLib.default || PdfParseLib;

const MESES_PT = {
  JANEIRO: 1, JAN: 1,
  FEVEREIRO: 2, FEV: 2,
  MARCO: 3, 'MARÇO': 3, MAR: 3,
  ABRIL: 4, ABR: 4,
  MAIO: 5, MAI: 5,
  JUNHO: 6, JUN: 6,
  JULHO: 7, JUL: 7,
  AGOSTO: 8, AGO: 8,
  SETEMBRO: 9, SET: 9,
  OUTUBRO: 10, OUT: 10,
  NOVEMBRO: 11, NOV: 11,
  DEZEMBRO: 12, DEZ: 12,
};

/** Converte string BR "1.234,56" → 1234.56 */
function parseNumBR(s) {
  if (!s) return 0;
  const str = String(s).trim();
  if (!str) return 0;
  // Remove tudo exceto dígitos, vírgula, ponto, sinal
  const limpo = str.replace(/[^\d,.\-]/g, '');
  if (!limpo) return 0;
  // Se tem vírgula e ponto, vírgula é decimal e ponto é milhar (formato BR)
  if (limpo.includes(',') && limpo.includes('.')) {
    return parseFloat(limpo.replace(/\./g, '').replace(',', '.'));
  }
  // Só vírgula → decimal BR
  if (limpo.includes(',')) {
    return parseFloat(limpo.replace(',', '.'));
  }
  // Só ponto: ambíguo. Se tiver 3 dígitos após o ponto = milhar; senão decimal
  if (limpo.includes('.')) {
    const partes = limpo.split('.');
    if (partes.length === 2 && partes[1].length === 3) {
      return parseFloat(limpo.replace('.', ''));
    }
  }
  return parseFloat(limpo);
}

/** Extrai mês e ano (formato MM/AAAA ou "ABRIL / 2026" ou "04/2026") */
function extrairPeriodo(text) {
  // 1) "Mês de referência: 04/2026" ou "ABRIL DE 2026"
  let m = text.match(/(?:m[êe]s|per[íi]odo|refer[êe]ncia)[^\d]{0,30}(\d{1,2})\s*[/\-.]\s*(\d{4})/i);
  if (m) return { mes: parseInt(m[1]), ano: parseInt(m[2]) };

  // 2) "ABRIL / 2026"
  m = text.match(/(JANEIRO|FEVEREIRO|MARÇO|MARCO|ABRIL|MAIO|JUNHO|JULHO|AGOSTO|SETEMBRO|OUTUBRO|NOVEMBRO|DEZEMBRO|JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)\s*(?:\/|DE|\s)\s*(\d{4})/i);
  if (m) {
    const mes = MESES_PT[m[1].toUpperCase()];
    if (mes) return { mes, ano: parseInt(m[2]) };
  }

  // 3) só MM/AAAA solto
  m = text.match(/\b(0[1-9]|1[0-2])\/(\d{4})\b/);
  if (m) return { mes: parseInt(m[1]), ano: parseInt(m[2]) };

  return { mes: null, ano: null };
}

/** Tenta extrair a geração em kWh (vários formatos possíveis) */
function extrairGeracao(text) {
  // Procura padrões como "Geração: 175.420,5 kWh" ou "Energia injetada: 175420 kWh"
  const padroes = [
    /(?:gera[çc][ãa]o|energia\s+(?:gerada|injetada|ativa)|consumo)[^0-9]{0,60}([\d.,]+)\s*kWh/i,
    /([\d.,]+)\s*kWh[^0-9]{0,60}(?:gerada|injetada|gera[çc][ãa]o)/i,
    /([\d.,]+)\s*kWh/i, // último recurso: primeiro número com kWh
  ];
  for (const p of padroes) {
    const m = text.match(p);
    if (m) {
      const n = parseNumBR(m[1]);
      if (n > 0 && n < 100000000) return n;
    }
  }
  return 0;
}

/** Tenta extrair o valor faturado em R$ */
function extrairValor(text) {
  const padroes = [
    /(?:valor\s+(?:total|faturado|a\s+pagar)|total\s+a\s+pagar|fatura)[^R$]{0,60}R\$\s*([\d.,]+)/i,
    /R\$\s*([\d.,]+)[^0-9]{0,40}(?:total|fatura)/i,
    /total[^R$]{0,30}R\$\s*([\d.,]+)/i,
  ];
  for (const p of padroes) {
    const m = text.match(p);
    if (m) {
      const n = parseNumBR(m[1]);
      if (n > 0) return n;
    }
  }
  return 0;
}

function extrairDistribuidora(text) {
  const conhecidas = [
    'EDP', 'Energisa', 'CEMIG', 'CPFL', 'Light', 'COELBA', 'Equatorial',
    'Enel', 'Neoenergia', 'EBO', 'COSERN', 'ELETROBRAS', 'CELESC',
  ];
  for (const d of conhecidas) {
    if (new RegExp(`\\b${d}\\b`, 'i').test(text)) return d.toUpperCase();
  }
  return null;
}

/** Tenta extrair número de beneficiários (UCs) */
function extrairBeneficiarios(text) {
  const m = text.match(/(\d+)\s*(?:UC[s]?|benefici[áa]ri[oa]s?|consumidor[ae]s?)/i);
  return m ? parseInt(m[1]) : null;
}

/** Parser principal */
export async function parseFitPDF(buffer) {
  let data;
  try {
    data = await pdfParse(buffer);
  } catch (e) {
    throw new Error(`pdf-parse falhou: ${e.message}`);
  }
  // v2.x retorna { text, numpages } igual a v1 — mas garantimos fallback
  const text = String(data?.text ?? data?.pages?.map?.((p) => p.text).join('\n') ?? '')
    .replace(/\s+/g, ' ')
    .trim();

  const { mes, ano } = extrairPeriodo(text);
  const geracao = extrairGeracao(text);
  const valor = extrairValor(text);
  const distribuidora = extrairDistribuidora(text);
  const beneficiarios = extrairBeneficiarios(text);
  const tarifa = geracao > 0 ? +(valor / geracao).toFixed(4) : 0;

  return {
    periodo: mes && ano ? `${ano}-${String(mes).padStart(2, '0')}` : null,
    mes,
    ano,
    geracaoKwh: geracao,
    valorFaturado: valor,
    tarifa,
    distribuidora,
    beneficiarios,
    rawText: text.slice(0, 8000), // limita pra não estourar DB
    paginas: data.numpages,
  };
}
