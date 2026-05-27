// =================================================
// Defaults de permissões por role + helpers
// =================================================
// Cada seção tem um par {ver, editar} default por role.
// Se UserPermission tiver registro, sobrescreve o default.
// =================================================

export const SECOES = [
  'dashboard', 'cadastro', 'lancamento', 'importar',
  'manutencao', 'financeiro', 'fit',
  'comparativo', 'relatorio', 'usuarios',
];

// Defaults por role
export const DEFAULT_PERMS = {
  ADMIN: Object.fromEntries(SECOES.map((s) => [s, { ver: true, editar: true }])),
  TECNICO: Object.fromEntries(SECOES.map((s) => [s, {
    ver: s !== 'usuarios',
    editar: !['usuarios'].includes(s),
  }])),
  VISUALIZADOR: Object.fromEntries(SECOES.map((s) => [s, {
    ver: !['usuarios', 'importar'].includes(s),
    editar: false,
  }])),
};

/**
 * Mescla os defaults do role com overrides da tabela UserPermission.
 * Retorna mapa: { secao: { ver, editar } }
 */
export function calcularPermissoes(role, overrides = []) {
  const base = DEFAULT_PERMS[role] || DEFAULT_PERMS.VISUALIZADOR;
  // Clona para não mutar o default
  const final = {};
  for (const s of SECOES) {
    final[s] = { ver: base[s].ver, editar: base[s].editar };
  }
  for (const o of overrides) {
    if (final[o.secao]) {
      final[o.secao] = { ver: o.podeVer, editar: o.podeEditar };
    }
  }
  return final;
}
