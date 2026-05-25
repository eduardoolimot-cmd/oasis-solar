// Assinatura e verificação de tokens JWT
import jwt from 'jsonwebtoken';
import { env } from './env.js';

const COOKIE_NAME = 'oasis_token';

/**
 * Gera um JWT com payload mínimo (id e role do usuário).
 */
export function signToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, email: user.email },
    env.JWT_SECRET,
    { expiresIn: env.JWT_EXPIRES_IN },
  );
}

/**
 * Verifica e decodifica um JWT. Retorna o payload ou lança erro.
 */
export function verifyToken(token) {
  return jwt.verify(token, env.JWT_SECRET);
}

/**
 * Configurações padrão do cookie httpOnly.
 * - httpOnly: bloqueia leitura via JS (proteção XSS)
 * - sameSite: lax permite navegação top-level mas bloqueia CSRF agressivo
 * - secure: true em prod (HTTPS), false em dev (localhost)
 */
export function authCookieOptions() {
  return {
    httpOnly: true,
    sameSite: env.NODE_ENV === 'production' ? 'none' : 'lax',
    secure: env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 dias
    path: '/',
  };
}

export { COOKIE_NAME };
