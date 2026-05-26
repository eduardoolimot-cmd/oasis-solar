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
 * - sameSite: 'lax' funciona com mesma origem em HTTP e HTTPS
 * - secure: só true se o CORS_ORIGIN começa com https:// (auto-detecção)
 *   Em HTTP puro (acesso via IP sem certificado), o cookie precisa ser não-secure
 *   senão o navegador descarta silenciosamente.
 *
 * Você pode forçar com COOKIE_SECURE=true ou COOKIE_SECURE=false no .env.
 */
export function authCookieOptions() {
  const isHttps = env.CORS_ORIGIN.startsWith('https://');
  // permite override explícito
  const secureFromEnv = process.env.COOKIE_SECURE;
  const secure =
    secureFromEnv === 'true' ? true :
    secureFromEnv === 'false' ? false :
    isHttps;

  return {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 dias
    path: '/',
  };
}

export { COOKIE_NAME };
