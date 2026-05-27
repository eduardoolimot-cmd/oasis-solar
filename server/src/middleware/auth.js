// Middlewares de autenticação e autorização por role
import { COOKIE_NAME, verifyToken } from '../lib/jwt.js';
import { httpErrors } from '../lib/http.js';
import { prisma } from '../db.js';
import { calcularPermissoes } from '../lib/permissoes.js';

/**
 * Verifica o cookie JWT, carrega o usuário do banco e popula req.user.
 * Falha com 401 se não houver cookie, token inválido ou usuário inativo.
 */
export async function requireAuth(req, res, next) {
  try {
    const token = req.cookies?.[COOKIE_NAME];
    if (!token) throw httpErrors.unauthorized('Token ausente');

    let payload;
    try {
      payload = verifyToken(token);
    } catch {
      throw httpErrors.unauthorized('Token inválido ou expirado');
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        nome: true,
        role: true,
        ativo: true,
        acessos: { select: { usinaId: true } },
        permissoes: { select: { secao: true, podeVer: true, podeEditar: true } },
      },
    });

    if (!user) throw httpErrors.unauthorized('Usuário não encontrado');
    if (!user.ativo) throw httpErrors.forbidden('Usuário inativo');

    // Lista de usinaIds que esse usuário pode ver:
    //   - ADMIN: null (sem restrição)
    //   - Outros sem acessos: null (sem restrição — default open)
    //   - Outros com acessos: array dos IDs permitidos
    if (user.role === 'ADMIN' || user.acessos.length === 0) {
      user.allowedUsinaIds = null;
    } else {
      user.allowedUsinaIds = user.acessos.map((a) => a.usinaId);
    }
    delete user.acessos;

    // Calcula permissões finais (default do role + overrides)
    user.permissoes = calcularPermissoes(user.role, user.permissoes);

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Bloqueia a rota se o role do usuário não estiver na lista de permitidos.
 * Uso: router.post('/usinas', requireAuth, requireRole('ADMIN'), handler)
 */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return next(httpErrors.unauthorized());
    if (!roles.includes(req.user.role)) {
      return next(
        httpErrors.forbidden(
          `Esta ação requer um dos perfis: ${roles.join(', ')}`,
        ),
      );
    }
    next();
  };
}

/**
 * Atalhos por perfil (mais legível nas rotas).
 */
export const requireAdmin = requireRole('ADMIN');
export const requireAdminOrTecnico = requireRole('ADMIN', 'TECNICO');
