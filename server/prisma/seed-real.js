// =================================================
// Importa as 7 usinas reais a partir do CSV anexo.
// Substitui as usinas atuais (CASCADE limpa skids, previsões,
// lançamentos, manutenções e financeiros).
// PRESERVA usuários, audit logs e notificações.
// =================================================
// Uso: node prisma/seed-real.js
//      ou: npm run db:seed-real
// =================================================

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

// Helper: array de 12 meses de previsão a partir dos arrays [gen], [irrad], [pr]
function previsoesMensais(gens, irrads, prs) {
  return gens.map((gen, i) => ({
    mes: i + 1,
    gen,
    irrad: irrads[i],
    pr: prs[i],
  }));
}

// Padrões de previsão observados no CSV
// Note: 5 das 7 usinas têm o mesmo padrão (Efizi-pattern)
const EFIZI_GEN   = [16865, 14386, 13728, 11407, 9334,  9804,  10226, 10079, 12298, 12693, 12585, 12629];
const EFIZI_IRR   = [207.7, 176.3, 166.5, 135.6, 121.5, 113.6, 118.1, 129.2, 145.5, 152,   151.2, 185  ];
const EFIZI_PR    = [78,    78,    79,    80,    73,    83,    83,    75,    81,    80,    80,    65   ];

// Nacional II
const NAC2_GEN    = [16240, 13820, 13300, 10910, 9120,  9450,  8720,  11390, 10290, 12740, 11960, 14300];
const NAC2_IRR    = [210,   177,   169.6, 136,   125.6, 115.8, 119.7, 140.3, 150.8, 156.3, 151.2, 183.2];
const NAC2_PR     = [80,    81,    81,    83,    75,    85,    76,    85,    71,    83,    82,    81   ];

// Nacional I (igual à Nacional II, com Out/Dez ligeiramente diferentes)
const NAC1_GEN    = [16240, 13820, 13300, 10910, 9120,  9450,  8720,  11390, 10290, 12470, 11960, 14299.7];
const NAC1_IRR    = [210,   177,   169.6, 136,   125.6, 115.8, 119.7, 140.3, 150.8, 156.3, 151.2, 183.2];
const NAC1_PR     = [80,    81,    81,    83,    75,    85,    76,    85,    71,    83,    82,    81   ];

// Lista completa das 7 usinas — manter ortografia do CSV (inclusive "Cerado" com typo)
const USINAS = [
  {
    nome: 'UFV Efizi',
    inicio: new Date(Date.UTC(2024, 10, 22)),     // 22/11/2024
    kwp: 102.83,
    previsoes: previsoesMensais(EFIZI_GEN, EFIZI_IRR, EFIZI_PR),
  },
  {
    nome: 'UFV Nacional II',
    inicio: new Date(Date.UTC(2024, 1, 12)),      // 12/02/2024
    kwp: 96,
    previsoes: previsoesMensais(NAC2_GEN, NAC2_IRR, NAC2_PR),
  },
  {
    nome: 'UFV Nacional I',
    inicio: new Date(Date.UTC(2025, 9, 12)),      // 12/10/2025
    kwp: 96.00,
    previsoes: previsoesMensais(NAC1_GEN, NAC1_IRR, NAC1_PR),
  },
  {
    nome: 'UFV Cercado Pedra III',
    inicio: new Date(Date.UTC(2022, 10, 14)),     // 14/11/2022
    kwp: 108.48,
    previsoes: previsoesMensais(EFIZI_GEN, EFIZI_IRR, EFIZI_PR),
  },
  {
    nome: 'UFV Cercado Pedra II',
    inicio: new Date(Date.UTC(2022, 10, 14)),     // 14/11/2022
    kwp: 105.45,
    previsoes: previsoesMensais(EFIZI_GEN, EFIZI_IRR, EFIZI_PR),
  },
  {
    nome: 'UFV Cerado Pedra I',                   // (Mantém grafia do CSV — "Cerado")
    inicio: new Date(Date.UTC(2023, 9, 9)),       // 09/10/2023
    kwp: 108.00,
    previsoes: previsoesMensais(EFIZI_GEN, EFIZI_IRR, EFIZI_PR),
  },
  {
    nome: 'UFV Bom Futuro',
    inicio: new Date(Date.UTC(2024, 10, 19)),     // 19/11/2024
    kwp: 108.16,
    previsoes: previsoesMensais(EFIZI_GEN, EFIZI_IRR, EFIZI_PR),
  },
];

async function main() {
  if (process.env.NODE_ENV === 'production' && process.env.SEED_FORCE !== 'true') {
    console.error('❌ Bloqueado em produção. Use SEED_FORCE=true se realmente desejar.');
    process.exit(1);
  }

  console.log('🌞 Importando usinas reais (CSV)…\n');

  // 1) Limpa apenas usinas e cascateia tudo relacionado
  const totais = {
    lancamentos: await prisma.lancamento.count(),
    manutencoes: await prisma.manutencao.count(),
    financeiros: await prisma.financeiro.count(),
    skids:       await prisma.skid.count(),
    previsoes:   await prisma.previsao.count(),
    usinas:      await prisma.usina.count(),
  };
  console.log('Antes da limpeza:');
  Object.entries(totais).forEach(([k, v]) => console.log(`   ${k.padEnd(13)} ${v}`));

  console.log('\n🧹 Limpando dados relacionados às usinas atuais…');
  // O onDelete: Cascade do schema cuida das dependências
  const del = await prisma.usina.deleteMany();
  console.log(`   ✓ ${del.count} usinas removidas (cascade cuidou de skids/previsões/lançamentos/manutenções/arquivos/financeiros)`);

  // 2) Cria as 7 usinas com previsões em transação
  console.log('\n📥 Inserindo as 7 usinas com previsões mensais…');
  for (const u of USINAS) {
    await prisma.$transaction(async (tx) => {
      const created = await tx.usina.create({
        data: {
          nome: u.nome,
          inicio: u.inicio,
          kwp: u.kwp,
          local: u.local || null,
          obs: 'Importado do CSV de previsões',
          moduloW: 400,
          inversorKw: 110,
        },
      });
      await tx.previsao.createMany({
        data: u.previsoes.map((p) => ({
          usinaId: created.id,
          mes: p.mes,
          gen: p.gen,
          irrad: p.irrad,
          pr: p.pr,
        })),
      });
    });
    const totalGen = u.previsoes.reduce((s, p) => s + p.gen, 0);
    console.log(`   ✓ ${u.nome.padEnd(25)} ${u.kwp.toString().padStart(7)} kWp · 12 meses · ∑geração = ${totalGen.toLocaleString('pt-BR')} kWh/ano`);
  }

  console.log('\n📋 Estado final:');
  console.log(`   Usuários:    ${await prisma.user.count()}  (preservados)`);
  console.log(`   Usinas:      ${await prisma.usina.count()}`);
  console.log(`   Previsões:   ${await prisma.previsao.count()}`);
  console.log(`   Lançamentos: ${await prisma.lancamento.count()}  (todos removidos no cascade)`);
  console.log(`   Manutenções: ${await prisma.manutencao.count()}`);
  console.log(`   Financeiros: ${await prisma.financeiro.count()}`);

  console.log('\n✅ Base atualizada com sucesso.\n');
}

main()
  .catch((e) => {
    console.error('❌ Erro:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
