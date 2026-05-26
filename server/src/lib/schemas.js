// Schemas Zod reutilizáveis para validação de payloads
import { z } from 'zod';

// ---------- Helpers ----------
const optionalString = z.string().trim().optional().nullable();
const optionalNumber = z.coerce.number().optional().nullable();
const optionalInt = z.coerce.number().int().optional().nullable();

// ---------- Previsão mensal ----------
export const previsaoSchema = z.object({
  mes: z.coerce.number().int().min(1).max(12),
  gen: z.coerce.number().min(0).default(0),
  irrad: z.coerce.number().min(0).default(0),
  pr: z.coerce.number().min(0).max(100).default(0),
});

// ---------- Skid ----------
export const skidSchema = z.object({
  nome: z.string().trim().min(1, 'Nome do SKID é obrigatório'),
  kwp: z.coerce.number().min(0).default(0),
  previsoes: z.array(previsaoSchema).optional().default([]),
});

// ---------- Usina (create/update) ----------
export const usinaSchema = z.object({
  nome: z.string().trim().min(1, 'Nome é obrigatório'),
  kwp: z.coerce.number().positive('Potência deve ser maior que 0'),
  inicio: z
    .string()
    .optional()
    .nullable()
    .transform((v) => (v ? new Date(v) : null)),
  local: optionalString,
  obs: optionalString,

  moduloModelo: optionalString,
  moduloQtd: optionalInt.default(0),
  moduloW: optionalInt.default(400),
  moduloFab: optionalString,

  inversorModelo: optionalString,
  inversorQtd: optionalInt.default(0),
  inversorKw: optionalInt.default(110),
  inversorFab: optionalString,

  previsoes: z.array(previsaoSchema).optional().default([]),
  skids: z.array(skidSchema).optional().default([]),
});

// ---------- Lançamento mensal de geração ----------
// periodo: "YYYY-MM" (string ISO de mês)
export const lancamentoSchema = z.object({
  usinaId: z.string().min(1, 'Usina é obrigatória'),
  skidId: z.string().optional().nullable(),
  periodo: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Periodo deve estar no formato YYYY-MM'),
  geracao: z.coerce.number().min(0, 'Geração deve ser >= 0'),
  irrad: z.coerce.number().min(0).default(0),
  pr: z.coerce.number().min(0).max(100).default(0),
  disp: z.coerce.number().min(0).max(100).default(0),
  obs: optionalString,
});

// Filtros de listagem de lançamentos
export const lancamentoFiltroSchema = z.object({
  usinaId: z.string().optional(),
  skidId: z.string().optional(),
  ano: z.string().regex(/^\d{4}$/).optional(),
  mes: z.string().regex(/^(0[1-9]|1[0-2])$/).optional(),
});

// ---------- Manutenção ----------
const MANUT_TIPOS = ['prev', 'corr', 'pred', 'plan'];
const MANUT_STATUS = ['plan', 'exec', 'ok'];

export const manutencaoSchema = z.object({
  usinaId: z.string().min(1, 'Usina é obrigatória'),
  tipo: z.enum(MANUT_TIPOS),
  status: z.enum(MANUT_STATUS).default('plan'),
  titulo: z.string().trim().min(1, 'Título é obrigatório'),
  data: z
    .string()
    .optional()
    .nullable()
    .transform((v) => (v ? new Date(v) : null)),
  resp: optionalString,
  comp: optionalString,
  detalhe: optionalString,
});

export const manutencaoFiltroSchema = z.object({
  usinaId: z.string().optional(),
  tipo: z.enum(MANUT_TIPOS).optional(),
  status: z.enum(MANUT_STATUS).optional(),
  ano: z.string().regex(/^\d{4}$/).optional(),
});

export const manutencaoStatusSchema = z.object({
  status: z.enum(MANUT_STATUS),
});

// ---------- Financeiro ----------
// 'rec' = Receita, 'des' = Despesa, 'fin' = Financiamento (tipo próprio)
const FIN_TIPOS = ['rec', 'des', 'fin'];
const FIN_STATUS = ['pg', 'pend', 'prev'];

export const financeiroSchema = z.object({
  usinaId: z.string().min(1, 'Usina é obrigatória'),
  tipo: z.enum(FIN_TIPOS),
  data: z
    .string()
    .min(1, 'Data é obrigatória')
    .transform((v) => new Date(v)),
  cat: z.string().trim().min(1, 'Categoria é obrigatória'),
  desc: optionalString,
  val: z.coerce.number(),
  st: z.enum(FIN_STATUS).default('pg'),
});

export const financeiroFiltroSchema = z.object({
  usinaId: z.string().optional(),
  tipo: z.enum(FIN_TIPOS).optional(),
  st: z.enum(FIN_STATUS).optional(),
  ano: z.string().regex(/^\d{4}$/).optional(),
  mes: z.string().regex(/^(0[1-9]|1[0-2])$/).optional(),
});

// ---------- Notificação ----------
export const notificacaoSchema = z.object({
  userId: z.string().optional().nullable(),
  titulo: z.string().min(1),
  body: z.string().min(1),
  tipo: z.enum(['info', 'ok', 'wn', 'er']).default('info'),
});

// ---------- Dashboard ----------
export const dashboardFiltroSchema = z.object({
  ano: z.string().regex(/^\d{4}$/).optional(),
  mes: z.string().regex(/^(0[1-9]|1[0-2])$/).optional(),
  usinaId: z.string().optional(),
  skidId: z.string().optional(),
});
