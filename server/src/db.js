// Cliente Prisma único reutilizado em todo o app
// Em dev evita criar múltiplas conexões com hot-reload
import { PrismaClient } from '@prisma/client';
import { env } from './lib/env.js';

const globalForPrisma = globalThis;

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
