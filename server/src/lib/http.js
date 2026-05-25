// Helpers de resposta HTTP padronizados
import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const httpErrors = {
  badRequest: (msg = 'Requisição inválida', details) =>
    new HttpError(400, msg, details),
  unauthorized: (msg = 'Não autenticado') => new HttpError(401, msg),
  forbidden: (msg = 'Acesso negado') => new HttpError(403, msg),
  notFound: (msg = 'Recurso não encontrado') => new HttpError(404, msg),
  conflict: (msg = 'Conflito') => new HttpError(409, msg),
  serverError: (msg = 'Erro interno') => new HttpError(500, msg),
};

// Wrapper para rotas assíncronas — captura promises rejeitadas
export const asyncRoute = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

// Middleware global de tratamento de erros
export const errorHandler = (err, req, res, _next) => {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'Validação falhou',
      details: err.flatten().fieldErrors,
    });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({
      error: err.message,
      ...(err.details && { details: err.details }),
    });
  }
  // Erros conhecidos do Prisma
  if (err.code === 'P2002') {
    return res.status(409).json({
      error: 'Já existe um registro com esses dados únicos',
      details: err.meta?.target,
    });
  }
  if (err.code === 'P2025') {
    return res.status(404).json({ error: 'Registro não encontrado' });
  }
  console.error('[ERRO NÃO TRATADO]', err);
  res.status(500).json({ error: 'Erro interno do servidor' });
};
