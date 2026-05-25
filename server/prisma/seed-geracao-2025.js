// =================================================
// Importa lançamentos mensais de 2025 (Jan–Dez)
// a partir do arquivo "lancamento_de_dados2.txt"
// =================================================
// 5 usinas (sem SKID) × 12 meses = 60 lançamentos
// As 5 usinas já devem existir (do seed-real).
// =================================================
// Uso: npm run db:seed-geracao-2025
// =================================================

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const LANCAMENTOS = [
  // -------- JANEIRO / 2025 --------
  { periodo: '2025-01', usina: 'UFV Bom Futuro',        gen: 12608,   irrad: 207.7, pr: 78 },
  { periodo: '2025-01', usina: 'UFV Cerado Pedra I',    gen: 12944.4, irrad: 207.7, pr: 78 },
  { periodo: '2025-01', usina: 'UFV Cercado Pedra II',  gen: 14887.5, irrad: 207.7, pr: 78 },
  { periodo: '2025-01', usina: 'UFV Cercado Pedra III', gen: 15874.3, irrad: 207.7, pr: 78 },
  { periodo: '2025-01', usina: 'UFV Efizi',             gen: 13693.7, irrad: 207.7, pr: 78 },

  // -------- FEVEREIRO / 2025 --------
  { periodo: '2025-02', usina: 'UFV Bom Futuro',        gen: 13761.5, irrad: 176.3, pr: 78 },
  { periodo: '2025-02', usina: 'UFV Cerado Pedra I',    gen: 8559.6,  irrad: 176.3, pr: 78 },
  { periodo: '2025-02', usina: 'UFV Cercado Pedra II',  gen: 16458,   irrad: 176.3, pr: 78 },
  { periodo: '2025-02', usina: 'UFV Cercado Pedra III', gen: 18437.9, irrad: 176.3, pr: 78 },
  { periodo: '2025-02', usina: 'UFV Efizi',             gen: 12319,   irrad: 176.3, pr: 78 },

  // -------- MARÇO / 2025 --------
  { periodo: '2025-03', usina: 'UFV Bom Futuro',        gen: 13289.7, irrad: 166.5, pr: 79 },
  { periodo: '2025-03', usina: 'UFV Cerado Pedra I',    gen: 10499.4, irrad: 166.5, pr: 79 },
  { periodo: '2025-03', usina: 'UFV Cercado Pedra II',  gen: 15833.5, irrad: 166.5, pr: 79 },
  { periodo: '2025-03', usina: 'UFV Cercado Pedra III', gen: 10897.2, irrad: 166.5, pr: 79 },
  { periodo: '2025-03', usina: 'UFV Efizi',             gen: 14189.3, irrad: 166.5, pr: 79 },

  // -------- ABRIL / 2025 --------
  { periodo: '2025-04', usina: 'UFV Bom Futuro',        gen: 6161,    irrad: 135.6, pr: 80 },
  { periodo: '2025-04', usina: 'UFV Cerado Pedra I',    gen: 11762.8, irrad: 135.6, pr: 80 },
  { periodo: '2025-04', usina: 'UFV Cercado Pedra II',  gen: 11815.8, irrad: 135.6, pr: 80 },
  { periodo: '2025-04', usina: 'UFV Cercado Pedra III', gen: 12277.2, irrad: 135.6, pr: 80 },
  { periodo: '2025-04', usina: 'UFV Efizi',             gen: 10526.5, irrad: 135.6, pr: 80 },

  // -------- MAIO / 2025 --------
  { periodo: '2025-05', usina: 'UFV Bom Futuro',        gen: 6688.2,  irrad: 121.5, pr: 73 },
  { periodo: '2025-05', usina: 'UFV Cerado Pedra I',    gen: 10312.8, irrad: 121.5, pr: 73 },
  { periodo: '2025-05', usina: 'UFV Cercado Pedra II',  gen: 3363.2,  irrad: 121.5, pr: 73 },
  { periodo: '2025-05', usina: 'UFV Cercado Pedra III', gen: 10658.6, irrad: 121.5, pr: 73 },
  { periodo: '2025-05', usina: 'UFV Efizi',             gen: 9224.5,  irrad: 121.5, pr: 73 },

  // -------- JUNHO / 2025 --------
  { periodo: '2025-06', usina: 'UFV Bom Futuro',        gen: 9408,    irrad: 113.6, pr: 83 },
  { periodo: '2025-06', usina: 'UFV Cerado Pedra I',    gen: 10239.2, irrad: 113.6, pr: 83 },
  { periodo: '2025-06', usina: 'UFV Cercado Pedra II',  gen: 8797.3,  irrad: 113.6, pr: 83 },
  { periodo: '2025-06', usina: 'UFV Cercado Pedra III', gen: 10839.5, irrad: 113.6, pr: 83 },
  { periodo: '2025-06', usina: 'UFV Efizi',             gen: 6893.7,  irrad: 113.6, pr: 83 },

  // -------- JULHO / 2025 --------
  { periodo: '2025-07', usina: 'UFV Bom Futuro',        gen: 9876,    irrad: 118.1, pr: 83 },
  { periodo: '2025-07', usina: 'UFV Cerado Pedra I',    gen: 10685.9, irrad: 118.1, pr: 83 },
  { periodo: '2025-07', usina: 'UFV Cercado Pedra II',  gen: 12095.7, irrad: 129.2, pr: 75 },
  { periodo: '2025-07', usina: 'UFV Cercado Pedra III', gen: 11438,   irrad: 118.1, pr: 83 },
  { periodo: '2025-07', usina: 'UFV Efizi',             gen: 8693.7,  irrad: 118.1, pr: 83 },

  // -------- AGOSTO / 2025 --------
  { periodo: '2025-08', usina: 'UFV Bom Futuro',        gen: 9998.5,  irrad: 129.2, pr: 75 },
  { periodo: '2025-08', usina: 'UFV Cerado Pedra I',    gen: 11342,   irrad: 129.2, pr: 75 },
  { periodo: '2025-08', usina: 'UFV Cercado Pedra II',  gen: 10805,   irrad: 118.1, pr: 83 },
  { periodo: '2025-08', usina: 'UFV Cercado Pedra III', gen: 11962.4, irrad: 129.2, pr: 75 },
  { periodo: '2025-08', usina: 'UFV Efizi',             gen: 11005.3, irrad: 129.2, pr: 75 },

  // -------- SETEMBRO / 2025 --------
  { periodo: '2025-09', usina: 'UFV Bom Futuro',        gen: 9617.39, irrad: 145.5, pr: 80 },
  { periodo: '2025-09', usina: 'UFV Cerado Pedra I',    gen: 12900.7, irrad: 145.5, pr: 80 },
  { periodo: '2025-09', usina: 'UFV Cercado Pedra II',  gen: 13105.6, irrad: 145.5, pr: 80 },
  { periodo: '2025-09', usina: 'UFV Cercado Pedra III', gen: 13385.3, irrad: 145.5, pr: 80 },
  { periodo: '2025-09', usina: 'UFV Efizi',             gen: 11655.9, irrad: 145.5, pr: 80 },

  // -------- OUTUBRO / 2025 --------
  { periodo: '2025-10', usina: 'UFV Bom Futuro',        gen: 9906.1,  irrad: 152, pr: 80 },
  { periodo: '2025-10', usina: 'UFV Cerado Pedra I',    gen: 13391,   irrad: 152, pr: 80 },
  { periodo: '2025-10', usina: 'UFV Cercado Pedra II',  gen: 13696.6, irrad: 152, pr: 80 },
  { periodo: '2025-10', usina: 'UFV Cercado Pedra III', gen: 13933.4, irrad: 152, pr: 80 },
  { periodo: '2025-10', usina: 'UFV Efizi',             gen: 12424.9, irrad: 152, pr: 80 },

  // -------- NOVEMBRO / 2025 --------
  { periodo: '2025-11', usina: 'UFV Bom Futuro',        gen: 9414.3,  irrad: 151.2, pr: 80 },
  { periodo: '2025-11', usina: 'UFV Cerado Pedra I',    gen: 13678.9, irrad: 151.2, pr: 80 },
  { periodo: '2025-11', usina: 'UFV Cercado Pedra II',  gen: 13430.7, irrad: 151.2, pr: 80 },
  { periodo: '2025-11', usina: 'UFV Cercado Pedra III', gen: 14123.4, irrad: 151.2, pr: 80 },
  { periodo: '2025-11', usina: 'UFV Efizi',             gen: 12814.1, irrad: 151.2, pr: 80 },

  // -------- DEZEMBRO / 2025 --------
  { periodo: '2025-12', usina: 'UFV Bom Futuro',        gen: 10755.1, irrad: 185, pr: 65 },
  { periodo: '2025-12', usina: 'UFV Cerado Pedra I',    gen: 16986.1, irrad: 185, pr: 65 },
  { periodo: '2025-12', usina: 'UFV Cercado Pedra II',  gen: 11660.3, irrad: 185, pr: 65 },
  { periodo: '2025-12', usina: 'UFV Cercado Pedra III', gen: 17445.7, irrad: 185, pr: 65 },
  { periodo: '2025-12', usina: 'UFV Efizi',             gen: 14903.6, irrad: 185, pr: 65 },
];

async function main() {
  if (process.env.NODE_ENV === 'production' && process.env.SEED_FORCE !== 'true') {
    console.error('❌ Bloqueado em produção. Use SEED_FORCE=true se realmente desejar.');
    process.exit(1);
  }

  console.log('🌞 Importando lançamentos Jan–Dez/2025…\n');

  // Cache de usinas por nome
  const usinasCache = new Map();
  async function findUsina(nome) {
    if (usinasCache.has(nome)) return usinasCache.get(nome);
    const u = await prisma.usina.findUnique({ where: { nome } });
    usinasCache.set(nome, u);
    return u;
  }

  let added = 0;
  let updated = 0;
  const erros = [];

  for (const l of LANCAMENTOS) {
    const usina = await findUsina(l.usina);
    if (!usina) {
      erros.push({ ...l, erro: `usina "${l.usina}" não encontrada` });
      continue;
    }
    const existente = await prisma.lancamento.findFirst({
      where: { usinaId: usina.id, skidId: null, periodo: l.periodo },
      select: { id: true },
    });
    const payload = {
      geracao: l.gen,
      irrad: l.irrad,
      pr: l.pr,
      disp: 0,
      obs: 'Importado do arquivo de geração 2025',
    };
    if (existente) {
      await prisma.lancamento.update({ where: { id: existente.id }, data: payload });
      updated++;
    } else {
      await prisma.lancamento.create({
        data: { usinaId: usina.id, skidId: null, periodo: l.periodo, ...payload },
      });
      added++;
    }
  }

  console.log(`📋 Resumo:`);
  console.log(`   Total processado: ${LANCAMENTOS.length}`);
  console.log(`   ✓ Novos lançamentos: ${added}`);
  console.log(`   ↻ Atualizados: ${updated}`);
  if (erros.length) {
    console.log(`   ✗ Erros: ${erros.length}`);
    erros.forEach((e) => console.log(`     ${e.periodo} ${e.usina}: ${e.erro}`));
  }

  // Resumo de geração mensal de 2025
  console.log(`\n⚡ Geração total importada por mês:`);
  const MES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  for (let m = 1; m <= 12; m++) {
    const periodo = `2025-${String(m).padStart(2, '0')}`;
    const total = await prisma.lancamento.aggregate({
      where: { periodo, usinaId: { in: [...usinasCache.values()].filter((u) => u).map((u) => u.id) } },
      _sum: { geracao: true },
      _count: true,
    });
    console.log(`   ${MES[m - 1]}/2025: ${total._sum.geracao?.toLocaleString('pt-BR', { maximumFractionDigits: 0 }) || 0} kWh em ${total._count} lançamentos`);
  }

  console.log(`\n📊 Estado final da base:`);
  console.log(`   Usinas:        ${await prisma.usina.count()}`);
  console.log(`   SKIDs:         ${await prisma.skid.count()}`);
  console.log(`   Lançamentos:   ${await prisma.lancamento.count()}`);

  console.log('\n✅ Importação concluída.\n');
}

main()
  .catch((e) => { console.error('❌ Erro:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
