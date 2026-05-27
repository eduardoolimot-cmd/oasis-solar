// Rotas de autenticação: login, logout, me
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../db.js';
import { asyncRoute, httpErrors } from '../lib/http.js';
import { signToken, authCookieOptions, COOKIE_NAME } from '../lib/jwt.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

const loginSchema = z.object({
  email: z.string().email('E-mail inválido').toLowerCase(),
  senha: z.string().min(1, 'Senha é obrigatória'),
});

// ---------- POST /api/auth/login ----------
router.post(
  '/login',
  asyncRoute(async (req, res) => {
    const { email, senha } = loginSchema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.ativo) {
      throw httpErrors.unauthorized('Credenciais inválidas');
    }

    const senhaOk = await bcrypt.compare(senha, user.senhaHash);
    if (!senhaOk) {
      throw httpErrors.unauthorized('Credenciais inválidas');
    }

    // Atualiza último login (não bloqueia a resposta — fire and forget)
    prisma.user
      .update({
        where: { id: user.id },
        data: { ultimoLogin: new Date() },
      })
      .catch(() => {});

    // Registra audit log
    await prisma.auditLog.create({
      data: {
        userId: user.id,
        acao: 'login',
        recurso: 'User',
        recursoId: user.id,
      },
    });

    const token = signToken(user);
    res.cookie(COOKIE_NAME, token, authCookieOptions());

    res.json({
      user: {
        id: user.id,
        email: user.email,
        nome: user.nome,
        role: user.role,
      },
    });
  }),
);

// ---------- POST /api/auth/logout ----------
router.post(
  '/logout',
  asyncRoute(async (req, res) => {
    // Tenta registrar o audit log se houver token válido (sem bloquear)
    try {
      const token = req.cookies?.[COOKIE_NAME];
      if (token) {
        const { verifyToken } = await import('../lib/jwt.js');
        const payload = verifyToken(token);
        await prisma.auditLog.create({
          data: {
            userId: payload.sub,
            acao: 'logout',
            recurso: 'User',
            recursoId: payload.sub,
          },
        });
      }
    } catch {
      // silencioso — logout não precisa de auth válida
    }

    res.clearCookie(COOKIE_NAME, { path: '/' });
    res.json({ ok: true });
  }),
);

// ---------- GET /api/auth/me ----------
router.get(
  '/me',
  requireAuth,
  asyncRoute(async (req, res) => {
    res.json({
      user: {
        id: req.user.id,
        email: req.user.email,
        nome: req.user.nome,
        role: req.user.role,
        permissoes: req.user.permissoes, // mapa { secao: { ver, editar } }
      },
    });
  }),
);

export default router;
