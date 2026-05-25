// Helpers para aplicar o filtro de acesso por usina
import { httpErrors } from './http.js';

/**
 * Adiciona ao objeto `where` a restrição de usinas acessíveis.
 * - Se o usuário não tem restrição (ADMIN ou sem acessos): retorna o where intacto.
 * - Se tem restrição:
 *     - sem filtro de usinaId: adiciona where.usinaId = { in: allowed }
 *     - com filtro de usinaId específico: valida que está na lista, senão joga 403
 */
export function aplicarFiltroUsinas(where, req) {
  const allowed = req.user?.allowedUsinaIds;
  if (!allowed) return where; // sem restrição
  if (where.usinaId && typeof where.usinaId === 'string') {
    if (!allowed.includes(where.usinaId)) {
      throw httpErrors.forbidden('Você não tem acesso a esta usina');
    }
    return where;
  }
  // sem filtro: restringe à lista
  where.usinaId = { in: allowed };
  return where;
}

/**
 * Verifica se o usuário pode acessar uma usina específica.
 * Joga 403 se não puder.
 */
export function exigirAcessoUsina(usinaId, req) {
  const allowed = req.user?.allowedUsinaIds;
  if (!allowed) return; // sem restrição
  if (!allowed.includes(usinaId)) {
    throw httpErrors.forbidden('Você não tem acesso a esta usina');
  }
}
