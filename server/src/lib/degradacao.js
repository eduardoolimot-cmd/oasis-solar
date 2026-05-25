// =================================================
// Lógica de degradação dos módulos fotovoltaicos
// =================================================
// Regra:
//   - 1º ano (a partir da data de início): perda de 2,0%
//   - Anos seguintes: perda adicional de 0,05% por ano (cumulativa)
//
// Exemplo (usina iniciada em 2023):
//   Ano de cálculo  | Idade | Fator de degradação acumulado
//   2023            | 1     | 0.9800                      (–2,00%)
//   2024            | 2     | 0.9800 × 0.9995 = 0.9795    (–2,05%)
//   2025            | 3     | 0.9795 × 0.9995 = 0.9790    (–2,10%)
//   2030            | 8     | 0.9800 × 0.9995^7 ≈ 0.9766  (–2,34%)
// =================================================

const PERDA_PRIMEIRO_ANO = 0.02; // 2%
const PERDA_ANUAL = 0.0005;       // 0,05%

/**
 * Calcula o fator multiplicador a aplicar sobre a geração prevista original.
 * Retorna 1 (sem degradação) se a usina ainda não tem data de início ou se
 * o anoCalculo é anterior ao ano de início.
 *
 * @param {string|Date|null} inicio - data de início de operação da usina
 * @param {number} anoCalculo - ano para o qual se quer a previsão (ex: 2025)
 * @returns {number} fator no intervalo (0, 1]
 */
export function fatorDegradacao(inicio, anoCalculo) {
  if (!inicio) return 1;
  const anoInicio = new Date(inicio).getUTCFullYear();
  if (!Number.isFinite(anoInicio)) return 1;
  if (anoCalculo < anoInicio) return 1;

  // Idade em anos completos desde a instalação (1 = 1º ano)
  const idade = anoCalculo - anoInicio + 1;
  if (idade <= 1) return 1 - PERDA_PRIMEIRO_ANO;
  return (1 - PERDA_PRIMEIRO_ANO) * Math.pow(1 - PERDA_ANUAL, idade - 1);
}

/**
 * Aplica a degradação à geração prevista de um mês específico.
 *
 * @param {number} gen - geração prevista original (kWh)
 * @param {string|Date|null} inicio - data de início da usina
 * @param {number} anoCalculo - ano para o qual se quer a previsão
 * @returns {number} geração prevista após degradação
 */
export function previsaoComDegradacao(gen, inicio, anoCalculo) {
  return gen * fatorDegradacao(inicio, anoCalculo);
}
